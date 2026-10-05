import { createClient, type SupabaseClient as SupabaseJsClient } from "npm:@supabase/supabase-js@2.111.0";

const TRANSFORM_VERSION = "retailer-transform-v2";
const SOURCE_CONTRACT_VERSION = "3.0";
const EXPECTED_ARTIFACTS = ["catalog", "commercial", "financial", "insights", "operations", "provenance"] as const;
const EXPECTED_DATASETS = ["account", "catalog", "commercial", "financial", "insights", "operations"] as const;
const TERMINAL_SOURCE_STATUSES = new Set(["complete", "partial"]);
const DATASET_STATUSES = new Set(["complete", "partial", "not_collected"]);
const EXPECTED_RANK_LOCALES = new Set(["fr-BE", "nl-BE", "nl-NL"]);
const BUCKET = "bol-retailer-api-json";
const MAX_MESSAGES_PER_INVOCATION = 2;
const MAX_TRANSFORM_ATTEMPTS = 5;

type JsonRecord = Record<string, unknown>;
type SupabaseClient = SupabaseJsClient<any, "public", any>;
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

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

type DecimalFraction = { numerator: bigint; denominator: bigint };

function decimalFraction(value: unknown): DecimalFraction | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const source = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(source);
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const fractionDigits = match[3] || "";
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) return null;
  const digits = BigInt(`${match[2]}${fractionDigits}`);
  const scale = fractionDigits.length - exponent;
  if (Math.abs(scale) > 30) return null;
  if (scale >= 0) return { numerator: sign * digits, denominator: 10n ** BigInt(scale) };
  return { numerator: sign * digits * (10n ** BigInt(-scale)), denominator: 1n };
}

function divideHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("A positive denominator is required.");
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return sign * rounded;
}

function moneyToMinor(value: unknown) {
  const fraction = decimalFraction(value);
  if (!fraction) return null;
  return divideHalfUp(fraction.numerator * 100n, fraction.denominator);
}

function lineGrossToMinor(unitPrice: unknown, quantity: number) {
  const fraction = decimalFraction(unitPrice);
  if (!fraction || !Number.isSafeInteger(quantity)) return null;
  return divideHalfUp(fraction.numerator * BigInt(quantity) * 100n, fraction.denominator);
}

function allocateMinor(totalMinor: bigint, quantity: number, totalQuantity: number) {
  return divideHalfUp(totalMinor * BigInt(quantity), BigInt(totalQuantity));
}

function scaledRatioToNumber(numerator: bigint, denominator: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const scaled = divideHalfUp(numerator * scale, denominator);
  const numeric = Number(scaled);
  if (!Number.isSafeInteger(numeric)) throw new PermanentTransformError("MONEY_OUT_OF_RANGE", "Monetary value exceeds the safe publication range.");
  return numeric / Number(scale);
}

function minorToMajor(value: bigint) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new PermanentTransformError("MONEY_OUT_OF_RANGE", "Monetary value exceeds the safe publication range.");
  return numeric / 100;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function dateFromTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  if (!match || !isoDate(match[1]) || !isoTimestamp(value)) return null;
  return match[1];
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  const result = text(value);
  if (!result) return null;
  const parsed = new Date(result);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isoWeekParts(start: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const monday = new Date(`${start}T00:00:00.000Z`);
  if (Number.isNaN(monday.getTime()) || monday.getUTCDay() !== 1) return null;
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const isoYear = thursday.getUTCFullYear();
  return { isoYear, isoWeek, label: `${isoYear}-W${String(isoWeek).padStart(2, "0")}` };
}

function addUtcDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function periodDate(value: JsonRecord): string | null {
  if ("date" in value) return isoDate(value.date);
  const period = record(value.period);
  if (![period.year, period.month, period.day].every(part => typeof part === "number" && Number.isInteger(part))) return null;
  const year = period.year as number;
  const month = period.month as number;
  const day = period.day as number;
  return isoDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
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
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
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

function validateDatasetStatusContract(value: unknown) {
  assertContract(isRecord(value), "INVALID_DATASET_STATUSES", "Manifest datasetStatuses must be an object.");
  const statuses = value as JsonRecord;
  const names = Object.keys(statuses).sort();
  assertContract(
    stableStringify(names) === stableStringify([...EXPECTED_DATASETS].sort()),
    "DATASET_STATUS_SET_MISMATCH",
    `Manifest must describe exactly ${EXPECTED_DATASETS.length} source datasets.`,
  );

  for (const dataset of EXPECTED_DATASETS) {
    const detailValue = statuses[dataset];
    assertContract(isRecord(detailValue), "INVALID_DATASET_STATUS", `Dataset ${dataset} has no status detail.`);
    const detail = detailValue as JsonRecord;
    const status = text(detail.status);
    assertContract(DATASET_STATUSES.has(status), "INVALID_DATASET_STATUS", `Dataset ${dataset} has unsupported status ${status || "empty"}.`);
    const counts = ["calls", "errors", "unavailable", "rows"].map(field => detail[field]);
    assertContract(
      counts.every(count => typeof count === "number" && Number.isInteger(count) && count >= 0),
      "INVALID_DATASET_STATUS",
      `Dataset ${dataset} must contain nonnegative integer calls, errors, unavailable, and rows.`,
    );
    const calls = detail.calls as number;
    const errors = detail.errors as number;
    const unavailable = detail.unavailable as number;
    const rowCount = detail.rows as number;
    assertContract(errors + unavailable <= calls, "INVALID_DATASET_STATUS", `Dataset ${dataset} reports more outcomes than calls.`);
    assertContract(status !== "complete" || errors === 0, "INVALID_DATASET_STATUS", `Complete dataset ${dataset} cannot contain errors.`);
    assertContract(status === "not_collected" ? calls === 0 && errors === 0 && unavailable === 0 && rowCount === 0 : calls > 0, "INVALID_DATASET_STATUS", `Dataset ${dataset} counts do not agree with status ${status}.`);
  }
  return statuses;
}

function validateManifestContract(manifest: JsonRecord, claim: Claim) {
  const week = record(manifest.week);
  const manifestStatus = text(manifest.status);
  const generatedAt = text(manifest.generatedAt);
  const expectedWeek = isoWeekParts(claim.periodStart);
  const expectedManifestPath = `retailer-api/year=${claim.isoYear}/week=${String(claim.isoWeek).padStart(2, "0")}/run=${claim.sourceRunId}/manifest.json`;

  assertContract(claim.sourceContractVersion === SOURCE_CONTRACT_VERSION, "UNSUPPORTED_SOURCE_CONTRACT", `Claimed source contract ${claim.sourceContractVersion} is not supported.`);
  assertContract(manifest.schemaVersion === SOURCE_CONTRACT_VERSION, "UNSUPPORTED_SOURCE_CONTRACT", `Source contract ${text(manifest.schemaVersion)} is not supported.`);
  assertContract(manifest.runId === claim.sourceRunId, "MANIFEST_RUN_MISMATCH", "Manifest run ID does not match the claimed source run.");
  assertContract(claim.manifestPath === expectedManifestPath, "MANIFEST_PATH_MISMATCH", "Manifest path does not match the claimed year, week, and source run.");
  assertContract(TERMINAL_SOURCE_STATUSES.has(manifestStatus), "SOURCE_NOT_TERMINAL", "Manifest does not contain a terminal source status.");
  assertContract(manifestStatus === claim.sourceStatus, "SOURCE_STATUS_MISMATCH", "Manifest status does not match the authoritative source run status.");
  assertContract(expectedWeek && expectedWeek.isoYear === claim.isoYear && expectedWeek.isoWeek === claim.isoWeek, "CLAIM_WEEK_MISMATCH", "Claimed ISO year and week do not match the claimed Monday.");
  assertContract(week.label === expectedWeek?.label && week.start === claim.periodStart && week.end === claim.periodEnd && addUtcDays(claim.periodStart, 6) === claim.periodEnd, "MANIFEST_WEEK_MISMATCH", "Manifest week does not match the claimed complete ISO week.");
  assertContract(/^\d{4}-\d{2}-\d{2}T/.test(generatedAt) && isoTimestamp(generatedAt), "INVALID_MANIFEST_GENERATED_AT", "Manifest generatedAt must be a valid timestamp.");
  assertContract(isRecord(manifest.summary), "INVALID_MANIFEST_SUMMARY", "Manifest summary must be an object.");
  assertContract(isRecord(manifest.completeness), "INVALID_MANIFEST_COMPLETENESS", "Manifest completeness must be an object.");
  assertContract(Array.isArray(manifest.warnings) && manifest.warnings.every(value => typeof value === "string"), "INVALID_MANIFEST_WARNINGS", "Manifest warnings must be an array of strings.");
  validateDatasetStatusContract(manifest.datasetStatuses);

  const manifestArtifacts = rows(manifest.artifacts);
  const names = manifestArtifacts.map(item => text(item.name)).sort();
  assertContract(stableStringify(names) === stableStringify([...EXPECTED_ARTIFACTS].sort()), "ARTIFACT_SET_MISMATCH", `Expected ${EXPECTED_ARTIFACTS.length} named artifacts.`);
  const basePath = expectedManifestPath.slice(0, expectedManifestPath.lastIndexOf("/"));
  for (const descriptor of manifestArtifacts) {
    const name = text(descriptor.name);
    assertContract(text(descriptor.path) === `${basePath}/${name}.json`, "ARTIFACT_PATH_MISMATCH", `${name}.json does not use the exact claimed run path.`);
    assertContract(/^[0-9a-f]{64}$/.test(text(descriptor.sha256)), "INVALID_ARTIFACT_HASH", `${name}.json has an invalid manifest hash.`);
    assertContract(typeof descriptor.bytes === "number" && Number.isInteger(descriptor.bytes) && descriptor.bytes > 0, "INVALID_ARTIFACT_SIZE", `${name}.json must be a nonempty stored artifact.`);
  }
  return manifestArtifacts;
}

function validateArtifactEnvelope(name: string, artifact: JsonRecord, manifest: JsonRecord) {
  assertContract(stableStringify(record(artifact.week)) === stableStringify(record(manifest.week)), "ARTIFACT_WEEK_MISMATCH", `${name}.json week does not match the manifest.`);
  assertContract(artifact.generatedAt === manifest.generatedAt, "ARTIFACT_GENERATED_AT_MISMATCH", `${name}.json generatedAt does not match the manifest.`);
  if (name === "commercial") assertContract(isRecord(artifact.operational), "INVALID_COMMERCIAL_ARTIFACT", "commercial.json has no operational object.");
  if (name === "catalog") assertContract(isRecord(artifact.currentState), "INVALID_CATALOG_ARTIFACT", "catalog.json has no currentState object.");
  if (name === "insights") assertContract(isRecord(artifact.weekMetrics) && Array.isArray(artifact.ranks), "INVALID_INSIGHTS_ARTIFACT", "insights.json has no weekMetrics object or ranks array.");
  if (name === "financial") assertContract(isRecord(artifact.settlement), "INVALID_FINANCIAL_ARTIFACT", "financial.json has no settlement object.");
  if (name === "provenance") {
    assertContract(isRecord(artifact.summary) && isRecord(artifact.completeness) && Array.isArray(artifact.calls), "INVALID_PROVENANCE_ARTIFACT", "provenance.json is missing its summary, completeness, or calls.");
    assertContract(stableStringify(artifact.datasetStatuses) === stableStringify(manifest.datasetStatuses), "PROVENANCE_STATUS_MISMATCH", "provenance.json dataset statuses do not match the manifest.");
  }
}

async function loadVerifiedPackage(supabase: SupabaseClient, claim: Claim) {
  assertContract(claim.storageBucket === BUCKET, "UNEXPECTED_BUCKET", `Expected ${BUCKET}, received ${claim.storageBucket}.`);
  const manifestObject = await downloadObject(supabase, claim.storageBucket, claim.manifestPath);
  assertContract(manifestObject.sha256 === claim.manifestSha256, "MANIFEST_HASH_MISMATCH", "Manifest hash does not match the source run log.");
  const manifest = parseJson(manifestObject.text, "manifest.json");
  const manifestArtifacts = validateManifestContract(manifest, claim);
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
    assertContract(path === `${basePath}/${name}.json`, "ARTIFACT_PATH_MISMATCH", `${name}.json does not use the exact claimed run path.`);
    assertContract(/^[0-9a-f]{64}$/.test(expectedHash), "INVALID_ARTIFACT_HASH", `${name}.json has an invalid manifest hash.`);
    assertContract(expectedBytes > 0, "INVALID_ARTIFACT_SIZE", `${name}.json must be a nonempty stored artifact.`);
    const object = await downloadObject(supabase, claim.storageBucket, path);
    assertContract(object.bytes.byteLength === expectedBytes, "ARTIFACT_SIZE_MISMATCH", `${name}.json byte count does not match the manifest.`);
    assertContract(object.sha256 === expectedHash, "ARTIFACT_HASH_MISMATCH", `${name}.json hash does not match the manifest.`);
    if (name !== "operations") {
      const artifact = parseJson(object.text, `${name}.json`);
      validateArtifactEnvelope(name, artifact, manifest);
      artifacts[name] = artifact;
    }
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
  const commercialEans = new Set<string>();
  const commercialEanByOfferId = new Map<string, string>();
  const commercialOfferIdsByEan = new Map<string, Set<string>>();
  const matchedReturnGroups = new Map<string, {
    candidate: JsonRecord;
    returns: Array<{ rmaId: string; expectedQuantity: number }>;
  }>();
  const productMetrics = new Map<string, {
    grossUnits: number;
    grossGmsMinor: bigint;
    grossCommissionMinor: bigint;
    registeredReturns: number;
    linkedReturns: number;
    unlinkedReturns: number;
    linkedReturnGmsMinor: bigint;
    linkedReturnCommissionMinor: bigint;
    visits: number | null;
    limitations: string[];
  }>();
  const metricFor = (ean: string) => {
    const existing = productMetrics.get(ean);
    if (existing) return existing;
    const created = { grossUnits: 0, grossGmsMinor: 0n, grossCommissionMinor: 0n, registeredReturns: 0, linkedReturns: 0, unlinkedReturns: 0, linkedReturnGmsMinor: 0n, linkedReturnCommissionMinor: 0n, visits: null, limitations: [] as string[] };
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
    const shipmentDate = dateFromTimestamp(detail.shipmentDateTime);
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
      const lineGrossMinor = unitPrice === null ? null : lineGrossToMinor(unitPrice, quantityShipped);
      const unitPriceMinor = unitPrice === null ? null : moneyToMinor(unitPrice);
      const commissionMinor = commission === null ? null : moneyToMinor(commission);
      assertContract(
        orderItemId && /^\d{13}$/.test(ean) && quantityShipped > 0
          && lineGrossMinor !== null && lineGrossMinor >= 0n
          && unitPriceMinor !== null && unitPriceMinor >= 0n
          && commissionMinor !== null && commissionMinor >= 0n,
        "INVALID_SHIPMENT_ITEM",
        `Shipment ${shipmentId} contains an invalid business line.`,
      );
      commercialEans.add(ean);
      const shipmentOfferId = nullableText(offer.offerId);
      const existingCommercialOfferEan = shipmentOfferId ? commercialEanByOfferId.get(shipmentOfferId) : null;
      assertContract(
        !existingCommercialOfferEan || existingCommercialOfferEan === ean,
        "COMMERCIAL_OFFER_ID_EAN_CONFLICT",
        `Shipment offer ${shipmentOfferId} is associated with multiple EANs.`,
      );
      if (shipmentOfferId) {
        commercialEanByOfferId.set(shipmentOfferId, ean);
        const eanOfferIds = commercialOfferIdsByEan.get(ean) || new Set<string>();
        eanOfferIds.add(shipmentOfferId);
        commercialOfferIdsByEan.set(ean, eanOfferIds);
      }
      const shipmentItemKey = `${shipmentId}|${orderItemId}`;
      assertContract(!seenShipmentItemKeys.has(shipmentItemKey), "DUPLICATE_SHIPMENT_ITEM", `Shipment item ${shipmentItemKey} occurs more than once in the source.`);
      seenShipmentItemKeys.add(shipmentItemKey);
      const itemFields = {
        shipment_id: shipmentId,
        order_id: orderId,
        order_item_id: orderItemId,
        ean,
        offer_id: shipmentOfferId,
        product_title: nullableText(product.title),
        quantity_shipped: quantityShipped,
        unit_price: minorToMajor(unitPriceMinor),
        commission: minorToMajor(commissionMinor),
        fulfilment_method: nullableText(fulfilment.method),
        distribution_party: nullableText(fulfilment.distributionParty),
        latest_delivery_date: isoDate(fulfilment.latestDeliveryDate),
      };
      const sourcePointer = `/operational/shipmentDetails/${shipmentIndex}/detail/shipmentItems/${itemIndex}`;
      facts.outbound_shipment_items.push(await fact(itemFields, `${shipmentId}|${orderItemId}`, "commercial", sourcePointer, shipmentAt, now));
      const candidate = {
        ...itemFields,
        sourcePointer,
        _line_gross_minor: lineGrossMinor,
        _commission_minor: commissionMinor,
      };
      const matchKey = `${orderId || ""}|${ean}`;
      shipmentCandidates.set(matchKey, [...(shipmentCandidates.get(matchKey) || []), candidate]);
      const metric = metricFor(ean);
      metric.grossUnits += quantityShipped;
      metric.grossGmsMinor += lineGrossMinor;
      metric.grossCommissionMinor += commissionMinor;
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
    const registeredDate = dateFromTimestamp(returnRow.registrationDateTime);
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
      assertContract(rmaId && /^\d{13}$/.test(ean) && Number.isSafeInteger(expectedQuantity) && expectedQuantity > 0, "INVALID_RETURN_ITEM", `Return ${returnId} contains an invalid item at index ${itemIndex}.`);
      commercialEans.add(ean);
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
      const candidate = candidates.length === 1 ? candidates[0] : null;
      const allocationKey = candidate ? `${text(candidate.shipment_id)}|${text(candidate.order_item_id)}` : null;
      if (orderId && candidate && allocationKey) {
        const group = matchedReturnGroups.get(allocationKey) || { candidate, returns: [] };
        group.returns.push({ rmaId, expectedQuantity });
        matchedReturnGroups.set(allocationKey, group);
      } else {
        metric.unlinkedReturns += expectedQuantity;
        const missingOrderId = !orderId;
        const ambiguous = candidates.length > 1;
        const exceptionCode = missingOrderId
          ? "RETURN_MISSING_ORDER_ID"
          : ambiguous
          ? "AMBIGUOUS_RETURN_MATCH"
          : "UNMATCHED_RETURN";
        const exceptionTitle = missingOrderId
          ? "Return has no order ID"
          : ambiguous
          ? "Return has several possible shipment matches"
          : "Return has no shipment match in this week";
        const limitation = missingOrderId
          ? "Return could not be linked because its order ID is missing."
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
            evidence: { orderId, expectedQuantity, candidateCount: candidates.length },
          },
        ));
      }
    }
  }

  for (const [allocationKey, group] of [...matchedReturnGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const candidate = group.candidate;
    const ean = text(candidate.ean);
    const metric = metricFor(ean);
    const shipmentQuantity = integer(candidate.quantity_shipped);
    const groupedReturns = [...group.returns].sort((left, right) => left.rmaId.localeCompare(right.rmaId));
    const aggregateReturnQuantity = groupedReturns.reduce((sum, item) => sum + item.expectedQuantity, 0);
    const lineGrossMinor = candidate._line_gross_minor as bigint;
    const commissionMinor = candidate._commission_minor as bigint;

    if (aggregateReturnQuantity <= shipmentQuantity) {
      metric.linkedReturns += aggregateReturnQuantity;
      metric.linkedReturnGmsMinor += allocateMinor(lineGrossMinor, aggregateReturnQuantity, shipmentQuantity);
      metric.linkedReturnCommissionMinor += allocateMinor(commissionMinor, aggregateReturnQuantity, shipmentQuantity);
      continue;
    }

    metric.unlinkedReturns += aggregateReturnQuantity;
    unmatchedReturnUnits += aggregateReturnQuantity;
    const limitation = "No return in the shipment group received a financial allocation because aggregate RMA quantity exceeds shipped quantity.";
    metric.limitations.push(limitation);
    exceptions.push(exception(
      "RETURN_GROUP_QUANTITY_EXCEEDS_SHIPMENT",
      "return_adjusted_trading",
      "warning",
      "Aggregate return quantity exceeds the uniquely matched shipment item",
      `Shipment item ${allocationKey} has ${aggregateReturnQuantity} returned units against ${shipmentQuantity} shipped units; the complete group remains financially unallocated.`,
      {
        businessKey: allocationKey,
        ean,
        evidence: {
          allocationPolicy: "all_or_none_by_unique_shipment_item",
          shipmentId: candidate.shipment_id,
          orderItemId: candidate.order_item_id,
          shipmentQuantity,
          aggregateReturnQuantity,
          returnItems: groupedReturns,
        },
      },
    ));
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
  const catalogOfferByEan = new Map<string, string>();
  const catalogEanByOfferId = new Map<string, string>();
  let fbbOffers = 0;
  for (let offerIndex = 0; offerIndex < offers.length; offerIndex += 1) {
    const offer = offers[offerIndex];
    const offerId = text(offer.offerId);
    const ean = text(offer.ean);
    assertContract(offerId && /^\d{13}$/.test(ean), "INVALID_CATALOG_OFFER", `Catalog offer ${offerIndex} is missing a valid offer ID or EAN.`);
    assertContract(!offerIds.has(offerId), "DUPLICATE_OFFER_ID", `Offer ID ${offerId} occurs more than once in the catalog source.`);
    assertContract(!offerEans.has(ean), "DUPLICATE_OFFER_EAN", `EAN ${ean} occurs more than once in the catalog source.`);
    const commercialOfferEan = commercialEanByOfferId.get(offerId);
    assertContract(
      !commercialOfferEan || commercialOfferEan === ean,
      "CATALOG_COMMERCIAL_OFFER_ID_CONFLICT",
      `Catalog offer ${offerId} belongs to EAN ${ean}, but shipment evidence associates it with ${commercialOfferEan}.`,
    );
    offerIds.add(offerId);
    offerEans.add(ean);
    catalogOfferByEan.set(ean, offerId);
    catalogEanByOfferId.set(offerId, ean);
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

  const insightRowsValue = weekMetrics.offerInsights;
  assertContract(
    Array.isArray(insightRowsValue) && insightRowsValue.every(isRecord),
    "INVALID_INSIGHT_ROWS",
    "insights.json offerInsights must be an array of objects.",
  );
  const insightRows = insightRowsValue as JsonRecord[];
  const expectedInsightDates = new Set(
    Array.from({ length: 7 }, (_, index) => addUtcDays(claim.periodStart, index) as string),
  );
  const hasExactWeek = (dates: Set<string> | undefined) =>
    dates?.size === expectedInsightDates.size && [...expectedInsightDates].every(date => dates.has(date));
  const visitDatesByEan = new Map<string, Set<string>>();
  const buyBoxDatesByEan = new Map<string, Set<string>>();
  const seenVisitTotals = new Set<string>();
  const seenBuyBoxDates = new Set<string>();
  const seenInsightCountries = new Set<string>();
  for (let insightIndex = 0; insightIndex < insightRows.length; insightIndex += 1) {
    const insight = insightRows[insightIndex];
    const ean = text(insight.ean);
    const offerId = text(insight.offerId);
    const metricName = text(insight.metric);
    assertContract(/^\d{13}$/.test(ean), "INVALID_INSIGHT_EAN", `Insight row ${insightIndex} has an invalid EAN.`);
    assertContract(Boolean(offerId), "INVALID_INSIGHT_OFFER_ID", `Insight row ${insightIndex} has no offer ID.`);
    assertContract(["PRODUCT_VISITS", "BUY_BOX_PERCENTAGE"].includes(metricName), "INVALID_INSIGHT_METRIC", `Insight row ${insightIndex} has unsupported metric ${metricName || "empty"}.`);
    const catalogOfferId = catalogOfferByEan.get(ean);
    const knownOfferEan = catalogEanByOfferId.get(offerId) || commercialEanByOfferId.get(offerId);
    assertContract(
      Boolean(catalogOfferId) || commercialEans.has(ean),
      "INSIGHT_EAN_WITHOUT_SOURCE_IDENTITY",
      `Insight row ${insightIndex} references EAN ${ean}, which is absent from validated catalog and commercial evidence.`,
    );
    assertContract(
      !knownOfferEan || knownOfferEan === ean,
      "INSIGHT_OFFER_ID_BELONGS_TO_DIFFERENT_EAN",
      `Insight row ${insightIndex} uses offer ${offerId}, which belongs to validated EAN ${knownOfferEan}.`,
    );
    if (catalogOfferId) {
      assertContract(
        catalogOfferId === offerId,
        "INSIGHT_OFFER_ID_MISMATCH",
        `Insight row ${insightIndex} must use catalog offer ${catalogOfferId} for EAN ${ean}.`,
      );
    } else {
      const commercialOfferIds = commercialOfferIdsByEan.get(ean);
      assertContract(
        commercialOfferIds && commercialOfferIds.size > 0,
        "INSIGHT_COMMERCIAL_OFFER_IDENTITY_MISSING",
        `Insight row ${insightIndex} references commercial-only EAN ${ean} without a validated shipment offer identity.`,
      );
      assertContract(
        commercialOfferIds.size === 1,
        "INSIGHT_COMMERCIAL_OFFER_IDENTITY_AMBIGUOUS",
        `Commercial-only EAN ${ean} has conflicting shipment offer identities.`,
      );
      assertContract(
        commercialOfferIds.has(offerId),
        "INSIGHT_COMMERCIAL_OFFER_ID_MISMATCH",
        `Insight row ${insightIndex} must use the unique validated shipment offer for commercial-only EAN ${ean}.`,
      );
    }
    assertContract(
      Array.isArray(insight.periods) && insight.periods.every(isRecord),
      "INVALID_INSIGHT_PERIODS",
      `${metricName} for EAN ${ean} must contain an array of period objects.`,
    );
    const periods = insight.periods as JsonRecord[];
    for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
      const period = periods[periodIndex];
      const date = periodDate(period);
      assertContract(date, "INVALID_INSIGHT_DATE", `${metricName} for EAN ${ean} has an invalid date at period ${periodIndex}.`);
      assertContract(expectedInsightDates.has(date), "OUT_OF_PERIOD_INSIGHT", `${metricName} for EAN ${ean} contains ${date}, outside ${claim.periodStart} through ${claim.periodEnd}.`);
      if (metricName === "BUY_BOX_PERCENTAGE") {
        const buyBoxDateKey = `${ean}|${date}`;
        assertContract(!seenBuyBoxDates.has(buyBoxDateKey), "DUPLICATE_BUY_BOX_DATE", `Buy Box data for EAN ${ean} contains date ${date} more than once.`);
        seenBuyBoxDates.add(buyBoxDateKey);
      }
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
      const countriesValue = period.countries ?? [];
      assertContract(
        Array.isArray(countriesValue) && countriesValue.every(isRecord),
        "INVALID_INSIGHT_COUNTRIES",
        `${metricName} for EAN ${ean} on ${date} must contain an array of country objects.`,
      );
      const countries = countriesValue as JsonRecord[];
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
    assertContract(rankDate, "INVALID_RANK_DATE", `Rank call ${callIndex} must use a canonical calendar-valid YYYY-MM-DD date.`);
    assertContract(rankDate >= claim.periodStart && rankDate <= claim.periodEnd, "OUT_OF_PERIOD_RANK_CALL", `Rank call ${callIndex} is outside ${claim.periodStart} through ${claim.periodEnd}.`);
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
  const catalogStatus = text(record(sourceDatasetStatuses.catalog).status);
  const insightsStatus = text(record(sourceDatasetStatuses.insights).status);
  const financialStatus = text(record(sourceDatasetStatuses.financial).status);
  const shipmentReady = commercialStatus === "complete" && invalidShipmentDetails === 0;
  const catalogReady = catalogStatus === "complete";
  const insightsReady = insightsStatus === "complete";
  qualityChecks.push(check("SHIPMENT_DETAILS_VALID", "shipment_facts", "error", shipmentReady ? "passed" : "failed", shipmentReady ? "All shipment details are valid and complete." : "One or more shipment details are missing or invalid.", { datasetStatus: "complete", invalidDetails: 0 }, { datasetStatus: commercialStatus, invalidDetails: invalidShipmentDetails }));
  qualityChecks.push(check("CATALOG_SOURCE_VALID", "catalog_offers", "error", catalogReady ? "passed" : "failed", catalogReady ? "The complete current-offer catalog defines the weekly product universe." : "The current-offer catalog is incomplete, so catalog-dependent coverage cannot be proven.", { datasetStatus: "complete" }, { datasetStatus: catalogStatus, offerCount: offers.length }));
  qualityChecks.push(check("RETURN_MATCH_COVERAGE", "return_adjusted_trading", unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "warning" : "info", unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "warning" : "passed", unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "Some registered returns remain outside the provisional financial adjustment." : "Every registered return was linked exactly once.", { unmatchedUnits: 0, ambiguousUnits: 0 }, { unmatchedUnits: unmatchedReturnUnits, ambiguousUnits: ambiguousReturnUnits }));
  const expectedRankCalls = offerEans.size * 7 * EXPECTED_RANK_LOCALES.size;
  const ranksReady = catalogReady && insightsReady && rankCombinations.size === expectedRankCalls && rankCalls.every(row => integer(row.status) === 200);
  qualityChecks.push(check("RANK_CALL_COVERAGE", "keyword_ranks", "error", ranksReady ? "passed" : "failed", ranksReady ? "All expected EAN/date/locale rank calls are present." : "Rank-call coverage is incomplete.", { combinations: expectedRankCalls }, { combinations: rankCombinations.size, rows: rankCalls.length, sourceDatasetStatus: insightsStatus }));
  const weeklyProductEans = [...productMetrics.keys()];
  const visitCoverageReady = catalogReady && insightsReady && weeklyProductEans.every(ean => hasExactWeek(visitDatesByEan.get(ean)));
  qualityChecks.push(check("PRODUCT_VISIT_DATE_COVERAGE", "product_visits", "error", visitCoverageReady ? "passed" : "failed", visitCoverageReady ? "Every weekly product has exactly the seven claimed product-visit dates." : "At least one weekly product is missing an exact claimed-week visit date set or a required source dataset is incomplete.", { dates: [...expectedInsightDates], sourceDatasetStatus: "complete" }, { catalogDatasetStatus: catalogStatus, insightsDatasetStatus: insightsStatus, datesByEan: Object.fromEntries(weeklyProductEans.map(ean => [ean, [...(visitDatesByEan.get(ean) || [])].sort()])) }));
  const buyBoxInputsReady = catalogReady && insightsReady;
  const buyBoxCoverageReady = buyBoxInputsReady && offers.every(offer => hasExactWeek(buyBoxDatesByEan.get(text(offer.ean))));
  const buyBoxResult = !buyBoxInputsReady ? "failed" : buyBoxCoverageReady ? "passed" : "warning";
  qualityChecks.push(check("BUY_BOX_DATE_COVERAGE", "buy_box", buyBoxInputsReady ? "warning" : "error", buyBoxResult, buyBoxCoverageReady ? "Every current offer has seven Buy Box dates." : "At least one current offer is missing Buy Box dates or a required source dataset is incomplete; missing countries remain missing rather than zero.", { datesPerOffer: 7, sourceDatasetStatus: "complete" }, { catalogDatasetStatus: catalogStatus, insightsDatasetStatus: insightsStatus, datesByEan: Object.fromEntries([...buyBoxDatesByEan].map(([ean, dates]) => [ean, dates.size])) }));
  const invoicesReady = financialStatus === "complete";
  qualityChecks.push(check("INVOICE_SOURCE_VALID", "invoices", "error", invoicesReady ? "passed" : "failed", invoicesReady ? "Invoice list and requested specifications passed the source contract." : "The financial source dataset is incomplete.", { datasetStatus: "complete" }, { datasetStatus: financialStatus, invoiceCount: invoices.length, transactionCount: facts.invoice_transactions.length }));
  qualityChecks.push(check("FBB_INVENTORY_APPLICABILITY", "fbb_inventory", catalogReady ? "info" : "error", !catalogReady ? "failed" : fbbOffers > 0 ? "passed" : "not_applicable", !catalogReady ? "FBB applicability cannot be established because the catalog source is incomplete." : fbbOffers > 0 ? "FBB offers exist, so FBB inventory observations are applicable." : "All current offers are FBR; FBB inventory is not applicable.", null, { catalogDatasetStatus: catalogStatus, fbbOffers, totalOffers: offers.length }));
  const allShipmentCountriesPresent = facts.outbound_shipments.every(row => Boolean(row.country_code));
  qualityChecks.push(check("SHIPMENT_COUNTRY_COVERAGE", "country_split", "warning", allShipmentCountriesPresent ? "passed" : "warning", allShipmentCountriesPresent ? "Every shipment has a country code." : "Country reporting remains limited because at least one shipment has no country code.", { missing: 0 }, { missing: facts.outbound_shipments.filter(row => !row.country_code).length }));
  qualityChecks.push(check("ORDER_COHORT_CONVERSION", "order_cohort_conversion", "info", "not_applicable", "Order-cohort conversion is not produced from same-week visits and shipments.", null, null));

  const dataProductRevisions = [
    { data_product: "shipment_facts", status: shipmentReady ? "ready" : "not_ready", limitations: shipmentReady ? [] : ["Shipment source data is incomplete."], is_active: shipmentReady },
    { data_product: "registered_return_events", status: commercialStatus === "complete" ? "ready" : "not_ready", limitations: [], is_active: commercialStatus === "complete" },
    { data_product: "return_adjusted_trading", status: !shipmentReady ? "not_ready" : unmatchedReturnUnits + ambiguousReturnUnits > 0 ? "ready_with_limits" : "ready", limitations: unmatchedReturnUnits + ambiguousReturnUnits > 0 ? ["Unmatched or ambiguous returns are excluded from the provisional value adjustment."] : [], is_active: shipmentReady },
    { data_product: "catalog_offers", status: catalogReady ? "ready" : "not_ready", limitations: catalogReady ? [] : ["The current-offer catalog source is incomplete."], is_active: catalogReady },
    { data_product: "product_visits", status: visitCoverageReady ? "ready" : "not_ready", limitations: visitCoverageReady ? [] : ["Not every weekly product has seven aligned visit dates from complete catalog and insights sources."], is_active: visitCoverageReady },
    { data_product: "keyword_ranks", status: ranksReady ? "ready" : "not_ready", limitations: ranksReady ? [] : ["Rank-call coverage is incomplete."], is_active: ranksReady },
    { data_product: "buy_box", status: !buyBoxInputsReady ? "not_ready" : buyBoxCoverageReady ? "ready" : "ready_with_limits", limitations: buyBoxCoverageReady ? [] : [buyBoxInputsReady ? "At least one Buy Box date is missing." : "The catalog or insights source is incomplete."], is_active: buyBoxInputsReady },
    { data_product: "invoices", status: invoicesReady ? "ready" : "not_ready", limitations: invoicesReady ? [] : ["The financial source dataset is incomplete."], is_active: invoicesReady },
    { data_product: "fbb_inventory", status: !catalogReady ? "not_ready" : fbbOffers > 0 ? "ready" : "not_applicable", limitations: !catalogReady ? ["The catalog source is incomplete."] : fbbOffers > 0 ? [] : ["All current offers use FBR."], is_active: catalogReady },
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
    const grossGmsMinor = metric.grossGmsMinor;
    const grossCommissionMinor = metric.grossCommissionMinor;
    const linkedReturnGmsMinor = metric.linkedReturnGmsMinor;
    const linkedReturnCommissionMinor = metric.linkedReturnCommissionMinor;
    const provisionalNetGmsMinor = grossGmsMinor - linkedReturnGmsMinor;
    const provisionalAfterCommissionMinor = provisionalNetGmsMinor
      - (grossCommissionMinor - linkedReturnCommissionMinor);
    const grossGms = minorToMajor(grossGmsMinor);
    const grossCommission = minorToMajor(grossCommissionMinor);
    const linkedReturnGms = minorToMajor(linkedReturnGmsMinor);
    const linkedReturnCommission = minorToMajor(linkedReturnCommissionMinor);
    const provisionalNetGms = minorToMajor(provisionalNetGmsMinor);
    const provisionalAfterCommission = minorToMajor(provisionalAfterCommissionMinor);
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
      gross_shipped_asp: metric.grossUnits ? scaledRatioToNumber(grossGmsMinor, BigInt(metric.grossUnits) * 100n, 4) : null,
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
        roundingPolicy: "Shipment lines and grouped return allocations use integer minor units with deterministic half-up division.",
        minorUnits: {
          grossShippedGms: grossGmsMinor.toString(),
          grossCommission: grossCommissionMinor.toString(),
          linkedReturnGms: linkedReturnGmsMinor.toString(),
          linkedReturnCommission: linkedReturnCommissionMinor.toString(),
          provisionalNetGms: provisionalNetGmsMinor.toString(),
          provisionalRevenueAfterCommission: provisionalAfterCommissionMinor.toString(),
        },
        grossShippedGms: `${metric.grossUnits} shipped units valued from exact shipment-line minor units`,
        linkedReturnGms: `${metric.linkedReturns} return units allocated from exact shipment-line minor units`,
        provisionalNetGms: "gross shipped GMS minor units - linked return GMS minor units",
        revenueAfterCommission: "provisional net GMS minor units - (gross commission minor units - linked return commission minor units)",
      },
    };
  });
  const reportStatus = !shipmentReady || !catalogReady || !visitCoverageReady ? "not_ready" : unmatchedReturnUnits + ambiguousReturnUnits > 0 || !buyBoxCoverageReady || !allShipmentCountriesPresent ? "ready_with_limits" : "ready";

  const completedAt = new Date().toISOString();
  const steps = [
    { step_code: "source_validation", status: "passed", input_count: EXPECTED_ARTIFACTS.length + 1, output_count: loaded.evidence.length, started_at: now, completed_at: completedAt, detail: { sourceContractVersion: SOURCE_CONTRACT_VERSION } },
    { step_code: "commercial", status: shipmentReady ? "passed" : "failed", input_count: shipmentDetails.length + returnRows.length, output_count: facts.outbound_shipment_items.length + facts.return_items.length, started_at: now, completed_at: completedAt, detail: {} },
    { step_code: "catalog", status: catalogReady ? "passed" : "failed", input_count: offers.length, output_count: facts.offer_observations.length, started_at: now, completed_at: completedAt, detail: { sourceDatasetStatus: catalogStatus } },
    { step_code: "insights", status: !visitCoverageReady || !ranksReady || !buyBoxInputsReady ? "failed" : !buyBoxCoverageReady ? "warning" : "passed", input_count: insightRows.length + rankCalls.length, output_count: facts.offer_insight_daily.length + facts.keyword_rank_daily.length, started_at: now, completed_at: completedAt, detail: { sourceDatasetStatus: insightsStatus } },
    { step_code: "financial", status: invoicesReady ? "passed" : "failed", input_count: invoices.length, output_count: facts.invoice_transactions.length, started_at: now, completed_at: completedAt, detail: {} },
    { step_code: "quality", status: qualityChecks.some(row => row.result === "failed") ? "failed" : qualityChecks.some(row => row.result === "warning") ? "warning" : "passed", input_count: qualityChecks.length, output_count: exceptions.length, started_at: now, completed_at: completedAt, detail: {} },
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
