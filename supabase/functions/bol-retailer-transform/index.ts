import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const TRANSFORM_VERSION = "retailer-transform-v1";
const SOURCE_CONTRACT_VERSION = "3.0";
const EXPECTED_ARTIFACTS = ["catalog", "commercial", "financial", "insights", "operations", "provenance"] as const;
const EXPECTED_RANK_LOCALES = new Set(["fr-BE", "nl-BE", "nl-NL"]);
const BUCKET = "bol-retailer-api-json";
const MAX_MESSAGES_PER_INVOCATION = 2;
const MAX_TRANSFORM_ATTEMPTS = 5;

type JsonRecord = Record<string, unknown>;
type SupabaseClient = ReturnType<typeof createClient>;
type Claim = {
  status: string;
  messageId: number;
  transformRunId: string;
  sourceRunId: string;
  sourceContractVersion: string;
  transformVersion: string;
  leaseToken: string;
  attemptNumber: number;
  isoYear: number;
  isoWeek: number;
  periodStart: string;
  periodEnd: string;
  storageBucket: string;
  manifestPath: string;
  manifestSha256: string;
  sourceStatus: string;
  sourceArtifactCount: number;
};

class PermanentTransformError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentTransformError";
    this.code = code;
  }
}

function retryPolicy(attemptNumber: number, permanent = false) {
  if (permanent) return { action: "reject", errorCode: "PERMANENT_TRANSFORM_FAILURE", delaySeconds: null };
  if (attemptNumber >= MAX_TRANSFORM_ATTEMPTS) return { action: "reject", errorCode: "RETRY_EXHAUSTED", delaySeconds: null };
  return {
    action: "retry",
    errorCode: "TRANSIENT_TRANSFORM_FAILURE",
    delaySeconds: Math.min(3600, 300 * Math.max(1, attemptNumber)),
  };
}

