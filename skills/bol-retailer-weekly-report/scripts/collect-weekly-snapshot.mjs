#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_KEYWORDS_PATH = path.join(SKILL_DIR, "references", "product-keywords.json");
const TOKEN_URL = "https://login.bol.com/token?grant_type=client_credentials";
const API_URL = "https://api.bol.com/retailer";
const ACCEPT_V10 = "application/vnd.retailer.v10+json";
const ACCEPT_V11 = "application/vnd.retailer.v11+json";
const USER_AGENT = "Aterra-Retailer-Weekly-Collector/1.0";

function parseArgs(argv) {
  const args = {
    start: null,
    end: null,
    outDir: null,
    output: null,
    keywords: DEFAULT_KEYWORDS_PATH,
    locales: null,
    maxPages: 20,
    rankMode: "primary",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--start") args.start = argv[++i];
    else if (value === "--end") args.end = argv[++i];
    else if (value === "--out-dir") args.outDir = argv[++i];
    else if (value === "--output") args.output = argv[++i];
    else if (value === "--keywords") args.keywords = argv[++i];
    else if (value === "--locales") args.locales = argv[++i].split(",").map(item => item.trim()).filter(Boolean);
    else if (value === "--max-pages") args.maxPages = Number(argv[++i]);
    else if (value === "--rank-mode") args.rankMode = argv[++i];
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--help" || value === "-h") {
      console.log(`Usage:
  node collect-weekly-snapshot.mjs --start <YYYY-MM-DD> --end <YYYY-MM-DD> --out-dir <docs-dir> [options]

Options:
  --output <file>             Exact output path. Overrides --out-dir naming.
  --keywords <json>           Product keyword/watchlist config.
  --locales nl-NL,nl-BE       Override locales from keyword config.
  --max-pages <n>             Safety cap for page-based endpoints. Default: 20.
  --rank-mode primary|none    Collect daily product-rank calls for configured product EANs. Default: primary.
  --dry-run                   Fetch and validate, but do not write the snapshot file.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!args.start || !args.end) throw new Error("Missing --start and --end.");
  if (!args.output && !args.outDir) throw new Error("Missing --out-dir or --output.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.start) || !/^\d{4}-\d{2}-\d{2}$/.test(args.end)) {
    throw new Error("--start and --end must use YYYY-MM-DD.");
  }
  if (!Number.isInteger(args.maxPages) || args.maxPages < 1 || args.maxPages > 200) {
    throw new Error("--max-pages must be an integer from 1 to 200.");
  }
  if (!["primary", "none"].includes(args.rankMode)) throw new Error("--rank-mode must be primary or none.");
  return args;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not available in the managed environment.`);
  return value;
}

function isoDate(value) {
  return String(value || "").slice(0, 10);
}

function inRange(dateLike, start, end) {
  const date = isoDate(dateLike);
  return date >= start && date <= end;
}

function weekLabel(start) {
  const date = new Date(`${start}T00:00:00.000Z`);
  const thursday = new Date(date);
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function datesBetween(start, end) {
  const dates = [];
  const current = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (current <= last && dates.length < 31) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rateHeaders(headers) {
  const get = name => headers.get(name) || headers.get(name.toLowerCase()) || null;
  return {
    limit: get("x-ratelimit-limit"),
    remaining: get("x-ratelimit-remaining"),
    reset: get("x-ratelimit-reset"),
    retryAfter: get("retry-after"),
  };
}

function redactIdentifier(value) {
  const text = String(value || "");
  if (text.length <= 8) return text ? "<redacted>" : text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sanitize(value, key = "") {
  const lower = key.toLowerCase();
  if (["shipmentdetails", "billingdetails", "customercomments", "trackandtrace", "email", "emailaddress", "phonenumber", "signature", "secret", "clientsecret", "access_token", "privatekey"].includes(lower)) return "<redacted>";
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (["orderId", "orderItemId", "shipmentId", "returnId", "rmaId", "transportId", "offerId", "invoiceId"].includes(childKey)) {
      result[childKey] = redactIdentifier(childValue);
    } else {
      result[childKey] = sanitize(childValue, childKey);
    }
  }
  return result;
}

function callSummary({ label, method, pathname, status, ok, startedAt, response, rows, page, cursor, paginationComplete }) {
  return {
    label,
    method,
    path: pathname,
    status,
    ok,
    ms: Date.now() - startedAt,
    rows,
    page,
    cursor: cursor ? "<present>" : null,
    paginationComplete,
    rate: response ? rateHeaders(response.headers) : null,
  };
}

async function getToken() {
  const clientId = requiredEnvironment("BOL_RETAILER_CLIENT_ID");
  const clientSecret = requiredEnvironment("BOL_RETAILER_CLIENT_SECRET");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "user-agent": USER_AGENT,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Bol authentication failed with HTTP ${response.status}.`);
  return body.access_token;
}

async function retailerRequest(state, { label, path: pathname, method = "GET", accept = ACCEPT_V10, body, query, language }) {
  const url = new URL(`${API_URL}${pathname}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const startedAt = Date.now();
    const response = await fetch(url, {
      method,
      headers: {
        accept,
        ...(body ? { "content-type": accept } : {}),
        ...(language ? { "accept-language": language } : {}),
        authorization: `Bearer ${state.token}`,
        "user-agent": USER_AGENT,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const retrySeconds = Math.min(10, Number(response.headers.get("retry-after")) || attempt);
      state.apiCalls.push(callSummary({ label, method, pathname, status: response.status, ok: false, startedAt, response }));
      await sleep(retrySeconds * 1000);
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    state.apiCalls.push(callSummary({ label, method, pathname, status: response.status, ok: response.ok, startedAt, response }));
    return { status: response.status, ok: response.ok, payload };
  }
  return { status: 429, ok: false, payload: {} };
}

function rowsFromPage(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function collectPageEndpoint(state, { pathname, label, rowKeys, query = {}, accept = ACCEPT_V10, stopWhenOlderThanStart = null }) {
  const rows = [];
  for (let page = 1; page <= state.args.maxPages; page += 1) {
    const result = await retailerRequest(state, { label: `${label}.page${page}`, path: pathname, accept, query: { ...query, page } });
    const pageRows = rowsFromPage(result.payload, rowKeys);
    state.apiCalls[state.apiCalls.length - 1].rows = pageRows.length;
    state.apiCalls[state.apiCalls.length - 1].page = page;
    rows.push(...pageRows);
    if (!result.ok || pageRows.length === 0 || pageRows.length < 50) {
      state.apiCalls[state.apiCalls.length - 1].paginationComplete = true;
      break;
    }
    if (stopWhenOlderThanStart && pageRows.every(row => isoDate(row[stopWhenOlderThanStart]) < state.args.start)) {
      state.apiCalls[state.apiCalls.length - 1].paginationComplete = true;
      break;
    }
    await sleep(150);
  }
  return rows;
}

async function collectOffers(state) {
  const offers = [];
  let cursor = null;
  for (let page = 1; page <= state.args.maxPages; page += 1) {
    const result = await retailerRequest(state, {
      label: `offers.page${page}`,
      path: "/offers",
      accept: ACCEPT_V11,
      query: { "page-size": 100, cursor },
    });
    const rows = rowsFromPage(result.payload, ["offers"]);
    const nextCursor = result.payload?.page?.nextCursor || result.payload?.nextCursor || null;
    Object.assign(state.apiCalls[state.apiCalls.length - 1], {
      rows: rows.length,
      cursor,
      paginationComplete: !nextCursor,
    });
    offers.push(...rows);
    if (!result.ok || !nextCursor) break;
    cursor = nextCursor;
    await sleep(150);
  }
  return offers;
}

async function collectOfferInsights(state, offers) {
  const rows = [];
  for (const offer of offers) {
    if (!offer.offerId) continue;
    for (const metric of ["PRODUCT_VISITS", "BUY_BOX_PERCENTAGE"]) {
      const result = await retailerRequest(state, {
        label: `insights.offer.${redactIdentifier(offer.offerId)}.${metric}`,
        path: "/insights/offer",
        query: { "offer-id": offer.offerId, period: "DAY", "number-of-periods": 7, name: metric },
      });
      const periods = rowsFromPage(result.payload, ["periods", "offerInsights", "insights"]);
      const weekTotal = periods.reduce((sum, row) => sum + Number(row.total || row.value || row.count || 0), 0);
      rows.push({
        ean: offer.ean,
        offerId: redactIdentifier(offer.offerId),
        metric,
        period: "DAY",
        numberOfPeriods: 7,
        weekTotal,
        sample: sanitize(result.payload),
        status: result.status,
      });
      state.apiCalls[state.apiCalls.length - 1].rows = periods.length;
      await sleep(80);
    }
  }
  return rows;
}

async function collectProductRanks(state, eans, locales) {
  if (state.args.rankMode === "none") return [];
  const results = [];
  for (const ean of eans) {
    for (const date of datesBetween(state.args.start, state.args.end)) {
      for (const locale of locales) {
        let page = 1;
        while (page <= state.args.maxPages) {
          const result = await retailerRequest(state, {
            label: `rank.${ean}.${date}.${locale}.page${page}`,
            path: "/insights/product-ranks",
            query: { ean, date, type: "SEARCH", page },
            language: locale,
          });
          const ranks = rowsFromPage(result.payload, ["ranks"]);
          const hasNextPage = result.payload?.hasNextPage === true;
          Object.assign(state.apiCalls[state.apiCalls.length - 1], {
            rows: ranks.length,
            page,
            paginationComplete: !hasNextPage,
          });
          results.push({
            ean,
            date,
            locale,
            type: "SEARCH",
            page,
            status: result.status,
            sample: {
              ranks: sanitize(ranks),
              hasNextPage,
            },
          });
          if (!result.ok || !hasNextPage) break;
          page += 1;
          await sleep(125);
        }
        await sleep(125);
      }
    }
  }
  return results;
}

function summarizeByEan(orderDetails) {
  const byEan = {};
  for (const row of orderDetails) {
    const detail = row.detail || {};
    const orderId = detail.orderId || row.orderId;
    for (const item of detail.orderItems || []) {
      const ean = item.product?.ean || item.ean;
      if (!ean) continue;
      const current = byEan[ean] || { orders: 0, shipments: 0, lines: 0, units: 0, grossOrderValue: 0, commission: 0, orderIds: new Set() };
      const quantity = Number(item.quantityShipped || item.quantity || 0);
      const lineValue = item.totalPrice !== undefined && item.totalPrice !== null
        ? Number(item.totalPrice || 0)
        : Number(item.unitPrice || 0) * quantity;
      current.orderIds.add(orderId);
      current.lines += 1;
      current.units += quantity;
      current.grossOrderValue += lineValue;
      current.commission += Number(item.commission || 0);
      byEan[ean] = current;
    }
  }
  return Object.fromEntries(Object.entries(byEan).map(([ean, value]) => [ean, {
    orders: value.orderIds.size,
    shipments: value.orderIds.size,
    lines: value.lines,
    units: value.units,
    grossOrderValue: Math.round((value.grossOrderValue + Number.EPSILON) * 100) / 100,
    commission: Math.round((value.commission + Number.EPSILON) * 100) / 100,
  }]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keywords = JSON.parse(await fs.readFile(args.keywords, "utf8"));
  const locales = args.locales || keywords.locales || ["nl-NL"];
  const state = { args, token: await getToken(), apiCalls: [] };

  const shipments = await collectPageEndpoint(state, {
    pathname: "/shipments",
    label: "shipments",
    rowKeys: ["shipments"],
    stopWhenOlderThanStart: "shipmentDateTime",
  });
  const weekShipments = shipments.filter(row => inRange(row.shipmentDateTime, args.start, args.end));
  const shipmentDetails = [];
  const orderDetails = [];
  for (const shipment of weekShipments) {
    if (!shipment.shipmentId) continue;
    const shipmentDetail = await retailerRequest(state, {
      label: `shipment.detail.${redactIdentifier(shipment.shipmentId)}`,
      path: `/shipments/${encodeURIComponent(shipment.shipmentId)}`,
    });
    shipmentDetails.push({ shipmentId: redactIdentifier(shipment.shipmentId), status: shipmentDetail.status, detail: sanitize(shipmentDetail.payload) });
    const orderId = shipmentDetail.payload?.order?.orderId || shipment.order?.orderId;
    if (orderId) {
      const orderDetail = await retailerRequest(state, {
        label: `order.detail.${redactIdentifier(orderId)}`,
        path: `/orders/${encodeURIComponent(orderId)}`,
      });
      orderDetails.push({ orderId: redactIdentifier(orderId), status: orderDetail.status, detail: sanitize(orderDetail.payload) });
    }
    await sleep(80);
  }

  const returns = await collectPageEndpoint(state, { pathname: "/returns", label: "returns", rowKeys: ["returns"] });
  const weekReturns = returns.filter(row => inRange(row.registrationDateTime, args.start, args.end));
  const unhandledReturnsResult = await retailerRequest(state, {
    label: "returns.unhandled.page1",
    path: "/returns",
    query: { handled: false, page: 1 },
  });
  const unhandledReturns = rowsFromPage(unhandledReturnsResult.payload, ["returns"]);
  state.apiCalls[state.apiCalls.length - 1].rows = unhandledReturns.length;

  const offers = await collectOffers(state);
  const configuredEans = Object.keys(keywords.products || {});
  const offerEans = offers.map(offer => offer.ean).filter(Boolean);
  const eans = [...new Set([...configuredEans, ...offerEans, ...Object.keys(summarizeByEan(orderDetails))])].sort();
  const offerInsights = await collectOfferInsights(state, offers.filter(offer => eans.includes(offer.ean)));
  const productRanks = await collectProductRanks(state, eans, locales);

  const snapshot = {
    week: { label: weekLabel(args.start), start: args.start, end: args.end },
    generatedAt: new Date().toISOString(),
    basis: "Read-only Bol Retailer API weekly collector. No dashboard, database, scheduled job, email automation, Bol write endpoint, or Advertising API workflow changed.",
    summary: {
      shipments: weekShipments.length,
      uniqueOrdersFromShipments: new Set(orderDetails.map(row => row.orderId)).size,
      shipmentLines: shipmentDetails.reduce((sum, row) => sum + Number(row.detail?.shipmentItems?.length || 0), 0),
      units: Object.values(summarizeByEan(orderDetails)).reduce((sum, row) => sum + row.units, 0),
      grossOrderValue: Object.values(summarizeByEan(orderDetails)).reduce((sum, row) => sum + row.grossOrderValue, 0),
      orderLineCommission: Object.values(summarizeByEan(orderDetails)).reduce((sum, row) => sum + row.commission, 0),
      returns: weekReturns.length,
      unhandledReturns: unhandledReturns.length,
      currentOffers: offers.length,
      productEansFromOffers: new Set(offerEans).size,
      apiCalls: state.apiCalls.length,
      apiErrors: state.apiCalls.filter(call => Number(call.status || 200) >= 400).length,
    },
    completeness: {
      note: "Offer insights are collected as the latest seven daily periods; Bol does not accept an explicit historical week date on that endpoint.",
      rankMode: args.rankMode,
      locales,
      maxPages: args.maxPages,
    },
    operational: {
      byEan: summarizeByEan(orderDetails),
      shipments: sanitize(weekShipments),
      shipmentDetails,
      ordersFromShipmentDetails: orderDetails,
      returns: sanitize(weekReturns),
      unhandledReturns: sanitize(unhandledReturns),
    },
    currentState: {
      offers: sanitize(offers),
    },
    weekMetrics: {
      offerInsights,
    },
    apiCalls: state.apiCalls,
    additionalReadOnlySurfaces: {
      generatedAt: new Date().toISOString(),
      productRanks,
    },
  };

  const outputPath = args.output || path.join(args.outDir, `bol-retailer-api-${weekLabel(args.start)}-snapshot-${new Date().toISOString().slice(0, 10)}.json`);
  if (!args.dryRun) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify({
    status: args.dryRun ? "validated" : "written",
    outputPath: args.dryRun ? null : outputPath,
    week: snapshot.week,
    products: eans.length,
    apiCalls: state.apiCalls.length,
    apiErrors: snapshot.summary.apiErrors,
    warnings: snapshot.completeness.note ? [snapshot.completeness.note] : [],
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ status: "error", message: error.message }, null, 2));
  process.exit(1);
});
