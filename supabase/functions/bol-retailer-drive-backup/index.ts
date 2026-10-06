import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";
import * as XLSX from "npm:xlsx@0.18.5";
import ExcelJS from "npm:exceljs@4.4.0";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = Record<string, any>;

const BUCKET = "bol-retailer-api-json";
const SOURCE_TABLE = "bol_retailer_api_extract_runs";
const BACKUP_TABLE = "bol_retailer_drive_backup_runs";
const TIMEZONE = "Europe/Amsterdam";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const EXPECTED_ARTIFACTS = ["commercial.json", "catalog.json", "insights.json", "financial.json", "operations.json", "provenance.json", "manifest.json"];
const PRODUCT_CONFIG: Record<string, { shortName: string; primaryKeyword: string }> = {
  "8720892887504": { shortName: "Water Karaf", primaryKeyword: "waterkaraf" },
  "8720892887511": { shortName: "Stainless Steel Waterkan", primaryKeyword: "waterkaraf" },
  "8720892887528": { shortName: "XL Sporttas", primaryKeyword: "sporttas" },
  "6970452112658": { shortName: "Besrey Fort Kit", primaryKeyword: "hut bouwen" },
};

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function serviceRoleKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
}

function response(body: RecordValue, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function dateInAmsterdam(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function previousCompletedWeek(today: string) {
  const date = new Date(`${today}T12:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  const thisMonday = new Date(date);
  thisMonday.setUTCDate(date.getUTCDate() - day + 1);
  const end = new Date(thisMonday);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeKeyword(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function decryptToken(value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Unsupported encrypted Google token format.");
  const keyBytes = Uint8Array.from(atob(env("GOOGLE_TOKEN_ENCRYPTION_KEY")), char => char.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is invalid.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const ciphertext = base64UrlBytes(ciphertextValue);
  const tag = base64UrlBytes(tagValue);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlBytes(ivValue), tagLength: 128 }, key, combined);
  return new TextDecoder().decode(plaintext);
}

async function googleAccessToken(supabase: any) {
  const { data, error } = await supabase.from("google_connections")
    .select("encrypted_refresh_token,status,account_email")
    .eq("id", "aterra-google")
    .single();
  if (error || !data) throw new Error("Aterra Google connection is unavailable.");
  if (data.status !== "connected" || !data.encrypted_refresh_token) throw new Error("Aterra Google connection requires reconnection.");
  const refreshToken = await decryptToken(data.encrypted_refresh_token);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(`Google token refresh failed (${tokenResponse.status}).`);
  return String(tokenBody.access_token);
}

async function googleFetch(token: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const result = await fetch(url, { ...init, headers });
  if (!result.ok) {
    const detail = (await result.text()).slice(0, 300);
    throw new Error(`Google API request failed (${result.status}): ${detail}`);
  }
  return result;
}

async function sendRetailerReportEmail(token: string, body: RecordValue) {
  const year = Number(body.year);
  const week = Number(body.week);
  const url = String(body.url || "");
  const status = String(body.reportStatus || "");
  const summary = body.summary && typeof body.summary === "object" ? body.summary : {};
  if (!Number.isInteger(year) || !Number.isInteger(week) || !/^https:\/\//.test(url) || !["ready", "ready_with_limits"].includes(status)) throw new Error("Invalid report email request.");
  const dashboardUrl = new URL(url).origin;
  const label = `${year}-W${String(week).padStart(2, "0")}`;
  const subject = `Aterra Bol Retailer weekly report ${label}`;
  const html = `<p>Hi Reinout en Thijs,</p><p>Het beveiligde Bol Retailer weekrapport voor <strong>${label}</strong> staat online.</p><ul><li>Status: ${status}</li><li>Units: ${summary.gross_shipped_units ?? 0}</li><li>Netto GMS: EUR ${summary.provisional_net_gms ?? 0}</li><li>Productbezoeken: ${summary.product_visits ?? "niet beschikbaar"}</li></ul><p><a href="${dashboardUrl}"><strong>Open het centrale Retailer-dashboard</strong></a></p><p><a href="${url}">Open direct het rapport voor ${label}</a></p><p>Sla de dashboardlink op als vaste ingang. Nieuwe weekrapporten verschijnen daar automatisch bovenaan en eerdere weken blijven beschikbaar.</p><p>Dit is operationele handelsinformatie en blijft boekhoudkundig voorlopig totdat settlement is afgestemd.</p>`;
  const mime = [
    "From: Aterra <aterra.eu@gmail.com>",
    "To: aterra.eu@gmail.com, reinout.buwalda@gmail.com",
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent(html))),
  ].join("\r\n");
  const raw = btoa(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const result = await googleFetch(token, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  return result.json();
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findDriveFile(token: string, parentId: string, name: string, mimeType?: string) {
  const clauses = [`'${escapeDriveQuery(parentId)}' in parents`, `name = '${escapeDriveQuery(name)}'`, "trashed = false"];
  if (mimeType) clauses.push(`mimeType = '${escapeDriveQuery(mimeType)}'`);
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(clauses.join(" and "))}&pageSize=10&fields=files(id,name,mimeType,webViewLink,parents,size,md5Checksum,appProperties)&orderBy=createdTime`;
  const body = await (await googleFetch(token, url)).json();
  return body.files?.[0] || null;
}

async function ensureDriveFolder(token: string, parentId: string, name: string) {
  const existing = await findDriveFile(token, parentId, name, "application/vnd.google-apps.folder");
  if (existing) return existing;
  return (await googleFetch(token, `${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,parents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  })).json();
}

async function uploadDriveFile(token: string, parentId: string, name: string, mimeType: string, bytes: Uint8Array, appProperties: Record<string, string>) {
  const existing = await findDriveFile(token, parentId, name);
  if (existing) {
    if (Number(existing.size || 0) !== bytes.length) throw new Error(`Drive file ${name} exists with an unexpected size.`);
    if (existing.appProperties?.sourceSha256 !== appProperties.sourceSha256) throw new Error(`Drive file ${name} exists with an unexpected checksum.`);
    return existing;
  }
  const boundary = `aterra-${crypto.randomUUID()}`;
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId], appProperties })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
  body.set(prefix);
  body.set(bytes, prefix.length);
  body.set(suffix, prefix.length + bytes.length);
  const uploaded = await (await googleFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents,size,md5Checksum,appProperties", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  })).json();
  if (Number(uploaded.size || 0) !== bytes.length) throw new Error(`Drive readback size mismatch for ${name}.`);
  return uploaded;
}

async function sha256(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function downloadJson(supabase: any, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not download ${path}.`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, json: JSON.parse(new TextDecoder().decode(bytes)) };
}

const SENSITIVE_KEYS = new Set([
  "customercomments",
  "billingdetails",
  "billingaddress",
  "deliveryaddress",
  "email",
  "phonenumber",
  "phone",
  "firstname",
  "surname",
  "signature",
  "privatekey",
  "secret",
]);

function isSanitizedCountryDetails(value: unknown) {
  if (value === "<redacted>") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as RecordValue);
  return entries.length === 1 && entries[0][0] === "countryCode" && /^[A-Z]{2}$/.test(String(entries[0][1]));
}

function assertSanitized(value: unknown, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitized(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as RecordValue)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (normalized === "billingdetails" && isSanitizedCountryDetails(item)) continue;
    if (SENSITIVE_KEYS.has(normalized) && item !== "<redacted>") throw new Error(`Sensitive field is not redacted at ${path}.${key}.`);
    assertSanitized(item, `${path}.${key}`);
  }
}

function rankPayload(insights: RecordValue) {
  const observations: RecordValue[] = [];
  const calls: RecordValue[] = [];
  for (const result of insights.ranks || []) {
    const ranks = Array.isArray(result.data?.ranks) ? result.data.ranks : [];
    calls.push({ ean: result.ean, date: result.date, locale: result.locale || "nl-NL", page: result.page || 1, status: result.status, rows: ranks.length, paginationComplete: result.data?.hasNextPage !== true });
    for (const rank of ranks) {
      if (!rank.searchTerm || !Number.isFinite(Number(rank.rank))) continue;
      observations.push({ date: result.date, ean: result.ean, locale: result.locale || "nl-NL", searchTermRaw: String(rank.searchTerm), searchTermNormalized: normalizeKeyword(rank.searchTerm), placement: rank.wasSponsored === true ? "SPONSORED" : "ORGANIC", rank: Number(rank.rank), impressions: Number(rank.impressions || 0) });
    }
  }
  return { observations, calls };
}

function aggregateRanks(observations: RecordValue[]) {
  const groups = new Map<string, RecordValue>();
  for (const row of observations) {
    const key = [row.ean, row.locale, row.searchTermNormalized, row.placement].join("|");
    const item = groups.get(key) || { ean: row.ean, locale: row.locale, searchTerm: row.searchTermNormalized, rawVariants: new Set<string>(), placement: row.placement, observations: 0, dates: new Set<string>(), impressions: 0, weightedRankTotal: 0, rankTotal: 0, bestRank: Infinity, worstRank: -Infinity };
    item.rawVariants.add(row.searchTermRaw);
    item.observations += 1;
    item.dates.add(row.date);
    item.impressions += row.impressions;
    item.weightedRankTotal += row.rank * row.impressions;
    item.rankTotal += row.rank;
    item.bestRank = Math.min(item.bestRank, row.rank);
    item.worstRank = Math.max(item.worstRank, row.rank);
    groups.set(key, item);
  }
  return [...groups.values()].map(item => ({ ...item, rawVariants: [...item.rawVariants].sort(), daysObserved: item.dates.size, weeklyRank: round(item.impressions > 0 ? item.weightedRankTotal / item.impressions : item.rankTotal / item.observations, 1) })).sort((a, b) => String(a.ean).localeCompare(String(b.ean)) || String(a.searchTerm).localeCompare(String(b.searchTerm)) || String(a.placement).localeCompare(String(b.placement)));
}

function returnAdjustments(commercial: RecordValue) {
  const orderDetails = new Map((commercial.operational?.ordersFromShipmentDetails || []).map((row: RecordValue) => [row.orderId, row.detail]));
  const result: Record<string, RecordValue> = {};
  const unmatched: RecordValue[] = [];
  for (const record of commercial.operational?.returns || []) {
    for (const item of record.returnItems || []) {
      const order: any = orderDetails.get(item.orderId);
      const matches = (order?.orderItems || []).filter((candidate: RecordValue) => candidate.product?.ean === item.ean);
      const orderItem = item.orderItemId ? (order?.orderItems || []).find((candidate: RecordValue) => candidate.orderItemId === item.orderItemId) : matches.length === 1 ? matches[0] : null;
      const quantity = Number(item.expectedQuantity || item.quantity || 0);
      const adjustment = result[item.ean] || { returnUnits: 0, linkedReturnUnits: 0, unlinkedReturnUnits: 0, returnValue: 0, returnCommission: 0, unresolved: 0, reasons: new Set<string>() };
      adjustment.returnUnits += quantity;
      if (orderItem) {
        const shippedQuantity = Number(orderItem.quantityShipped || orderItem.quantity || 1);
        adjustment.linkedReturnUnits += quantity;
        adjustment.returnValue += quantity * Number(orderItem.unitPrice || 0);
        adjustment.returnCommission += shippedQuantity > 0 ? Number(orderItem.commission || 0) * quantity / shippedQuantity : 0;
      } else {
        adjustment.unlinkedReturnUnits += quantity;
        unmatched.push({ ean: item.ean, orderId: item.orderId, quantity });
      }
      if (!item.handled) adjustment.unresolved += quantity;
      if (item.returnReason?.mainReason) adjustment.reasons.add(item.returnReason.mainReason);
      result[item.ean] = adjustment;
    }
  }
  return { byEan: Object.fromEntries(Object.entries(result).map(([ean, item]) => [ean, { ...item, returnValue: round(item.returnValue), returnCommission: round(item.returnCommission), reasons: [...item.reasons] }])), unmatched };
}

function reviewData(files: Record<string, RecordValue>, manifest: RecordValue, driveFiles: RecordValue[]) {
  const commercial = files["commercial.json"];
  const catalog = files["catalog.json"];
  const insights = files["insights.json"];
  const provenance = files["provenance.json"];
  const operations = files["operations.json"];
  const financial = files["financial.json"];
  const ranks = rankPayload(insights);
  const weeklyRanks = aggregateRanks(ranks.observations);
  const visits: Record<string, number> = {};
  for (const item of insights.weekMetrics?.offerInsights || []) if (item.metric === "PRODUCT_VISITS" && item.ean) visits[item.ean] = (visits[item.ean] || 0) + Number(item.weekTotal || 0);
  const returns = returnAdjustments(commercial);
  const offerByEan = new Map((catalog.currentState?.offers || []).map((item: RecordValue) => [item.ean, item]));
  const eans = [...new Set([...Object.keys(commercial.operational?.byEan || {}), ...offerByEan.keys(), ...Object.keys(visits), ...Object.keys(returns.byEan)])].sort();
  const products = eans.map(ean => {
    const trading = commercial.operational?.byEan?.[ean] || {};
    const adjustment = returns.byEan[ean] || { returnUnits: 0, unlinkedReturnUnits: 0, returnValue: 0, returnCommission: 0, unresolved: 0 };
    const offer: any = offerByEan.get(ean);
    const primary = PRODUCT_CONFIG[ean]?.primaryKeyword || "";
    const netGms = Number(trading.grossOrderValue || 0) - Number(adjustment.returnValue || 0);
    const retainedCommission = Number(trading.commission || 0) - Number(adjustment.returnCommission || 0);
    const sponsored = weeklyRanks.find(row => row.ean === ean && row.locale === "nl-NL" && row.searchTerm === normalizeKeyword(primary) && row.placement === "SPONSORED");
    const organic = weeklyRanks.find(row => row.ean === ean && row.locale === "nl-NL" && row.searchTerm === normalizeKeyword(primary) && row.placement === "ORGANIC");
    return [ean, PRODUCT_CONFIG[ean]?.shortName || offer?.unknownProductTitle || `EAN ${ean}`, primary, round(netGms), Number(trading.units || 0), Number(trading.units || 0) ? round(Number(trading.grossOrderValue || 0) / Number(trading.units)) : null, visits[ean] ?? null, visits[ean] ? Number(trading.units || 0) / visits[ean] : null, round(netGms - retainedCommission), Number(adjustment.returnUnits || 0), Number(adjustment.unresolved || 0), sponsored?.weeklyRank ?? "Not observed", organic?.weeklyRank ?? "Not observed", ""];
  });
  const shipmentRows = (commercial.operational?.shipments || []).flatMap((shipment: RecordValue) => (shipment.shipmentItems || []).map((item: RecordValue) => [manifest.week.label, shipment.shipmentDateTime || "", shipment.shipmentId || "", shipment.order?.orderId || "", shipment.order?.orderPlacedDateTime || "", item.orderItemId || "", item.ean || "", shipment.transport?.transportId || "", "API source", ""]));
  const returnRows = (commercial.operational?.returns || []).flatMap((record: RecordValue) => (record.returnItems || []).map((item: RecordValue) => [manifest.week.label, record.registrationDateTime || "", record.returnId || "", item.rmaId || "", item.orderId || "", item.ean || "", Number(item.expectedQuantity || item.quantity || 0), item.handled === true, item.returnReason?.mainReason || "", item.returnReason?.detailedReason || "", "Customer comments redacted", ""]));
  const offerRows = (catalog.currentState?.offers || []).map((offer: RecordValue) => [offer.ean || "", offer.unknownProductTitle || PRODUCT_CONFIG[offer.ean]?.shortName || "", offer.lastModifiedDateTime || "", offer.onHoldByRetailer === true, offer.stock?.amount ?? null, offer.stock?.correctedStock ?? null, (offer.countryAvailabilities || []).filter((item: RecordValue) => item.forSale).map((item: RecordValue) => item.countryCode).join(", "), offer.pricing?.bundlePrices?.[0]?.unitPrice ?? null, offer.fulfilment?.method || "", offer.fulfilment?.schedule || "", ""]);
  const op = operations.data || {};
  const operationRows = [
    ["Product categories", op.productCategories?.status, op.productCategories?.summary?.count ?? 0, `Max depth ${op.productCategories?.summary?.maxDepth ?? "n.a."}`],
    ["Product-list filters", "collected", op.productListFilters?.length ?? 0, "Aterra/product terms"],
    ["Current product ranks", "collected", op.productRanks?.length ?? 0, "Offer EANs"],
    ["Sales forecasts", "collected", op.salesForecast?.length ?? 0, "Per EAN and horizon"],
    ["Promotions", "collected", op.promotions?.details?.length ?? 0, "Current/upcoming detail rows"],
    ["Replenishments", op.replenishments?.status || "unknown", op.replenishments?.count ?? 0, ""],
    ["Delivery dates", op.deliveryDates?.status, op.deliveryDates?.summary?.deliveryDates?.length ?? 0, ""],
    ["Shipment invoice requests", "collected", op.shipmentInvoiceRequests?.count ?? 0, ""],
    ["Subscriptions", op.subscriptions?.status, op.subscriptions?.summary?.subscriptions?.length ?? 0, ""],
    ["Signature keys", op.subscriptionSignatureKeys?.status, op.subscriptionSignatureKeys?.summary?.signatureKeys?.length ?? 0, "Values redacted"],
    ["Retailer profile", op.retailerCurrent?.status, op.retailerCurrent?.summary ? 1 : 0, "Current profile/rating"],
  ];
  const financialRows = [
    ["Invoices", financial.settlement?.invoices?.length ?? 0],
    ["Invoice details", financial.settlement?.invoiceDetails?.length ?? 0],
    ["Invoice specification pages", financial.settlement?.invoiceSpecifications?.length ?? 0],
  ];
  return {
    products,
    weeklyRanks: weeklyRanks.map(row => [manifest.week.label, row.ean, row.locale, row.searchTerm, row.rawVariants.join(", "), row.placement, row.observations, row.daysObserved, row.impressions, row.weeklyRank, row.bestRank, row.worstRank, ""]),
    dailyRanks: ranks.observations.map(row => [row.date, manifest.week.label, row.ean, row.locale, row.searchTermRaw, row.searchTermNormalized, row.placement, row.rank, row.impressions, ""]),
    shipments: shipmentRows,
    returns: returnRows,
    offers: offerRows,
    calls: (provenance.calls || []).map((call: RecordValue) => [call.label, call.method, call.path, call.status, call.ok, call.ms, call.rows ?? "", call.page ?? "", call.paginationComplete ?? "", call.rate?.limit ?? "", call.rate?.remaining ?? "", call.rate?.reset ?? ""]),
    operations: operationRows,
    financial: financialRows,
    sources: driveFiles.map(file => [file.name, file.sourcePath, file.bytes, file.sha256, "Matched", file.webViewLink]),
    unmatchedReturns: returns.unmatched.length,
  };
}

function cell(value: any, header = false) {
  const userEnteredValue = value === null || value === undefined ? {} : typeof value === "number" ? { numberValue: value } : typeof value === "boolean" ? { boolValue: value } : { stringValue: String(value) };
  return { userEnteredValue, userEnteredFormat: header ? { backgroundColor: { red: 0.91, green: 0.92, blue: 0.93 }, textFormat: { bold: true, foregroundColor: { red: 0.13, green: 0.15, blue: 0.16 } }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } : { textFormat: { foregroundColor: { red: 0.13, green: 0.15, blue: 0.16 } }, verticalAlignment: "MIDDLE" } };
}

async function createReviewSheet(token: string, parentId: string, manifest: RecordValue, data: RecordValue, sourceRunId: string) {
  const title = `Aterra Bol Retailer ${manifest.week.label} automated data review`;
  const existing = await findDriveFile(token, parentId, title, "application/vnd.google-apps.spreadsheet");
  if (existing) {
    if (existing.appProperties?.sourceRunId !== sourceRunId) throw new Error("An automated review Sheet exists for a different source run.");
    return existing;
  }
  const created = await (await googleFetch(token, `${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,parents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.spreadsheet", parents: [parentId], appProperties: { sourceRunId, reportKind: "bol_retailer_weekly_review" } }),
  })).json();
  const metadata = await (await googleFetch(token, `${SHEETS_API}/${created.id}?fields=sheets.properties`)).json();
  const defaultId = metadata.sheets?.[0]?.properties?.sheetId;
  const definitions = [
    { name: "Overview", headers: ["Metric", "Value", "Reviewer note"], rows: [["Report week", manifest.week.label, ""], ["Period", `${manifest.week.start} to ${manifest.week.end}`, ""], ["Cloud run", manifest.status, ""], ["Products", data.products.length, ""], ["Net shipped GMS", round(data.products.reduce((sum: number, row: any[]) => sum + Number(row[3] || 0), 0)), ""], ["Units sold", data.products.reduce((sum: number, row: any[]) => sum + Number(row[4] || 0), 0), ""], ["Product visits", data.products.reduce((sum: number, row: any[]) => sum + Number(row[6] || 0), 0), ""], ["Returns", data.products.reduce((sum: number, row: any[]) => sum + Number(row[9] || 0), 0), ""], ["Unmatched return items", data.unmatchedReturns, ""], ["API errors", manifest.summary?.apiErrors ?? 0, ""], ["JSON artifacts", EXPECTED_ARTIFACTS.length, ""]] },
    { name: "Products", headers: ["EAN", "Product", "Primary keyword", "Net shipped GMS", "Units sold", "ASP", "Product visits", "Trading conversion", "Revenue after commission", "Returns", "Unresolved returns", "Sponsored weekly rank", "Organic weekly rank", "Reviewer note"], rows: data.products },
    { name: "Weekly ranks", headers: ["ISO week", "EAN", "Locale", "Keyword", "Raw variants", "Placement", "Observations", "Days observed", "Impressions", "Weekly rank", "Best rank", "Worst rank", "Reviewer note"], rows: data.weeklyRanks },
    { name: "Daily ranks", headers: ["Date", "ISO week", "EAN", "Locale", "Raw keyword", "Normalized keyword", "Placement", "Rank", "Impressions", "Reviewer note"], rows: data.dailyRanks },
    { name: "Shipments", headers: ["ISO week", "Shipment datetime", "Shipment ID", "Order ID", "Order placed datetime", "Order item ID", "EAN", "Transport ID", "Verification status", "Reviewer note"], rows: data.shipments },
    { name: "Returns", headers: ["ISO week", "Registered datetime", "Return ID", "RMA ID", "Order ID", "EAN", "Quantity", "Handled", "Main reason", "Detailed reason", "Privacy treatment", "Reviewer note"], rows: data.returns },
    { name: "Offers", headers: ["EAN", "Product", "Last modified", "On hold", "Stock", "Corrected stock", "For sale in", "Unit price", "Fulfilment", "Schedule", "Reviewer note"], rows: data.offers },
    { name: "Operations", headers: ["Dataset", "Status", "Rows", "Meaning"], rows: data.operations },
    { name: "Financial", headers: ["Dataset", "Rows"], rows: data.financial },
    { name: "API quality", headers: ["Call", "Method", "Path", "HTTP status", "OK", "Duration ms", "Rows", "Page", "Pagination complete", "Rate limit", "Remaining", "Reset"], rows: data.calls },
    { name: "Source index", headers: ["Artifact", "Supabase path", "Bytes", "SHA-256", "Checksum", "Drive file"], rows: data.sources },
  ];
  const requests: RecordValue[] = [
    { updateSpreadsheetProperties: { properties: { locale: "nl_NL", timeZone: TIMEZONE }, fields: "locale,timeZone" } },
    { updateSheetProperties: { properties: { sheetId: defaultId, title: "Overview", gridProperties: { frozenRowCount: 1, hideGridlines: true } }, fields: "title,gridProperties.frozenRowCount,gridProperties.hideGridlines" } },
    ...definitions.slice(1).map(definition => ({ addSheet: { properties: { title: definition.name, gridProperties: { frozenRowCount: 1, frozenColumnCount: definition.name === "Overview" ? 0 : 1, hideGridlines: true } } } })),
  ];
  await googleFetch(token, `${SHEETS_API}/${created.id}:batchUpdate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requests }) });
  const updated = await (await googleFetch(token, `${SHEETS_API}/${created.id}?fields=sheets.properties`)).json();
  const idByName = new Map(updated.sheets.map((sheet: RecordValue) => [sheet.properties.title, sheet.properties.sheetId]));
  const writeRequests: RecordValue[] = [];
  for (const definition of definitions) {
    const rows = [definition.headers, ...definition.rows];
    writeRequests.push({ updateCells: { start: { sheetId: idByName.get(definition.name), rowIndex: 0, columnIndex: 0 }, rows: rows.map((row: any[], index: number) => ({ values: row.map(value => cell(value, index === 0)) })), fields: "userEnteredValue,userEnteredFormat" } });
    if (rows.length > 1) writeRequests.push({ setBasicFilter: { filter: { range: { sheetId: idByName.get(definition.name), startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: definition.headers.length } } } });
    writeRequests.push({ autoResizeDimensions: { dimensions: { sheetId: idByName.get(definition.name), dimension: "COLUMNS", startIndex: 0, endIndex: definition.headers.length } } });
  }
  await googleFetch(token, `${SHEETS_API}/${created.id}:batchUpdate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requests: writeRequests }) });
  return created;
}

async function createConvertedReviewSheet(token: string, parentId: string, manifest: RecordValue, data: RecordValue, sourceRunId: string) {
  const title = `Aterra Bol Retailer ${manifest.week.label} automated data review`;
  const existing = await findDriveFile(token, parentId, title, "application/vnd.google-apps.spreadsheet");
  if (existing?.appProperties?.sourceRunId === sourceRunId && existing.appProperties?.reportState === "complete") return existing;
  if (existing) await googleFetch(token, `${DRIVE_API}/files/${existing.id}`, { method: "DELETE" });

  const definitions = [
    { name: "Overview", headers: ["Metric", "Value", "Reviewer note"], rows: [["Report week", manifest.week.label, ""], ["Period", `${manifest.week.start} to ${manifest.week.end}`, ""], ["Cloud run", manifest.status, ""], ["Products", data.products.length, ""], ["Net shipped GMS", round(data.products.reduce((sum: number, row: any[]) => sum + Number(row[3] || 0), 0)), ""], ["Units sold", data.products.reduce((sum: number, row: any[]) => sum + Number(row[4] || 0), 0), ""], ["Product visits", data.products.reduce((sum: number, row: any[]) => sum + Number(row[6] || 0), 0), ""], ["Returns", data.products.reduce((sum: number, row: any[]) => sum + Number(row[9] || 0), 0), ""], ["Unmatched return items", data.unmatchedReturns, ""], ["API errors", manifest.summary?.apiErrors ?? 0, ""], ["JSON artifacts", EXPECTED_ARTIFACTS.length, ""]] },
    { name: "Products", headers: ["EAN", "Product", "Primary keyword", "Net shipped GMS", "Units sold", "ASP", "Product visits", "Trading conversion", "Revenue after commission", "Returns", "Unresolved returns", "Sponsored weekly rank", "Organic weekly rank", "Reviewer note"], rows: data.products },
    { name: "Weekly ranks", headers: ["ISO week", "EAN", "Locale", "Keyword", "Raw variants", "Placement", "Observations", "Days observed", "Impressions", "Weekly rank", "Best rank", "Worst rank", "Reviewer note"], rows: data.weeklyRanks },
    { name: "Daily ranks", headers: ["Date", "ISO week", "EAN", "Locale", "Raw keyword", "Normalized keyword", "Placement", "Rank", "Impressions", "Reviewer note"], rows: data.dailyRanks },
    { name: "Shipments", headers: ["ISO week", "Shipment datetime", "Shipment ID", "Order ID", "Order placed datetime", "Order item ID", "EAN", "Transport ID", "Verification status", "Reviewer note"], rows: data.shipments },
    { name: "Returns", headers: ["ISO week", "Registered datetime", "Return ID", "RMA ID", "Order ID", "EAN", "Quantity", "Handled", "Main reason", "Detailed reason", "Privacy treatment", "Reviewer note"], rows: data.returns },
    { name: "Offers", headers: ["EAN", "Product", "Last modified", "On hold", "Stock", "Corrected stock", "For sale in", "Unit price", "Fulfilment", "Schedule", "Reviewer note"], rows: data.offers },
    { name: "Operations", headers: ["Dataset", "Status", "Rows", "Meaning"], rows: data.operations },
    { name: "Financial", headers: ["Dataset", "Rows"], rows: data.financial },
    { name: "API quality", headers: ["Call", "Method", "Path", "HTTP status", "OK", "Duration ms", "Rows", "Page", "Pagination complete", "Rate limit", "Remaining", "Reset"], rows: data.calls },
    { name: "Source index", headers: ["Artifact", "Supabase path", "Bytes", "SHA-256", "Checksum", "Drive file"], rows: data.sources },
  ];
  const workbook = XLSX.utils.book_new();
  for (const definition of definitions) {
    const worksheet = XLSX.utils.aoa_to_sheet([definition.headers, ...definition.rows]);
    worksheet["!autofilter"] = { ref: worksheet["!ref"] || `A1:${String.fromCharCode(64 + definition.headers.length)}1` };
    worksheet["!cols"] = definition.headers.map((header: string) => ({ wch: Math.min(42, Math.max(12, header.length + 2)) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, definition.name);
  }
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
  const boundary = `aterra-sheet-${crypto.randomUUID()}`;
  const metadata = { name: title, mimeType: "application/vnd.google-apps.spreadsheet", parents: [parentId], appProperties: { sourceRunId, reportKind: "bol_retailer_weekly_review", reportState: "complete" } };
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const payload = new Uint8Array(prefix.length + bytes.length + suffix.length);
  payload.set(prefix);
  payload.set(bytes, prefix.length);
  payload.set(suffix, prefix.length + bytes.length);
  return (await googleFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents,appProperties", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body: payload,
  })).json();
}

async function createPolishedReviewSheet(token: string, parentId: string, manifest: RecordValue, data: RecordValue, sourceRunId: string) {
  const title = `Aterra Bol Retailer ${manifest.week.label} data review`;
  const existing = await findDriveFile(token, parentId, title, "application/vnd.google-apps.spreadsheet");
  if (existing?.appProperties?.sourceRunId === sourceRunId && existing.appProperties?.reportState === "complete") return existing;
  if (existing?.appProperties?.reportKind === "bol_retailer_weekly_review") await googleFetch(token, `${DRIVE_API}/files/${existing.id}`, { method: "DELETE" });
  const outputTitle = existing && !existing.appProperties?.reportKind ? `${title} automated replacement` : title;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aterra Retailer cloud automation";
  workbook.created = new Date();
  const font = { name: "Arial", size: 10, color: { argb: "FF202124" } };
  const border = { style: "thin" as const, color: { argb: "FFDADCE0" } };
  const tabs = ["Overview", "Products", "Weekly ranks", "Daily ranks", "Shipments", "Returns", "Offers", "API quality", "Source index"];
  for (const name of tabs) workbook.addWorksheet(name, { views: [{ showGridLines: false }] });

  function setup(name: string, heading: string, context: string) {
    const sheet = workbook.getWorksheet(name)!;
    sheet.getCell("A2").value = heading;
    sheet.getCell("A2").font = { ...font, size: 14, bold: true };
    sheet.getCell("A3").value = context;
    sheet.getCell("A3").font = { ...font, italic: true, color: { argb: "FF5F6368" } };
    return sheet;
  }

  function table(sheet: any, headers: string[], rows: any[][], widths: number[], frozenColumns = 2) {
    const startRow = 6;
    sheet.addTable({ name: `${sheet.name.replace(/[^A-Za-z0-9]/g, "")}Table`, ref: `A${startRow}`, headerRow: true, totalsRow: false, style: { theme: "TableStyleLight1", showRowStripes: false }, columns: headers.map(name => ({ name })), rows });
    sheet.views = [{ state: "frozen", xSplit: frozenColumns, ySplit: startRow, showGridLines: false }];
    headers.forEach((_, index) => { sheet.getColumn(index + 1).width = widths[index] || 16; });
    const header = sheet.getRow(startRow);
    header.height = 21;
    header.eachCell((cell: any) => { cell.font = { ...font, bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAED" } }; cell.alignment = { horizontal: "center", vertical: "middle" }; });
    for (let row = startRow; row <= startRow + rows.length; row += 1) sheet.getRow(row).eachCell((cell: any) => { cell.font = font; cell.alignment = { vertical: "middle" }; cell.border = { bottom: border }; });
    return { startRow, firstDataRow: startRow + 1, lastDataRow: startRow + rows.length };
  }

  const overview = setup("Overview", "Aterra Bol Retailer data review", `${manifest.week.label} | ${manifest.week.start} to ${manifest.week.end}`);
  const totalGms = round(data.products.reduce((sum: number, row: any[]) => sum + Number(row[3] || 0), 0));
  const totalUnits = data.products.reduce((sum: number, row: any[]) => sum + Number(row[4] || 0), 0);
  const totalVisits = data.products.reduce((sum: number, row: any[]) => sum + Number(row[6] || 0), 0);
  const totalRevenue = round(data.products.reduce((sum: number, row: any[]) => sum + Number(row[8] || 0), 0));
  const totalReturns = data.products.reduce((sum: number, row: any[]) => sum + Number(row[9] || 0), 0);
  const rankDates = new Set(data.dailyRanks.map((row: any[]) => row[0])).size;
  const metrics = [["Products", data.products.length], ["Net shipped GMS", totalGms], ["Units sold", totalUnits], ["Product visits", totalVisits], ["Trading conversion", totalVisits ? totalUnits / totalVisits : "n.a."], ["Revenue after commission", totalRevenue], ["Returns", totalReturns], ["Rank dates covered", rankDates], ["API errors", manifest.summary?.apiErrors ?? 0]];
  overview.addTable({ name: "OverviewMetricsTable", ref: "A5", headerRow: true, totalsRow: false, style: { theme: "TableStyleLight1", showRowStripes: false }, columns: [{ name: "Metric" }, { name: "Value" }], rows: metrics });
  overview.getCell("B7").numFmt = "€#,##0.00";
  overview.getCell("B10").numFmt = "0.0%";
  overview.getCell("B11").numFmt = "€#,##0.00";
  overview.addTable({ name: "QualityStatusTable", ref: "D5", headerRow: true, totalsRow: false, style: { theme: "TableStyleLight1", showRowStripes: false }, columns: [{ name: "Data-quality status" }, { name: "Detail" }, { name: "Reviewer note" }], rows: [["Cloud run", manifest.status, ""], ["Rank coverage", `${rankDates}/7 dates`, ""], ["Returns", `${data.unmatchedReturns} unmatched return item`, ""], ["Conversion", "Shipped units divided by Bol Product Visits", ""], ["Drive source JSON", "7 sanitized, checksum-verified files uploaded", ""]] });
  overview.getCell("A17").value = "How to use this workbook";
  overview.getCell("A17").font = { ...font, bold: true };
  [["1", "Use Products for weekly product economics."], ["2", "Filter Daily ranks by EAN, keyword, locale and placement to verify visibility."], ["3", "Use the final Reviewer note columns without changing API values."]].forEach((row, index) => { overview.getCell(`A${18 + index}`).value = row[0]; overview.getCell(`B${18 + index}`).value = row[1]; });
  [22, 16, 4, 18, 42, 26].forEach((width, index) => { overview.getColumn(index + 1).width = width; });
  overview.views = [{ showGridLines: false }];

  const productRows = data.products.map((row: any[]) => [row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[6] === null ? "Unavailable" : "Verified: units / visits", row[8], row[9], row[10], row[11], row[12], ""]);
  const products = setup("Products", "Weekly product metrics", `Values are derived from the sanitized ${manifest.week.label} Retailer API snapshot.`);
  const productRange = table(products, ["EAN", "Product", "Primary keyword", "Net shipped GMS", "Units sold", "ASP", "Product visits", "Trading conversion", "Conversion status", "Revenue after commission", "Returns", "Unresolved returns", "Sponsored weekly rank", "Organic weekly rank", "Reviewer note"], productRows, [16, 25, 19, 17, 12, 14, 15, 18, 24, 23, 12, 18, 23, 21, 27]);
  for (let row = productRange.firstDataRow; row <= productRange.lastDataRow; row += 1) { products.getCell(row, 4).numFmt = "€#,##0.00"; products.getCell(row, 6).numFmt = "€#,##0.00"; products.getCell(row, 8).numFmt = "0.0%"; products.getCell(row, 10).numFmt = "€#,##0.00"; products.getCell(row, 11).numFmt = "#,##0.0"; products.getCell(row, 12).numFmt = "#,##0.0"; }

  const weekly = setup("Weekly ranks", "Weekly keyword ranks", "One row per EAN, locale, normalized keyword and placement.");
  table(weekly, ["ISO week", "EAN", "Locale", "Keyword", "Raw variants", "Placement", "Observations", "Days observed", "Impressions", "Weekly rank", "Best rank", "Worst rank", "Reviewer note"], data.weeklyRanks, [14, 16, 12, 22, 22, 14, 14, 15, 14, 15, 13, 14, 27]);
  const daily = setup("Daily ranks", "Daily keyword-rank observations", "Observed rows only. Successful empty calls are listed on API quality.");
  table(daily, ["Date", "ISO week", "EAN", "Locale", "Raw keyword", "Normalized keyword", "Placement", "Rank", "Impressions", "Reviewer note"], data.dailyRanks, [15, 14, 16, 12, 22, 22, 14, 12, 14, 27], 3);
  const shipments = setup("Shipments", "Shipment evidence", "Identifiers are redacted in the sanitized snapshot.");
  table(shipments, ["ISO week", "Shipment datetime", "Shipment ID", "Order ID", "Order placed datetime", "Order item ID", "EAN", "Transport ID", "Verification status", "Reviewer note"], data.shipments, [14, 22, 19, 19, 22, 19, 16, 19, 19, 27]);
  const returns = setup("Returns", "Return evidence", "Customer comments are deliberately excluded from this workbook.");
  table(returns, ["ISO week", "Registered datetime", "Return ID", "RMA ID", "Order ID", "EAN", "Quantity", "Handled", "Main reason", "Detailed reason", "Privacy treatment", "Reviewer note"], data.returns, [14, 22, 19, 19, 19, 16, 12, 12, 24, 24, 27, 27]);
  const offers = setup("Offers", "Current offer and inventory state", `Current-state capture for ${manifest.week.label}.`);
  table(offers, ["EAN", "Product", "Last modified", "On hold", "Stock", "Corrected stock", "For sale in", "Unit price", "Fulfilment", "Schedule", "Reviewer note"], data.offers, [16, 25, 22, 12, 12, 18, 16, 14, 15, 18, 27]);
  const quality = setup("API quality", "API calls and completeness", "Use this tab to verify pagination, errors, empty rank calls and rate-limit evidence.");
  table(quality, ["Call", "Method", "Path", "HTTP status", "OK", "Duration ms", "Rows", "Page", "Pagination complete", "Rate limit", "Remaining", "Reset"], data.calls, [29, 12, 38, 15, 10, 15, 12, 10, 21, 14, 14, 18], 3);
  const sources = setup("Source index", "Source manifest and checksums", "Supabase manifest is authoritative; Drive files are exact sanitized copies.");
  const sourceRows = data.sources.map((row: any[]) => [row[0], row[1], row[2], row[3], row[3], row[4], "Uploaded and verified", ""]);
  table(sources, ["Artifact", "Supabase path", "Bytes", "Manifest SHA-256", "Downloaded SHA-256", "Checksum result", "Drive status", "Reviewer note"], sourceRows, [20, 52, 14, 52, 52, 18, 25, 27], 1);

  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => { if (!cell.font?.name) cell.font = font; cell.alignment = { ...cell.alignment, vertical: "middle" }; })));
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  const boundary = `aterra-sheet-${crypto.randomUUID()}`;
  const metadata = { name: outputTitle, mimeType: "application/vnd.google-apps.spreadsheet", parents: [parentId], appProperties: { sourceRunId, reportKind: "bol_retailer_weekly_review", reportState: "complete", templateVersion: "manual-review-v1" } };
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const payload = new Uint8Array(prefix.length + bytes.length + suffix.length);
  payload.set(prefix); payload.set(bytes, prefix.length); payload.set(suffix, prefix.length + bytes.length);
  return (await googleFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents,appProperties", { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body: payload })).json();
}

Deno.serve(async request => {
  const startedAt = Date.now();
  if (request.method !== "POST") return response({ status: "method_not_allowed" }, 405);
  const provided = request.headers.get("x-aterra-cron-token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!provided || provided !== env("BOL_RETAILER_CRON_TOKEN")) return response({ status: "unauthorized" }, 401);
  let body: RecordValue;
  try { body = await request.json(); } catch { return response({ status: "invalid_request" }, 400); }
  if (body.action === "report_email") {
    const brokeredToken = request.headers.get("x-google-access-token")?.trim();
    if (!brokeredToken) return response({ status: "invalid_request", reason: "Missing brokered Google access token." }, 400);
    try {
      const sent = await sendRetailerReportEmail(brokeredToken, body);
      return response({ status: "complete", id: sent.id });
    } catch (error) {
      return response({ status: "failed", stage: "report_email", message: error instanceof Error ? error.message : "Email failed." }, 500);
    }
  }
  const trigger = String(body.trigger || "manual");
  const nowAmsterdam = dateInAmsterdam();
  const expectedLocalHour = Number(body.expectedLocalHour ?? 9);
  if (trigger === "cron" && body.force !== true && !(nowAmsterdam.weekday === "Mon" && nowAmsterdam.hour === expectedLocalHour && nowAmsterdam.minute < 30)) return response({ status: "skipped", reason: "Cron guard", amsterdamTime: nowAmsterdam });
  const supabase = createClient(env("SUPABASE_URL"), serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const period = previousCompletedWeek(nowAmsterdam.date);
  let query = supabase.from(SOURCE_TABLE).select("*").eq("status", "complete");
  query = body.sourceRunId ? query.eq("id", body.sourceRunId) : query.eq("period_start", period.start).eq("period_end", period.end).order("completed_at", { ascending: false }).limit(1);
  const { data: sourceRun, error: sourceError } = await query.maybeSingle();
  if (sourceError) return response({ status: "error", stage: "source_lookup" }, 503);
  if (!sourceRun) return response({ status: body.retryOnly ? "no_source_yet" : "blocked", reason: "No complete Retailer source run exists for the previous week." }, body.retryOnly ? 200 : 409);
  const { data: existing } = await supabase.from(BACKUP_TABLE).select("*").eq("source_run_id", sourceRun.id).maybeSingle();
  if (existing?.status === "complete" && body.rebuildSheet !== true) return response({ status: "already_complete", backup: existing });
  if (existing?.status === "running" && Date.parse(existing.started_at) > Date.now() - 20 * 60_000) return response({ status: "already_running" }, 202);
  const backupId = existing?.id || crypto.randomUUID();
  const base = { id: backupId, source_run_id: sourceRun.id, status: "running", iso_year: sourceRun.iso_year, iso_week: sourceRun.iso_week, period_start: sourceRun.period_start, period_end: sourceRun.period_end, trigger_source: trigger, started_at: new Date().toISOString(), completed_at: null, error_stage: null, error_detail: null };
  const { error: startError } = existing ? await supabase.from(BACKUP_TABLE).update(base).eq("id", backupId) : await supabase.from(BACKUP_TABLE).insert(base);
  if (startError) return response({ status: "error", stage: "backup_log" }, 503);
  let stage = "manifest";
  try {
    const manifestFile = await downloadJson(supabase, sourceRun.storage_path);
    const manifest = manifestFile.json as RecordValue;
    if (manifest.status !== "complete" || manifest.runId !== sourceRun.id || !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 6) throw new Error("Source manifest is incomplete or does not match the run.");
    const files: Record<string, RecordValue> = { "manifest.json": manifest };
    const bytesByName: Record<string, Uint8Array> = { "manifest.json": manifestFile.bytes };
    const sourcePathByName: Record<string, string> = { "manifest.json": sourceRun.storage_path };
    for (const artifact of manifest.artifacts) {
      const name = `${artifact.name}.json`;
      const downloaded = await downloadJson(supabase, artifact.path);
      if (await sha256(downloaded.bytes) !== artifact.sha256 || downloaded.bytes.length !== artifact.bytes) throw new Error(`Checksum verification failed for ${name}.`);
      files[name] = downloaded.json;
      bytesByName[name] = downloaded.bytes;
      sourcePathByName[name] = artifact.path;
    }
    if (EXPECTED_ARTIFACTS.some(name => !files[name])) throw new Error("Expected source artifact set is incomplete.");
    stage = "privacy_validation";
    for (const [name, value] of Object.entries(files)) assertSanitized(value, name);
    stage = "google_auth";
    const brokeredToken = request.headers.get("x-google-access-token")?.trim();
    const token = brokeredToken || await googleAccessToken(supabase);
    stage = "drive_folders";
    const root = env("GOOGLE_DRIVE_RETAILER_ROOT_FOLDER_ID");
    const yearFolder = await ensureDriveFolder(token, root, String(sourceRun.iso_year));
    const weekFolder = await ensureDriveFolder(token, yearFolder.id, `W${String(sourceRun.iso_week).padStart(2, "0")}`);
    const sourceFolder = await ensureDriveFolder(token, weekFolder.id, "source-json");
    const reportFolder = await ensureDriveFolder(token, weekFolder.id, "report");
    stage = "drive_upload";
    const driveFiles = [];
    for (const name of EXPECTED_ARTIFACTS) {
      const uploaded = await uploadDriveFile(token, sourceFolder.id, name, "application/json", bytesByName[name], { sourceRunId: sourceRun.id, reportKind: "bol_retailer_source", sourceSha256: await sha256(bytesByName[name]) });
      driveFiles.push({ name, id: uploaded.id, webViewLink: uploaded.webViewLink, bytes: bytesByName[name].length, sha256: await sha256(bytesByName[name]), sourcePath: sourcePathByName[name] });
    }
    stage = "sheet";
    const data = reviewData(files, manifest, driveFiles);
    const sheet = await createPolishedReviewSheet(token, reportFolder.id, manifest, data, sourceRun.id);
    const { error: finishError } = await supabase.from(BACKUP_TABLE).update({ status: "complete", drive_year_folder_id: yearFolder.id, drive_week_folder_id: weekFolder.id, drive_week_folder_url: weekFolder.webViewLink, drive_source_folder_id: sourceFolder.id, drive_report_folder_id: reportFolder.id, google_sheet_id: sheet.id, google_sheet_url: sheet.webViewLink, artifact_count: driveFiles.length, checksums_verified: true, total_bytes: driveFiles.reduce((sum, file) => sum + file.bytes, 0), completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt }).eq("id", backupId);
    if (finishError) throw new Error(`Backup finalization failed: ${finishError.message}`);
    return response({ status: "complete", backupId, sourceRunId: sourceRun.id, week: manifest.week, artifactCount: driveFiles.length, driveFolderUrl: weekFolder.webViewLink, googleSheetUrl: sheet.webViewLink });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retailer Drive backup failed.";
    await supabase.from(BACKUP_TABLE).update({ status: "failed", error_stage: stage, error_detail: message, completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt }).eq("id", backupId);
    return response({ status: "failed", backupId, stage, message }, 500);
  }
});