function fencedMutationSucceeded(data: unknown, error: unknown) {
  return !error && data === true;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function serviceRoleKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
      if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
      if (parsed && typeof parsed === "object") {
        const values = Object.values(parsed as JsonRecord).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
        if (values[0]) return values[0].trim();
      }
    } catch {
      if (secretKeys.startsWith("sb_secret_")) return secretKeys;
    }
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as JsonRecord[] : [];
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result ? result : null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function integer(value: unknown, fallback = 0): number {
  const result = numberValue(value);
  return result === null ? fallback : Math.trunc(result);
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString().slice(0, 10);
  const result = text(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(result)) return result.slice(0, 10);
  return null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  const result = text(value);
  if (!result) return null;
  const parsed = new Date(result);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function periodDate(value: JsonRecord): string | null {
  const direct = isoDate(value.date);
  if (direct) return direct;
  const period = record(value.period);
  const year = integer(period.year);
  const month = integer(period.month);
  const day = integer(period.day);
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function amount(value: unknown): number | null {
  if (typeof value === "number") return numberValue(value);
  const object = record(value);
  return numberValue(object.amount ?? object.value);
}

function currency(value: unknown): string | null {
  const object = record(value);
  return nullableText(object.currencyID ?? object.currency);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
}

function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fact<T extends JsonRecord>(
  fields: T,
  businessKey: string,
  artifactName: string,
  sourcePointer: string,
  observedAt: string,
  createdAt: string,
) {
  return {
    id: crypto.randomUUID(),
    business_key: businessKey,
    semantic_hash: await sha256Hex(stableStringify(fields)),
    ...fields,
    created_at: createdAt,
    _artifact_name: artifactName,
    _source_pointer: sourcePointer,
    _observed_at: observedAt,
  };
}

function check(
  checkCode: string,
  dataProduct: string,
  severity: "info" | "warning" | "error",
  result: "passed" | "warning" | "failed" | "not_applicable",
  message: string,
  expected: unknown = null,
  observed: unknown = null,
) {
  return { check_code: checkCode, data_product: dataProduct, severity, result, message, expected, observed };
}

function exception(
  code: string,
  dataProduct: string,
  severity: "info" | "warning" | "error",
  title: string,
  detail: string,
  input: { businessKey?: string; ean?: string; exposureAmount?: number | null; evidence?: unknown } = {},
) {
  return {
    id: crypto.randomUUID(),
    exception_code: code,
    data_product: dataProduct,
    severity,
    business_key: input.businessKey || null,
    ean: input.ean || null,
    title,
    detail,
    exposure_amount: input.exposureAmount ?? null,
    evidence: input.evidence || {},
  };
}

async function downloadObject(supabase: SupabaseClient, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`storage_download: ${path}: ${error?.message || "empty response"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, text: new TextDecoder().decode(bytes), sha256: await sha256Hex(bytes) };
}

function parseJson(textValue: string, label: string): JsonRecord {
  try {
    const parsed = JSON.parse(textValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root is not an object");
    return parsed as JsonRecord;
  } catch (error) {
    throw new PermanentTransformError("INVALID_JSON", `${label} is not valid JSON: ${error instanceof Error ? error.message : "parse failure"}`);
  }
}

function assertContract(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new PermanentTransformError(code, message);
}

async function loadVerifiedPackage(supabase: SupabaseClient, claim: Claim) {
  assertContract(claim.storageBucket === BUCKET, "UNEXPECTED_BUCKET", `Expected ${BUCKET}, received ${claim.storageBucket}.`);
  const manifestObject = await downloadObject(supabase, claim.storageBucket, claim.manifestPath);
  assertContract(manifestObject.sha256 === claim.manifestSha256, "MANIFEST_HASH_MISMATCH", "Manifest hash does not match the source run log.");
  const manifest = parseJson(manifestObject.text, "manifest.json");
  const week = record(manifest.week);
  assertContract(manifest.schemaVersion === SOURCE_CONTRACT_VERSION, "UNSUPPORTED_SOURCE_CONTRACT", `Source contract ${text(manifest.schemaVersion)} is not supported.`);
  assertContract(manifest.runId === claim.sourceRunId, "MANIFEST_RUN_MISMATCH", "Manifest run ID does not match the claimed source run.");
  assertContract(week.start === claim.periodStart && week.end === claim.periodEnd, "MANIFEST_WEEK_MISMATCH", "Manifest period does not match the claimed ISO week.");
  assertContract(["complete", "partial"].includes(text(manifest.status)), "SOURCE_NOT_TERMINAL", "Manifest does not contain a terminal source status.");

  const manifestArtifacts = rows(manifest.artifacts);
  const names = manifestArtifacts.map(item => text(item.name)).sort();
  assertContract(JSON.stringify(names) === JSON.stringify([...EXPECTED_ARTIFACTS].sort()), "ARTIFACT_SET_MISMATCH", `Expected ${EXPECTED_ARTIFACTS.length} named artifacts.`);
  assertContract(claim.sourceArtifactCount === EXPECTED_ARTIFACTS.length + 1, "ARTIFACT_COUNT_MISMATCH", "Source run log does not report exactly seven artifacts.");

  const basePath = claim.manifestPath.slice(0, claim.manifestPath.lastIndexOf("/"));
  const artifacts: Record<string, JsonRecord> = {};
  const evidence = [{
    artifact_name: "manifest",
    storage_bucket: claim.storageBucket,
    storage_path: claim.manifestPath,
    expected_sha256: claim.manifestSha256,
    actual_sha256: manifestObject.sha256,
    expected_bytes: manifestObject.bytes.byteLength,
    actual_bytes: manifestObject.bytes.byteLength,
    parse_status: "verified",
    row_count: null,
    error_detail: null,
    checked_at: new Date().toISOString(),
  }];

  for (const descriptor of manifestArtifacts) {
    const name = text(descriptor.name);
    const path = text(descriptor.path);
    const expectedHash = text(descriptor.sha256);
    const expectedBytes = integer(descriptor.bytes, -1);
    assertContract(path.startsWith(`${basePath}/`) && path.endsWith(`/${name}.json`), "ARTIFACT_PATH_MISMATCH", `${name}.json is outside the claimed run folder.`);
    assertContract(/^[0-9a-f]{64}$/.test(expectedHash), "INVALID_ARTIFACT_HASH", `${name}.json has an invalid manifest hash.`);
    assertContract(expectedBytes >= 0, "INVALID_ARTIFACT_SIZE", `${name}.json has an invalid manifest size.`);
    const object = await downloadObject(supabase, claim.storageBucket, path);
    assertContract(object.bytes.byteLength === expectedBytes, "ARTIFACT_SIZE_MISMATCH", `${name}.json byte count does not match the manifest.`);
    assertContract(object.sha256 === expectedHash, "ARTIFACT_HASH_MISMATCH", `${name}.json hash does not match the manifest.`);
    if (name !== "operations") artifacts[name] = parseJson(object.text, `${name}.json`);
    evidence.push({
      artifact_name: name,
      storage_bucket: claim.storageBucket,
      storage_path: path,
      expected_sha256: expectedHash,
      actual_sha256: object.sha256,
      expected_bytes: expectedBytes,
      actual_bytes: object.bytes.byteLength,
      parse_status: name === "operations" ? "not_parsed" : "verified",
      row_count: null,
      error_detail: null,
      checked_at: new Date().toISOString(),
    });
  }

  return { manifest, artifacts, evidence };
}

function additionalProperties(line: JsonRecord) {
  const item = record(line.Item ?? line.item);
  const properties = rows(line.additionalProperties ?? item.AdditionalItemProperty ?? item.additionalItemProperty);
  return Object.fromEntries(properties.map(property => {
    const name = text(property.name ?? record(property.Name).value).toLowerCase();
    const value = property.value ?? record(property.Value).value;
    return [name, text(value)];
  }).filter(([name]) => name));
}

function invoiceLineFields(line: JsonRecord, invoiceId: string, index: number) {
  const item = record(line.Item ?? line.item);
  const descriptions = rows(item.Description ?? item.description);
  const taxTotal = rows(line.TaxTotal ?? line.taxTotal)[0] || record(line.taxAmount);
  const taxAmount = record(taxTotal.TaxAmount ?? line.taxAmount);
  const taxCategories = rows(item.ClassifiedTaxCategory ?? item.classifiedTaxCategory);
  const properties = additionalProperties(line);
  const transactionType = text(line.type ?? record(item.Name ?? item.name).value ?? item.Name ?? item.name);
  const lineRef = text(line.invoiceLineRef ?? line.InvoiceLineRef ?? `${invoiceId}#${transactionType || "LINE"}`);
  const lineAmountObject = line.lineExtensionAmount ?? line.LineExtensionAmount;
  const lineAmount = amount(lineAmountObject);
  return {
    invoice_id: invoiceId,
    invoice_line_ref: lineRef,
    transaction_type: transactionType || null,
    order_id: nullableText(properties.bestelnummer ?? properties.ordernumber ?? properties.order_id),
    ean: nullableText(properties.ean),
    track_and_trace: nullableText(properties.trackandtrace ?? properties["track-and-trace"]),
    item_name: transactionType || null,
    item_description: nullableText(line.description ?? descriptions[0]?.value ?? item.Description),
    quantity: numberValue(line.quantity ?? record(line.InvoicedQuantity).value),
    line_extension_amount: lineAmount,
    price_amount: amount(line.priceAmount ?? record(line.Price).PriceAmount),
    tax_amount: amount(line.taxAmount ?? taxAmount),
    tax_percentage: numberValue(line.taxPercentage ?? record(taxCategories[0]?.Percent).value),
    currency: currency(lineAmountObject) || currency(line.priceAmount ?? record(line.Price).PriceAmount),
    source_sign: lineAmount,
    settlement_effect: lineAmount === null ? null : -lineAmount,
    raw_line: line,
    _line_index: index,
  };
}

async function buildPublication(claim: Claim, loaded: Awaited<ReturnType<typeof loadVerifiedPackage>>) {
  const now = new Date().toISOString();
  const manifest = loaded.manifest;
  const commercial = loaded.artifacts.commercial;
  const catalog = loaded.artifacts.catalog;
  const insights = loaded.artifacts.insights;
  const financial = loaded.artifacts.financial;
  const provenance = loaded.artifacts.provenance;
  assertContract(commercial && catalog && insights && financial && provenance, "MISSING_PARSED_ARTIFACT", "A required business artifact was not parsed.");

  const generatedAt = isoTimestamp(manifest.generatedAt) || now;
  const operational = record(commercial.operational);
  const currentState = record(catalog.currentState);
  const weekMetrics = record(insights.weekMetrics);
  const settlement = record(financial.settlement);
  const sourceDatasetStatuses = record(manifest.datasetStatuses);
  const facts: Record<string, JsonRecord[]> = Object.fromEntries([
    "orders", "order_items", "outbound_shipments", "outbound_shipment_items",
    "return_cases", "return_items", "return_status_observations",
    "offer_observations", "offer_country_availability", "inventory_observations",
    "offer_insight_daily", "keyword_rank_daily", "commission_estimates",
    "invoice_headers", "invoice_transactions",
  ].map(name => [name, []]));
  const qualityChecks: JsonRecord[] = [];
  const exceptions: JsonRecord[] = [];

  const shipmentCandidates = new Map<string, JsonRecord[]>();
  const productMetrics = new Map<string, {
    grossUnits: number;
    grossGms: number;
    grossCommission: number;
    registeredReturns: number;
    linkedReturns: number;
    unlinkedReturns: number;
    linkedReturnGms: number;
    linkedReturnCommission: number;
    visits: number | null;
    limitations: string[];
  }>();
  const metricFor = (ean: string) => {
    const existing = productMetrics.get(ean);
    if (existing) return existing;
    const created = { grossUnits: 0, grossGms: 0, grossCommission: 0, registeredReturns: 0, linkedReturns: 0, unlinkedReturns: 0, linkedReturnGms: 0, linkedReturnCommission: 0, visits: null, limitations: [] as string[] };
    productMetrics.set(ean, created);
    return created;
  };

  const shipmentDetails = rows(operational.shipmentDetails);
  const seenShipmentIds = new Set<string>();
  const seenShipmentItemKeys = new Set<string>();
  let invalidShipmentDetails = 0;
  for (let shipmentIndex = 0; shipmentIndex < shipmentDetails.length; shipmentIndex += 1) {
    const wrapper = shipmentDetails[shipmentIndex];
    const detail = record(wrapper.detail);
    if (integer(wrapper.status) !== 200 || !text(detail.shipmentId ?? wrapper.shipmentId)) {
      invalidShipmentDetails += 1;
      continue;
    }
    const shipmentId = text(detail.shipmentId ?? wrapper.shipmentId);
    assertContract(!seenShipmentIds.has(shipmentId), "DUPLICATE_SHIPMENT_ID", `Shipment ${shipmentId} occurs more than once in the source.`);
    seenShipmentIds.add(shipmentId);
    const order = record(detail.order);
    const orderId = nullableText(order.orderId);
    const shipmentAt = isoTimestamp(detail.shipmentDateTime);
    const shipmentDate = isoDate(detail.shipmentDateTime);
    assertContract(shipmentAt, "INVALID_SHIPMENT_DATE", `Shipment ${shipmentId} has no valid shipment timestamp.`);
    assertContract(
      shipmentDate && shipmentDate >= claim.periodStart && shipmentDate <= claim.periodEnd,
      "OUT_OF_PERIOD_SHIPMENT",
      `Shipment ${shipmentId} is dated ${shipmentDate || "invalid"}, outside ${claim.periodStart} through ${claim.periodEnd}.`,
    );
    const shipmentDetailsCountry = nullableText(record(detail.shipmentDetails).countryCode);
    const billingCountry = nullableText(record(detail.billingDetails).countryCode);
    const transport = record(detail.transport);
    const shipmentFields = {
      shipment_id: shipmentId,
      order_id: orderId,
      shipment_at: shipmentAt,
      pickup_point: detail.pickupPoint === null || detail.pickupPoint === undefined ? null : Boolean(detail.pickupPoint),
      country_code: shipmentDetailsCountry || billingCountry,
      transport_id: nullableText(transport.transportId),
      transporter_code: nullableText(transport.transporterCode),
      track_and_trace: nullableText(transport.trackAndTrace),
      shipping_label_id: nullableText(transport.shippingLabelId),
    };
    facts.outbound_shipments.push(await fact(shipmentFields, shipmentId, "commercial", `/operational/shipmentDetails/${shipmentIndex}`, shipmentAt, now));

    const shipmentItems = rows(detail.shipmentItems);
    for (let itemIndex = 0; itemIndex < shipmentItems.length; itemIndex += 1) {
      const item = shipmentItems[itemIndex];
      const product = record(item.product);
      const offer = record(item.offer);
      const fulfilment = record(item.fulfilment);
      const orderItemId = text(item.orderItemId);
      const ean = text(product.ean ?? item.ean);
      const quantityShipped = integer(item.quantityShipped ?? item.quantity);
      const unitPrice = numberValue(item.unitPrice);
      const commission = numberValue(item.commission);
      assertContract(orderItemId && /^\d{13}$/.test(ean) && quantityShipped > 0 && unitPrice !== null && commission !== null, "INVALID_SHIPMENT_ITEM", `Shipment ${shipmentId} contains an invalid business line.`);
      const shipmentItemKey = `${shipmentId}|${orderItemId}`;
      assertContract(!seenShipmentItemKeys.has(shipmentItemKey), "DUPLICATE_SHIPMENT_ITEM", `Shipment item ${shipmentItemKey} occurs more than once in the source.`);
      seenShipmentItemKeys.add(shipmentItemKey);
      const itemFields = {
        shipment_id: shipmentId,
        order_id: orderId,
        order_item_id: orderItemId,
        ean,
        offer_id: nullableText(offer.offerId),
        product_title: nullableText(product.title),
        quantity_shipped: quantityShipped,
        unit_price: round(unitPrice, 2),
        commission: round(commission, 2),
        fulfilment_method: nullableText(fulfilment.method),
        distribution_party: nullableText(fulfilment.distributionParty),
        latest_delivery_date: isoDate(fulfilment.latestDeliveryDate),
      };
      const sourcePointer = `/operational/shipmentDetails/${shipmentIndex}/detail/shipmentItems/${itemIndex}`;
      facts.outbound_shipment_items.push(await fact(itemFields, `${shipmentId}|${orderItemId}`, "commercial", sourcePointer, shipmentAt, now));
      const candidate = { ...itemFields, sourcePointer };
      const matchKey = `${orderId || ""}|${ean}`;
      shipmentCandidates.set(matchKey, [...(shipmentCandidates.get(matchKey) || []), candidate]);
      const metric = metricFor(ean);
      metric.grossUnits += quantityShipped;
      metric.grossGms += quantityShipped * unitPrice;
      metric.grossCommission += commission;
    }
  }

  const orderDetails = rows(operational.ordersFromShipmentDetails);
  for (let orderIndex = 0; orderIndex < orderDetails.length; orderIndex += 1) {
    const wrapper = orderDetails[orderIndex];
    const detail = record(wrapper.detail);
    if (integer(wrapper.status) !== 200) continue;
    const orderId = text(detail.orderId ?? wrapper.orderId);
    if (!orderId) continue;
    const orderPlacedAt = isoTimestamp(detail.orderPlacedDateTime);
    const orderFields = {
      order_id: orderId,
      order_placed_at: orderPlacedAt,
      pickup_point: detail.pickupPoint === null || detail.pickupPoint === undefined ? null : Boolean(detail.pickupPoint),
      country_code: nullableText(record(detail.shipmentDetails).countryCode) || nullableText(record(detail.billingDetails).countryCode),
    };
    facts.orders.push(await fact(orderFields, orderId, "commercial", `/operational/ordersFromShipmentDetails/${orderIndex}`, orderPlacedAt || generatedAt, now));
    const orderItems = rows(detail.orderItems);
    for (let itemIndex = 0; itemIndex < orderItems.length; itemIndex += 1) {
      const item = orderItems[itemIndex];
      const product = record(item.product);
      const offer = record(item.offer);
      const fulfilment = record(item.fulfilment);
      const orderItemId = text(item.orderItemId);
      const ean = text(product.ean ?? item.ean);
      if (!orderItemId || !/^\d{13}$/.test(ean)) continue;
      const orderItemFields = {
        order_item_id: orderItemId,
        order_id: orderId,
        ean,
        offer_id: nullableText(offer.offerId),
        product_title: nullableText(product.title),
        quantity: integer(item.quantity),
        quantity_shipped: integer(item.quantityShipped),
        quantity_cancelled: integer(item.quantityCancelled),
        unit_price: round(numberValue(item.unitPrice) || 0, 2),
        total_price: round(numberValue(item.totalPrice) ?? ((numberValue(item.unitPrice) || 0) * integer(item.quantity)), 2),
        commission: numberValue(item.commission) === null ? null : round(numberValue(item.commission)!, 2),
        fulfilment_method: nullableText(fulfilment.method),
        distribution_party: nullableText(fulfilment.distributionParty),
        latest_delivery_date: isoDate(fulfilment.latestDeliveryDate),
        latest_changed_at: isoTimestamp(item.latestChangedDateTime),
        cancellation_requested: item.cancellationRequest === null || item.cancellationRequest === undefined ? null : Boolean(item.cancellationRequest),
      };
      facts.order_items.push(await fact(orderItemFields, orderItemId, "commercial", `/operational/ordersFromShipmentDetails/${orderIndex}/detail/orderItems/${itemIndex}`, orderItemFields.latest_changed_at || orderPlacedAt || generatedAt, now));
    }
  }

  const returnRows = rows(operational.returns);
  const seenRmas = new Set<string>();
  let unmatchedReturnUnits = 0;
  let ambiguousReturnUnits = 0;
  for (let returnIndex = 0; returnIndex < returnRows.length; returnIndex += 1) {
    const returnRow = returnRows[returnIndex];
    const returnId = text(returnRow.returnId);
    const registeredAt = isoTimestamp(returnRow.registrationDateTime);
    const registeredDate = isoDate(returnRow.registrationDateTime);
    assertContract(returnId && registeredAt, "INVALID_RETURN_CASE", `Return row ${returnIndex} is missing its ID or registration timestamp.`);
    assertContract(
      registeredDate && registeredDate >= claim.periodStart && registeredDate <= claim.periodEnd,
      "OUT_OF_PERIOD_RETURN",
      `Return ${returnId} is dated ${registeredDate || "invalid"}, outside ${claim.periodStart} through ${claim.periodEnd}.`,
    );
    const returnCaseFields = { return_id: returnId, registered_at: registeredAt, fulfilment_method: nullableText(returnRow.fulfilmentMethod) };
    facts.return_cases.push(await fact(returnCaseFields, returnId, "commercial", `/operational/returns/${returnIndex}`, registeredAt, now));
    const returnItems = rows(returnRow.returnItems);
    for (let itemIndex = 0; itemIndex < returnItems.length; itemIndex += 1) {
      const item = returnItems[itemIndex];
      const reason = record(item.returnReason);
      const rmaId = text(item.rmaId);
      const ean = text(item.ean);
      const orderId = nullableText(item.orderId);
      const expectedQuantity = integer(item.expectedQuantity);
      assertContract(rmaId && /^\d{13}$/.test(ean) && expectedQuantity > 0, "INVALID_RETURN_ITEM", `Return ${returnId} contains an invalid item at index ${itemIndex}.`);
      assertContract(!seenRmas.has(rmaId), "DUPLICATE_RETURN_ITEM", `Return RMA ${rmaId} occurs more than once in the source.`);
      seenRmas.add(rmaId);
      const returnItemFields = {
        return_id: returnId,
        rma_id: rmaId,
        order_id: orderId,
        ean,
        expected_quantity: expectedQuantity,
        main_reason: nullableText(reason.mainReason),
        detailed_reason: nullableText(reason.detailedReason),
        handled: Boolean(item.handled),
      };
      const pointer = `/operational/returns/${returnIndex}/returnItems/${itemIndex}`;
      facts.return_items.push(await fact(returnItemFields, `${returnId}|${rmaId}`, "commercial", pointer, registeredAt, now));
      const statusFields = { rma_id: rmaId, handled: Boolean(item.handled), observed_at: generatedAt };
      facts.return_status_observations.push(await fact(statusFields, `${rmaId}|${generatedAt}`, "commercial", pointer, generatedAt, now));
      const metric = metricFor(ean);
      metric.registeredReturns += expectedQuantity;
      const candidates = orderId ? shipmentCandidates.get(`${orderId}|${ean}`) || [] : [];
      if (orderId && candidates.length === 1 && expectedQuantity <= integer(candidates[0].quantity_shipped)) {
        const candidate = candidates[0];
        const perUnitCommission = (numberValue(candidate.commission) || 0) / integer(candidate.quantity_shipped, 1);
        metric.linkedReturns += expectedQuantity;
        metric.linkedReturnGms += expectedQuantity * (numberValue(candidate.unit_price) || 0);
        metric.linkedReturnCommission += expectedQuantity * perUnitCommission;
      } else {
        metric.unlinkedReturns += expectedQuantity;
        const missingOrderId = !orderId;
        const quantityExceedsShipment = candidates.length === 1 && expectedQuantity > integer(candidates[0].quantity_shipped);
        const ambiguous = candidates.length > 1;
        const exceptionCode = missingOrderId
          ? "RETURN_MISSING_ORDER_ID"
          : quantityExceedsShipment
          ? "RETURN_QUANTITY_EXCEEDS_SHIPMENT"
          : ambiguous
          ? "AMBIGUOUS_RETURN_MATCH"
          : "UNMATCHED_RETURN";
        const exceptionTitle = missingOrderId
          ? "Return has no order ID"
          : quantityExceedsShipment
          ? "Return quantity exceeds the matched weekly shipment"
          : ambiguous
          ? "Return has several possible shipment matches"
          : "Return has no shipment match in this week";
        const limitation = missingOrderId
          ? "Return could not be linked because its order ID is missing."
          : quantityExceedsShipment
          ? "Return could not be linked because its quantity exceeds the matched weekly shipment."
          : ambiguous
          ? "Return could not be linked because several shipment lines matched."
          : "Return could not be linked to a shipment in this reporting week.";
        if (ambiguous) ambiguousReturnUnits += expectedQuantity;
        else unmatchedReturnUnits += expectedQuantity;
        metric.limitations.push(limitation);
        exceptions.push(exception(
          exceptionCode,
          "return_adjusted_trading",
          "warning",
          exceptionTitle,
          `RMA ${rmaId} for EAN ${ean} remains outside the provisional financial adjustment.`,
          {
            businessKey: rmaId,
            ean,
            evidence: {
              orderId,
              expectedQuantity,
              candidateCount: candidates.length,
              matchedShipmentQuantity: candidates.length === 1 ? integer(candidates[0].quantity_shipped) : null,
            },
          },
        ));
      }
    }
  }

  const unhandledRows = rows(operational.unhandledReturns);
  for (let returnIndex = 0; returnIndex < unhandledRows.length; returnIndex += 1) {
    for (let itemIndex = 0; itemIndex < rows(unhandledRows[returnIndex].returnItems).length; itemIndex += 1) {
      const item = rows(unhandledRows[returnIndex].returnItems)[itemIndex];
      const rmaId = text(item.rmaId);
      if (!rmaId || seenRmas.has(rmaId)) continue;
      const statusFields = { rma_id: rmaId, handled: false, observed_at: generatedAt };
      facts.return_status_observations.push(await fact(statusFields, `${rmaId}|${generatedAt}`, "commercial", `/operational/unhandledReturns/${returnIndex}/returnItems/${itemIndex}`, generatedAt, now));
    }
  }

  const offers = rows(currentState.offers);
  const offerEans = new Set<string>();
  const offerIds = new Set<string>();
  let fbbOffers = 0;
  for (let offerIndex = 0; offerIndex < offers.length; offerIndex += 1) {
    const offer = offers[offerIndex];
    const offerId = text(offer.offerId);
    const ean = text(offer.ean);
    assertContract(offerId && /^\d{13}$/.test(ean), "INVALID_CATALOG_OFFER", `Catalog offer ${offerIndex} is missing a valid offer ID or EAN.`);
    assertContract(!offerIds.has(offerId), "DUPLICATE_OFFER_ID", `Offer ID ${offerId} occurs more than once in the catalog source.`);
    assertContract(!offerEans.has(ean), "DUPLICATE_OFFER_EAN", `EAN ${ean} occurs more than once in the catalog source.`);
    offerIds.add(offerId);
    offerEans.add(ean);
    metricFor(ean);
    const stock = record(offer.stock);
    const product = record(offer.product);
    const pricing = record(offer.pricing);
    const bundlePrices = rows(pricing.bundlePrices);
    const unitPrice = numberValue(bundlePrices.find(price => integer(price.quantity) === 1)?.unitPrice ?? bundlePrices[0]?.unitPrice);
    const fulfilment = record(offer.fulfilment);
    if (text(fulfilment.method) === "FBB") fbbOffers += 1;
    const observedAt = generatedAt;
    const offerFields = {
      offer_id: offerId,
      ean,
      observed_at: observedAt,
      source_last_modified_at: isoTimestamp(offer.lastModifiedDateTime),
      on_hold_by_retailer: offer.onHoldByRetailer === null || offer.onHoldByRetailer === undefined ? null : Boolean(offer.onHoldByRetailer),
      economic_operator_id: nullableText(offer.economicOperatorId),
      stock_amount: numberValue(stock.amount) === null ? null : integer(stock.amount),
      corrected_stock: numberValue(stock.correctedStock) === null ? null : integer(stock.correctedStock),
      stock_managed_by_retailer: stock.managedByRetailer === null || stock.managedByRetailer === undefined ? null : Boolean(stock.managedByRetailer),
      condition_category: nullableText(record(offer.condition).category),
      bol_product_id: nullableText(product.bolProductId),
      unit_price: unitPrice === null ? null : round(unitPrice, 2),
      fulfilment_method: nullableText(fulfilment.method),
      fulfilment_schedule: nullableText(fulfilment.schedule),
    };
    facts.offer_observations.push(await fact(offerFields, `${offerId}|${observedAt}`, "catalog", `/currentState/offers/${offerIndex}`, observedAt, now));
    const countries = rows(offer.countryAvailabilities);
    for (let countryIndex = 0; countryIndex < countries.length; countryIndex += 1) {
      const country = countries[countryIndex];
      const countryCode = text(country.countryCode);
      if (!/^[A-Z]{2}$/.test(countryCode)) continue;
      const fields = { offer_id: offerId, ean, observed_at: observedAt, country_code: countryCode, for_sale: Boolean(country.forSale) };
      facts.offer_country_availability.push(await fact(fields, `${offerId}|${observedAt}|${countryCode}`, "catalog", `/currentState/offers/${offerIndex}/countryAvailabilities/${countryIndex}`, observedAt, now));
    }
  }

  const inventory = rows(currentState.inventory);
  for (let inventoryIndex = 0; inventoryIndex < inventory.length; inventoryIndex += 1) {
    const inventoryRow = inventory[inventoryIndex];
    const ean = text(inventoryRow.ean);
    if (!/^\d{13}$/.test(ean)) continue;
    const fields = { ean, observed_at: generatedAt, quantity: numberValue(inventoryRow.quantity) === null ? null : integer(inventoryRow.quantity), stock: inventoryRow };
    facts.inventory_observations.push(await fact(fields, `${ean}|${generatedAt}`, "catalog", `/currentState/inventory/${inventoryIndex}`, generatedAt, now));
  }

  const commissions = rows(currentState.commissions);
  for (let commissionIndex = 0; commissionIndex < commissions.length; commissionIndex += 1) {
    const commission = commissions[commissionIndex];
    const ean = text(commission.ean);
    const result = record(commission.result);
    if (!/^\d{13}$/.test(ean) || integer(commission.status) !== 200) continue;
    const fields = {
      ean,
      observed_at: generatedAt,
      unit_price: round(numberValue(commission.unitPrice) || 0, 2),
      fixed_amount: numberValue(result.fixedAmount),
      percentage: numberValue(result.percentage),
      total_cost: numberValue(result.totalCost),
      total_cost_without_reduction: numberValue(result.totalCostWithoutReduction),
      raw_result: result,
    };
    facts.commission_estimates.push(await fact(fields, `${ean}|${generatedAt}|${fields.unit_price}`, "catalog", `/currentState/commissions/${commissionIndex}`, generatedAt, now));
  }

  const insightRows = rows(weekMetrics.offerInsights);
  const visitDatesByEan = new Map<string, Set<string>>();
  const buyBoxDatesByEan = new Map<string, Set<string>>();
  const seenVisitTotals = new Set<string>();
  const seenInsightCountries = new Set<string>();
  for (let insightIndex = 0; insightIndex < insightRows.length; insightIndex += 1) {
    const insight = insightRows[insightIndex];
    const ean = text(insight.ean);
    const offerId = text(insight.offerId);
    const metricName = text(insight.metric);
    if (!/^\d{13}$/.test(ean) || !offerId || !["PRODUCT_VISITS", "BUY_BOX_PERCENTAGE"].includes(metricName)) continue;
    const periods = rows(insight.periods);
    for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
      const period = periods[periodIndex];
      const date = periodDate(period);
      if (!date || date < claim.periodStart || date > claim.periodEnd) continue;
      const total = numberValue(period.total ?? period.value ?? period.count);
      if (metricName === "PRODUCT_VISITS") {
        assertContract(total !== null && Number.isInteger(total) && total >= 0, "INVALID_PRODUCT_VISIT_TOTAL", `Product visits for EAN ${ean} on ${date} must be a nonnegative integer.`);
        const visitKey = `${ean}|${date}`;
        assertContract(!seenVisitTotals.has(visitKey), "DUPLICATE_PRODUCT_VISIT_DATE", `Product visits for EAN ${ean} contain date ${date} more than once.`);
        seenVisitTotals.add(visitKey);
        const dateSet = visitDatesByEan.get(ean) || new Set<string>();
        dateSet.add(date);
        visitDatesByEan.set(ean, dateSet);
        const fields = { offer_id: offerId, ean, metric_date: date, metric: metricName, country_code: null, is_total: true, value: total };
        facts.offer_insight_daily.push(await fact(fields, `${offerId}|${date}|${metricName}|TOTAL`, "insights", `/weekMetrics/offerInsights/${insightIndex}/periods/${periodIndex}`, date, now));
        metricFor(ean).visits = (metricFor(ean).visits || 0) + integer(total);
      }
      const countries = rows(period.countries);
      let validCountryCount = 0;
      for (let countryIndex = 0; countryIndex < countries.length; countryIndex += 1) {
        const country = countries[countryIndex];
        const countryCode = text(country.countryCode);
        const value = numberValue(country.value);
        assertContract(/^[A-Z]{2}$/.test(countryCode) && value !== null && value >= 0, "INVALID_INSIGHT_COUNTRY_VALUE", `${metricName} for EAN ${ean} on ${date} has an invalid country value.`);
        assertContract(metricName !== "BUY_BOX_PERCENTAGE" || value <= 100, "INVALID_BUY_BOX_PERCENTAGE", `Buy Box percentage for EAN ${ean}, ${countryCode}, ${date} exceeds 100.`);
        const countryKey = `${ean}|${date}|${metricName}|${countryCode}`;
        assertContract(!seenInsightCountries.has(countryKey), "DUPLICATE_INSIGHT_COUNTRY", `${metricName} for EAN ${ean}, ${countryCode}, ${date} occurs more than once.`);
        seenInsightCountries.add(countryKey);
        validCountryCount += 1;
        const fields = { offer_id: offerId, ean, metric_date: date, metric: metricName, country_code: countryCode, is_total: false, value };
        facts.offer_insight_daily.push(await fact(fields, `${offerId}|${date}|${metricName}|${countryCode}`, "insights", `/weekMetrics/offerInsights/${insightIndex}/periods/${periodIndex}/countries/${countryIndex}`, date, now));
      }
      if (metricName === "BUY_BOX_PERCENTAGE" && validCountryCount > 0) {
        const dateSet = buyBoxDatesByEan.get(ean) || new Set<string>();
        dateSet.add(date);
        buyBoxDatesByEan.set(ean, dateSet);
      }
    }
  }

  const rankCalls = rows(insights.ranks);
  const rankCombinations = new Set<string>();
  const rankFactKeys = new Set<string>();
  for (let callIndex = 0; callIndex < rankCalls.length; callIndex += 1) {
    const rankCall = rankCalls[callIndex];
    const ean = text(rankCall.ean);
    const rankDate = isoDate(rankCall.date);
    const locale = text(rankCall.locale);
    const rankType = text(rankCall.type);
    const rankRows = rows(record(rankCall.data).ranks ?? record(rankCall.sample).ranks);
    if (integer(rankCall.status) !== 200) continue;
    assertContract(offerEans.has(ean), "UNEXPECTED_RANK_EAN", `Rank call ${callIndex} references EAN ${ean}, which is not in the catalog.`);
    assertContract(rankDate && rankDate >= claim.periodStart && rankDate <= claim.periodEnd, "OUT_OF_PERIOD_RANK_CALL", `Rank call ${callIndex} is outside ${claim.periodStart} through ${claim.periodEnd}.`);
    assertContract(EXPECTED_RANK_LOCALES.has(locale), "UNEXPECTED_RANK_LOCALE", `Rank call ${callIndex} uses unsupported locale ${locale}.`);
    assertContract(rankType === "SEARCH", "UNEXPECTED_RANK_TYPE", `Rank call ${callIndex} uses unsupported type ${rankType}.`);
    const combination = `${ean}|${rankDate}|${locale}`;
    assertContract(!rankCombinations.has(combination), "DUPLICATE_RANK_CALL", `Rank call ${combination} occurs more than once.`);
    rankCombinations.add(combination);
    for (let rankIndex = 0; rankIndex < rankRows.length; rankIndex += 1) {
      const rank = rankRows[rankIndex];
      const searchTerm = text(rank.searchTerm);
      const rankValue = integer(rank.rank);
      if (!searchTerm || rankValue <= 0) continue;
      const rankFactKey = `${combination}|${rankType}|${searchTerm}|${Boolean(rank.wasSponsored)}`;
      assertContract(!rankFactKeys.has(rankFactKey), "DUPLICATE_RANK_RESULT", `Rank result ${rankFactKey} occurs more than once.`);
      rankFactKeys.add(rankFactKey);
      const fields = { ean, rank_date: rankDate, locale, rank_type: rankType, search_term: searchTerm, was_sponsored: Boolean(rank.wasSponsored), rank: rankValue, impressions: integer(rank.impressions) };
      facts.keyword_rank_daily.push(await fact(fields, `${ean}|${rankDate}|${locale}|${rankType}|${searchTerm}|${Boolean(rank.wasSponsored)}`, "insights", `/ranks/${callIndex}/data/ranks/${rankIndex}`, rankDate, now));
    }
  }

  const invoices = rows(settlement.invoices);
  const seenInvoiceIds = new Set<string>();
  for (let invoiceIndex = 0; invoiceIndex < invoices.length; invoiceIndex += 1) {
    const invoice = invoices[invoiceIndex];
    const invoiceId = text(invoice.invoiceId);
    assertContract(invoiceId, "INVALID_INVOICE_HEADER", `Invoice header ${invoiceIndex} has no invoice ID.`);
    assertContract(!seenInvoiceIds.has(invoiceId), "DUPLICATE_INVOICE_HEADER", `Invoice ${invoiceId} occurs more than once in the invoice list.`);
    seenInvoiceIds.add(invoiceId);
    const period = record(invoice.invoicePeriod);
    const totals = record(invoice.legalMonetaryTotal);
    const payable = totals.payableAmount;
    const taxExclusive = totals.taxExclusiveAmount;
    const taxInclusive = totals.taxInclusiveAmount;
    const fields = {
      invoice_id: invoiceId,
      issue_date: isoDate(invoice.issueDate),
      invoice_type: nullableText(invoice.invoiceType),
      period_start: isoDate(period.startDate),
      period_end: isoDate(period.endDate),
      payable_amount: amount(payable),
      tax_exclusive_amount: amount(taxExclusive),
      tax_inclusive_amount: amount(taxInclusive),
      currency: currency(payable) || currency(taxExclusive),
      raw_header: invoice,
    };
    facts.invoice_headers.push(await fact(fields, invoiceId, "financial", `/settlement/invoices/${invoiceIndex}`, fields.issue_date || generatedAt, now));
  }

  const specifications = rows(settlement.invoiceSpecifications);
  for (let specificationIndex = 0; specificationIndex < specifications.length; specificationIndex += 1) {
    const specification = specifications[specificationIndex];
    const invoiceId = text(specification.invoiceId);
    assertContract(invoiceId, "INVALID_INVOICE_SPECIFICATION", `Invoice specification ${specificationIndex} has no invoice ID.`);
    const lines = rows(specification.lines);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const parsed = invoiceLineFields(lines[lineIndex], invoiceId, lineIndex);
      assertContract(parsed.invoice_line_ref, "INVALID_INVOICE_TRANSACTION", `Invoice ${invoiceId} contains a transaction without a line reference.`);
      const idHint = text(lines[lineIndex].id ?? record(lines[lineIndex].ID).value ?? lineIndex);
      const fields = { ...parsed };
      delete (fields as JsonRecord)._line_index;
      facts.invoice_transactions.push(await fact(fields, `${invoiceId}|${parsed.invoice_line_ref}|${idHint}|${lineIndex}`, "financial", `/settlement/invoiceSpecifications/${specificationIndex}/lines/${lineIndex}`, generatedAt, now));
    }
  }

  const commercialStatus = text(record(sourceDatasetStatuses.commercial).status);
  const insightsStatus = text(record(sourceDatasetStatuses.insights).status);
  const financialStatus = text(record(sourceDatasetStatuses.financial).status);
  const shipmentReady = commercialStatus === "complete" && invalidShipmentDetails === 0;
  qualityChecks.push(check("SHIPMENT_DETAILS_VALID", "shipment_facts", "error", shipmentReady ? "passed" : "failed", shipmentReady ? "All shipment details are valid and complete." : "One or more shipment details are missing or invalid.", { datasetStatus: "complete", invalidDetails: 0 }, { datasetStatus: commercialStatus, invalidDetails: invalidShipmentDetails }));
  qualityChecks.push(check("RETURN_MATCH_COVERAGE", "return_adjusted_trading", unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "warning" : "info", unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "warning" : "passed", unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "Some registered returns remain outside the provisional financial adjustment." : "Every registered return was linked exactly once.", { unmatchedUnits: 0, ambiguousUnits: 0 }, { unmatchedUnits: unmatchedReturnUnits, ambiguousUnits: ambiguousReturnUnits }));
  const expectedRankCalls = offerEans.size * 7 * EXPECTED_RANK_LOCALES.size;
  const ranksReady = rankCombinations.size === expectedRankCalls && rankCalls.every(row => integer(row.status) === 200);
  qualityChecks.push(check("RANK_CALL_COVERAGE", "keyword_ranks", "error", ranksReady ? "passed" : "failed", ranksReady ? "All expected EAN/date/locale rank calls are present." : "Rank-call coverage is incomplete.", { combinations: expectedRankCalls }, { combinations: rankCombinations.size, rows: rankCalls.length, sourceDatasetStatus: insightsStatus }));
  const visitCoverageReady = offers.every(offer => (visitDatesByEan.get(text(offer.ean))?.size || 0) === 7);
  qualityChecks.push(check("PRODUCT_VISIT_DATE_COVERAGE", "product_visits", "error", visitCoverageReady ? "passed" : "failed", visitCoverageReady ? "Every offer has seven product-visit dates." : "At least one offer is missing product-visit dates.", { datesPerOffer: 7 }, Object.fromEntries([...visitDatesByEan].map(([ean, dates]) => [ean, dates.size]))));
  const buyBoxCoverageReady = offers.every(offer => (buyBoxDatesByEan.get(text(offer.ean))?.size || 0) === 7);
  qualityChecks.push(check("BUY_BOX_DATE_COVERAGE", "buy_box", "warning", buyBoxCoverageReady ? "passed" : "warning", buyBoxCoverageReady ? "Every offer has seven Buy Box dates." : "At least one offer is missing Buy Box dates; missing countries remain missing rather than zero.", { datesPerOffer: 7 }, Object.fromEntries([...buyBoxDatesByEan].map(([ean, dates]) => [ean, dates.size]))));
  const invoicesReady = financialStatus === "complete";
  qualityChecks.push(check("INVOICE_SOURCE_VALID", "invoices", "error", invoicesReady ? "passed" : "failed", invoicesReady ? "Invoice list and requested specifications passed the source contract." : "The financial source dataset is incomplete.", { datasetStatus: "complete" }, { datasetStatus: financialStatus, invoiceCount: invoices.length, transactionCount: facts.invoice_transactions.length }));
  qualityChecks.push(check("FBB_INVENTORY_APPLICABILITY", "fbb_inventory", "info", fbbOffers > 0 ? "passed" : "not_applicable", fbbOffers > 0 ? "FBB offers exist, so FBB inventory observations are applicable." : "All current offers are FBR; FBB inventory is not applicable.", null, { fbbOffers, totalOffers: offers.length }));
  const allShipmentCountriesPresent = facts.outbound_shipments.every(row => Boolean(row.country_code));
  qualityChecks.push(check("SHIPMENT_COUNTRY_COVERAGE", "country_split", "warning", allShipmentCountriesPresent ? "passed" : "warning", allShipmentCountriesPresent ? "Every shipment has a country code." : "Country reporting remains limited because at least one shipment has no country code.", { missing: 0 }, { missing: facts.outbound_shipments.filter(row => !row.country_code).length }));
  qualityChecks.push(check("ORDER_COHORT_CONVERSION", "order_cohort_conversion", "info", "not_applicable", "Order-cohort conversion is not produced from same-week visits and shipments.", null, null));

  const dataProductRevisions = [
    { data_product: "shipment_facts", status: shipmentReady ? "ready" : "not_ready", limitations: shipmentReady ? [] : ["Shipment source data is incomplete."], is_active: shipmentReady },
    { data_product: "registered_return_events", status: commercialStatus === "complete" ? "ready" : "not_ready", limitations: [], is_active: commercialStatus === "complete" },
    { data_product: "return_adjusted_trading", status: !shipmentReady ? "not_ready" : unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "ready_with_limits" : "ready", limitations: unmatchedReturnUnits + ambiguousReturnUnits > 0 ? ["Unmatched or ambiguous returns are excluded from the provisional value adjustment."] : [], is_active: shipmentReady },
    { data_product: "product_visits", status: visitCoverageReady ? "ready" : "not_ready", limitations: visitCoverageReady ? [] : ["Not every offer has seven aligned visit dates."], is_active: visitCoverageReady },
    { data_product: "keyword_ranks", status: ranksReady ? "ready" : "not_ready", limitations: ranksReady ? [] : ["Rank-call coverage is incomplete."], is_active: ranksReady },
    { data_product: "buy_box", status: buyBoxCoverageReady ? "ready" : "ready_with_limits", limitations: buyBoxCoverageReady ? [] : ["At least one Buy Box date is missing."], is_active: true },
    { data_product: "invoices", status: invoicesReady ? "ready" : "not_ready", limitations: invoicesReady ? [] : ["The financial source dataset is incomplete."], is_active: invoicesReady },
    { data_product: "fbb_inventory", status: fbbOffers > 0 ? "ready" : "not_applicable", limitations: fbbOffers > 0 ? [] : ["All current offers use FBR."], is_active: true },
    { data_product: "country_split", status: allShipmentCountriesPresent ? "ready" : "ready_with_limits", limitations: allShipmentCountriesPresent ? [] : ["At least one shipment has no country code."], is_active: true },
    { data_product: "order_cohort_conversion", status: "not_ready", limitations: ["Same-week shipped units divided by visits is not cohort conversion."], is_active: false },
    { data_product: "trading_units_per_visit", status: shipmentReady && visitCoverageReady ? "ready_with_limits" : "not_ready", limitations: ["This is a same-week trading proxy, not order-cohort conversion."], is_active: shipmentReady && visitCoverageReady },
  ].map(revision => ({
    id: crypto.randomUUID(),
    ...revision,
    formula_version: "retailer-weekly-v1",
    source_detail: { sourceRunId: claim.sourceRunId, sourceContractVersion: claim.sourceContractVersion },
  }));

  const weeklyMetrics = [...productMetrics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ean, metric]) => {
    const grossGms = round(metric.grossGms, 2);
    const grossCommission = round(metric.grossCommission, 2);
    const linkedReturnGms = round(metric.linkedReturnGms, 2);
    const linkedReturnCommission = round(metric.linkedReturnCommission, 2);
    const provisionalNetGms = round(grossGms - linkedReturnGms, 2);
    const provisionalAfterCommission = round(provisionalNetGms - (grossCommission - linkedReturnCommission), 2);
    const reportedVisits = visitCoverageReady ? metric.visits : null;
    const visitsStatus = reportedVisits === null ? "not_ready" : "ready";
    const returnsStatus = metric.unlinkedReturns > 0 ? "ready_with_limits" : "ready";
    return {
      ean,
      gross_shipped_units: metric.grossUnits,
      gross_shipped_gms: grossGms,
      gross_commission: grossCommission,
      registered_return_units: metric.registeredReturns,
      linked_return_units: metric.linkedReturns,
      unlinked_return_units: metric.unlinkedReturns,
      linked_return_gms: linkedReturnGms,
      linked_return_commission: linkedReturnCommission,
      provisional_net_gms: provisionalNetGms,
      provisional_revenue_after_commission: provisionalAfterCommission,
      gross_shipped_asp: metric.grossUnits ? round(grossGms / metric.grossUnits, 4) : null,
      product_visits: reportedVisits,
      trading_units_per_visit: reportedVisits ? round(metric.grossUnits / reportedVisits, 6) : null,
      commercial_status: shipmentReady ? "ready" : "not_ready",
      visits_status: visitsStatus,
      returns_status: returnsStatus,
      limitations: [...new Set([
        ...metric.limitations,
        ...(visitCoverageReady ? [] : ["Product visits are unavailable because the source does not cover all seven reporting dates."]),
        "Trading units per visit is not order-cohort conversion.",
      ])],
      calculation_trace: {
        grossShippedGms: `${metric.grossUnits} shipped units valued from outbound shipment lines`,
        linkedReturnGms: `${metric.linkedReturns} return units matched by exact order ID and EAN`,
        provisionalNetGms: `${grossGms} - ${linkedReturnGms} = ${provisionalNetGms}`,
        revenueAfterCommission: `${provisionalNetGms} - (${grossCommission} - ${linkedReturnCommission}) = ${provisionalAfterCommission}`,
      },
    };
  });
  const reportStatus = !shipmentReady || !visitCoverageReady ? "not_ready" : unmatchedReturnUnits + ambiguousReturnUnits > 0 || !buyBoxCoverageReady || !allShipmentCountriesPresent ? "ready_with_limits" : "ready";

  const completedAt = new Date().toISOString();
  const steps = [
    { step_code: "source_validation", status: "passed", input_count: EXPECTED_ARTIFACTS.length + 1, output_count: loaded.evidence.length, started_at: now, completed_at: completedAt, detail: { sourceContractVersion: SOURCE_CONTRACT_VERSION } },
    { step_code: "commercial", status: shipmentReady ? "passed" : "failed", input_count: shipmentDetails.length + returnRows.length, output_count: facts.outbound_shipment_items.length + facts.return_items.length, started_at: now, completed_at: completedAt, detail: {} },
    { step_code: "catalog", status: "passed", input_count: offers.length, output_count: facts.offer_observations.length, started_at: now, completed_at: completedAt, detail: {} },
    { step_code: "insights", status: visitCoverageReady && ranksReady ? "passed" : "warning", input_count: insightRows.length + rankCalls.length, output_count: facts.offer_insight_daily.length + facts.keyword_rank_daily.length, started_at: now, completed_at: completedAt, detail: {} },
    { step_code: "financial", status: invoicesReady ? "passed" : "failed", input_count: invoices.length, output_count: facts.invoice_transactions.length, started_at: now, completed_at: completedAt, detail: {} },
    { step_code: "quality", status: qualityChecks.some(row => row.result === "failed") ? "warning" : qualityChecks.some(row => row.result === "warning") ? "warning" : "passed", input_count: qualityChecks.length, output_count: exceptions.length, started_at: now, completed_at: completedAt, detail: {} },
    { step_code: "publication", status: "passed", input_count: Object.values(facts).reduce((sum, value) => sum + value.length, 0), output_count: weeklyMetrics.length, started_at: now, completed_at: completedAt, detail: { atomic: true } },
  ];

  return {
    sourceRunId: claim.sourceRunId,
    sourceContractVersion: claim.sourceContractVersion,
    transformVersion: claim.transformVersion,
    generatedAt,
    artifacts: loaded.evidence,
    steps,
    qualityChecks,
    exceptions,
    facts,
    dataProductRevisions,
    weeklyReport: shipmentReady ? { id: crypto.randomUUID(), status: reportStatus, metrics: weeklyMetrics } : null,
    sourceSummary: provenance.summary || manifest.summary || {},
  };
}

async function processClaim(supabase: SupabaseClient, claim: Claim) {
  if (claim.sourceContractVersion !== SOURCE_CONTRACT_VERSION || claim.transformVersion !== TRANSFORM_VERSION) {
    throw new PermanentTransformError("UNSUPPORTED_VERSION", `Unsupported source/transform version ${claim.sourceContractVersion}/${claim.transformVersion}.`);
  }
  const loaded = await loadVerifiedPackage(supabase, claim);
  const publication = await buildPublication(claim, loaded);
  const { data, error } = await supabase.rpc("publish_bol_retailer_transform", {
    p_transform_run_id: claim.transformRunId,
    p_lease_token: claim.leaseToken,
    p_message_id: claim.messageId,
    p_payload: publication,
  });
  if (error) throw new Error(`publish_rpc: ${error.message}`);
  return data;
}

Deno.serve(async request => {
  if (request.method !== "POST") return jsonResponse({ status: "method_not_allowed" }, 405);
  const expectedToken = env("BOL_RETAILER_CRON_TOKEN");
  const authorizationToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const providedToken = request.headers.get("x-aterra-cron-token") || authorizationToken;
  if (!providedToken || providedToken !== expectedToken) return jsonResponse({ status: "unauthorized" }, 401);

  const supabase = createClient(env("SUPABASE_URL"), serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const workerId = request.headers.get("x-supabase-execution-id") || crypto.randomUUID();
  const results: unknown[] = [];

  for (let index = 0; index < MAX_MESSAGES_PER_INVOCATION; index += 1) {
    const { data: claimData, error: claimError } = await supabase.rpc("claim_bol_retailer_transform", { p_worker_id: workerId });
    if (claimError) return jsonResponse({ status: "error", stage: "claim", message: claimError.message }, 503);
    if (!claimData) break;
    const claim = claimData as Claim;
    if (claim.status === "discarded") {
      results.push(claim);
      continue;
    }
    try {
      results.push(await processClaim(supabase, claim));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown transform error.";
      const policy = retryPolicy(claim.attemptNumber, error instanceof PermanentTransformError);
      if (policy.action === "reject") {
        const errorCode = error instanceof PermanentTransformError ? error.code : policy.errorCode;
        const { data: rejectRecorded, error: rejectError } = await supabase.rpc("reject_bol_retailer_transform", {
          p_transform_run_id: claim.transformRunId,
          p_lease_token: claim.leaseToken,
          p_message_id: claim.messageId,
          p_error_code: errorCode,
          p_error_detail: detail,
        });
        const rejected = fencedMutationSucceeded(rejectRecorded, rejectError);
        results.push({
          status: rejected ? "rejected" : "reject_failed",
          transformRunId: claim.transformRunId,
          code: errorCode,
          detail,
          rpcError: rejectError?.message || (rejected ? null : "Lease fence rejected the terminal update."),
        });
      } else {
        const { data: retryRecorded, error: failError } = await supabase.rpc("fail_bol_retailer_transform", {
          p_transform_run_id: claim.transformRunId,
          p_lease_token: claim.leaseToken,
          p_message_id: claim.messageId,
          p_error_code: policy.errorCode,
          p_error_detail: detail,
          p_retry_delay_seconds: policy.delaySeconds,
        });
        const scheduled = fencedMutationSucceeded(retryRecorded, failError);
        results.push({
          status: scheduled ? "retry_scheduled" : "retry_record_failed",
          transformRunId: claim.transformRunId,
          detail,
          rpcError: failError?.message || (scheduled ? null : "Lease fence rejected the retry update."),
        });
      }
    }
  }

  return jsonResponse({ status: "ok", workerId, processed: results.length, results });
});
