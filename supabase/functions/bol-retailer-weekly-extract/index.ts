import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const TOKEN_URL = "https://login.bol.com/token?grant_type=client_credentials";
const API_URL = "https://api.bol.com/retailer";
const ACCEPT_V10 = "application/vnd.retailer.v10+json";
const ACCEPT_V11 = "application/vnd.retailer.v11+json";
const USER_AGENT = "Aterra-Retailer-Weekly-Cloud-Extractor/3.0";
const BUCKET = "bol-retailer-api-json";
const TIMEZONE = "Europe/Amsterdam";
const MAX_PAGES = 200;
const REQUEST_TIMEOUT_MS = 25_000;
const STALE_RUN_MINUTES = 20;
const SNAPSHOT_SCHEMA_VERSION = "3.0";
const RUN_TABLE = "bol_retailer_api_extract_runs";

const KEYWORD_CONFIG = {
  locales: ["nl-NL", "nl-BE", "fr-BE"],
  products: {
    "8720892887504": {
      shortName: "Water Karaf",
      primaryKeyword: "waterkaraf",
      secondaryKeywords: ["karaf", "waterkan", "glazen karaf"],
      strategicKeywords: ["waterkaraf glas", "karaf met dop"],
    },
    "8720892887511": {
      shortName: "Stainless Steel Waterkan",
      primaryKeyword: "waterkaraf",
      secondaryKeywords: ["kan", "karaf", "waterkan"],
      strategicKeywords: ["waterkan rvs", "rvs karaf"],
    },
    "8720892887528": {
      shortName: "XL Sporttas",
      primaryKeyword: "sporttas",
      secondaryKeywords: ["gymtas", "sporttas dames", "sporttas met schoenenvak"],
      strategicKeywords: ["reistas sporttas", "sporttas heren", "voetbaltas kinderen"],
    },
    "6970452112658": {
      shortName: "Besrey Fort Kit",
      primaryKeyword: "hut bouwen",
      secondaryKeywords: ["speeltent", "bouwpakket kinderen"],
      strategicKeywords: ["fort bouwen", "hut bouwen kinderen"],
    },
  },
} as const;

type JsonRecord = Record<string, unknown>;
type CallState = {
  args: {
    start: string;
    end: string;
    rankMode: "primary" | "none";
    maxPages: number;
  };
  token: string;
  apiCalls: JsonRecord[];
  paginationWarnings: string[];
};

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
        const dictionary = parsed as Record<string, unknown>;
        if (typeof dictionary.default === "string" && dictionary.default.trim()) return dictionary.default.trim();
        const values = Object.values(dictionary).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
        if (values[0]) return values[0];
      }
    } catch {
      if (secretKeys.trim().startsWith("sb_secret_")) return secretKeys.trim();
    }
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

function dateInAmsterdam(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: values.weekday,
  };
}

function dateAdd(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekStart(dateString: string) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function previousCompletedWeek(todayAmsterdam: string) {
  const thisMonday = isoWeekStart(todayAmsterdam);
  const start = dateAdd(thisMonday, -7);
  return { start, end: dateAdd(start, 6) };
}

function weekParts(start: string) {
  const date = new Date(`${start}T00:00:00.000Z`);
  const thursday = new Date(date);
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return {
    isoYear: thursday.getUTCFullYear(),
    isoWeek: week,
    label: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
  };
}

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  let current = start;
  while (current <= end && dates.length < 31) {
    dates.push(current);
    current = dateAdd(current, 1);
  }
  return dates;
}

function isoDate(value: unknown) {
  return String(value || "").slice(0, 10);
}

function periodDate(row: JsonRecord) {
  const direct = isoDate(row.date);
  if (direct) return direct;
  const period = row.period as JsonRecord | undefined;
  const year = Number(period?.year || 0);
  const month = Number(period?.month || 0);
  const day = Number(period?.day || 0);
  if (!year || !month || !day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inRange(dateLike: unknown, start: string, end: string) {
  const date = isoDate(dateLike);
  return date >= start && date <= end;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rateHeaders(headers: Headers) {
  const get = (name: string) => headers.get(name) || headers.get(name.toLowerCase()) || null;
  return {
    limit: get("x-ratelimit-limit"),
    remaining: get("x-ratelimit-remaining"),
    reset: get("x-ratelimit-reset"),
    retryAfter: get("retry-after"),
  };
}

function redactIdentifier(value: unknown) {
  const text = String(value || "");
  if (text.length <= 8) return text ? "<redacted>" : text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sanitize(value: unknown, key = ""): unknown {
  const lower = key.toLowerCase();
  if (["shipmentdetails", "billingdetails"].includes(lower)) {
    const details = value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
    const countryCode = details.countryCode || details.country || null;
    return countryCode ? { countryCode: String(countryCode) } : "<redacted>";
  }
  if (["customercomments", "email", "emailaddress", "phonenumber", "signature", "secret", "clientsecret", "access_token", "privatekey"].includes(lower)) return "<redacted>";
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (!value || typeof value !== "object") return value;
  const result: JsonRecord = {};
  for (const [childKey, childValue] of Object.entries(value as JsonRecord)) {
    result[childKey] = sanitize(childValue, childKey);
  }
  return result;
}

function rowsFromPage(payload: unknown, keys: string[]) {
  const record = payload && typeof payload === "object" ? payload as JsonRecord : {};
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as JsonRecord[];
  }
  return [];
}

function rowsFromPageWithContract(payload: unknown, keys: string[]) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as JsonRecord : null;
  if (!record) return { rows: [] as JsonRecord[], matchedKey: null as string | null };
  for (const key of keys) {
    if (Array.isArray(record[key])) return { rows: record[key] as JsonRecord[], matchedKey: key };
  }
  return { rows: [] as JsonRecord[], matchedKey: null as string | null };
}

function markResponseShapeError(state: CallState, label: string, rowKeys: string[]) {
  const call = state.apiCalls[state.apiCalls.length - 1];
  if (call) Object.assign(call, { ok: false, contractValid: false, errorClass: "response_shape", paginationComplete: false });
  state.paginationWarnings.push(`${label} response contract mismatch: expected one of ${rowKeys.join(", ")}.`);
}

function callSummary(input: {
  label: string;
  method: string;
  pathname: string;
  status: number;
  ok: boolean;
  startedAt: number;
  response?: Response;
  rows?: number;
  page?: number;
  cursor?: string | null;
  paginationComplete?: boolean;
  attempt?: number;
  final?: boolean;
  errorClass?: string | null;
}) {
  return {
    label: input.label,
    method: input.method,
    path: input.pathname,
    status: input.status,
    ok: input.ok,
    ms: Date.now() - input.startedAt,
    rows: input.rows,
    page: input.page,
    cursor: input.cursor ? "<present>" : null,
    paginationComplete: input.paginationComplete,
    attempt: input.attempt,
    final: input.final ?? true,
    errorClass: input.errorClass || null,
    rate: input.response ? rateHeaders(input.response.headers) : null,
  };
}

async function getToken() {
  const clientId = env("BOL_RETAILER_CLIENT_ID");
  const clientSecret = env("BOL_RETAILER_CLIENT_SECRET");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "user-agent": USER_AGENT,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Bol authentication failed with HTTP ${response.status}.`);
  return String(body.access_token);
}

async function retailerRequest(
  state: CallState,
  input: {
    label: string;
    path: string;
    method?: string;
    accept?: string;
    body?: unknown;
    query?: Record<string, unknown>;
    language?: string;
    contentType?: string;
  },
) {
  const method = input.method || "GET";
  const url = new URL(`${API_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          accept: input.accept || ACCEPT_V10,
          ...(input.body ? { "content-type": input.contentType || "application/json" } : {}),
          ...(input.language ? { "accept-language": input.language } : {}),
          authorization: `Bearer ${state.token}`,
          "user-agent": USER_AGENT,
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      const final = attempt === 4;
      state.apiCalls.push(callSummary({
        label: input.label,
        method,
        pathname: input.path,
        status: 599,
        ok: false,
        startedAt,
        attempt,
        final,
        errorClass: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network",
      }));
      if (final) return { status: 599, ok: false, payload: {} };
      await sleep((attempt * 1000) + Math.floor(Math.random() * 500));
      continue;
    }
    clearTimeout(timeout);
    if (response.status === 401 && attempt < 4) {
      state.apiCalls.push(callSummary({
        label: input.label,
        method,
        pathname: input.path,
        status: response.status,
        ok: false,
        startedAt,
        response,
        attempt,
        final: false,
        errorClass: "token_expired",
      }));
      state.token = await getToken();
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      state.apiCalls.push(callSummary({
        label: input.label,
        method,
        pathname: input.path,
        status: response.status,
        ok: false,
        startedAt,
        response,
        attempt,
        final: false,
        errorClass: response.status === 429 ? "rate_limited" : "server",
      }));
      const retrySeconds = Math.min(30, Math.max(1, Number(response.headers.get("retry-after")) || attempt));
      await sleep((retrySeconds * 1000) + Math.floor(Math.random() * 500));
      continue;
    }
    const responseText = await response.text().catch(() => "");
    let payload: unknown = {};
    let validJson = true;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        validJson = false;
        payload = { text: responseText.slice(0, 2_000) };
      }
    }
    state.apiCalls.push(callSummary({
      label: input.label,
      method,
      pathname: input.path,
      status: response.status,
      ok: response.ok,
      startedAt,
      response,
      attempt,
      final: true,
      errorClass: response.ok ? null : response.status === 429 ? "rate_limited" : response.status >= 500 ? "server" : "client",
    }));
    if (response.ok && !validJson) {
      Object.assign(state.apiCalls[state.apiCalls.length - 1], { ok: false, contractValid: false, errorClass: "invalid_json" });
    }
    return { status: response.status, ok: response.ok && validJson, payload };
  }
  return { status: 429, ok: false, payload: {} };
}

async function collectPageEndpoint(
  state: CallState,
  input: {
    pathname: string;
    label: string;
    rowKeys: string[];
    query?: Record<string, unknown>;
    accept?: string;
    stopWhenOlderThanStart?: string;
    pageDelayMs?: number;
    allowEmptyObject?: boolean;
  },
) {
  const rows: JsonRecord[] = [];
  let completed = false;
  for (let page = 1; page <= state.args.maxPages; page += 1) {
    const result = await retailerRequest(state, {
      label: `${input.label}.page${page}`,
      path: input.pathname,
      accept: input.accept || ACCEPT_V10,
      query: { ...(input.query || {}), page },
    });
    const extracted = rowsFromPageWithContract(result.payload, input.rowKeys);
    const explicitEmpty = input.allowEmptyObject === true
      && result.payload !== null
      && typeof result.payload === "object"
      && !Array.isArray(result.payload)
      && Object.keys(result.payload as JsonRecord).length === 0;
    const pageRows = extracted.rows;
    Object.assign(state.apiCalls[state.apiCalls.length - 1], {
      rows: pageRows.length,
      page,
      contractValid: !result.ok || extracted.matchedKey !== null || explicitEmpty,
      paginationComplete: result.ok && (extracted.matchedKey !== null || explicitEmpty) && pageRows.length === 0,
    });
    if (!result.ok) break;
    if (!extracted.matchedKey && !explicitEmpty) {
      markResponseShapeError(state, input.label, input.rowKeys);
      break;
    }
    rows.push(...pageRows);
    if (pageRows.length === 0) {
      completed = true;
      break;
    }
    if (input.stopWhenOlderThanStart && pageRows.every(row => isoDate(row[input.stopWhenOlderThanStart!]) < state.args.start)) {
      completed = true;
      Object.assign(state.apiCalls[state.apiCalls.length - 1], { paginationComplete: true });
      break;
    }
    await sleep(input.pageDelayMs ?? 160);
  }
  if (!completed) {
    state.paginationWarnings.push(`${input.label} pagination incomplete: request failed or ${state.args.maxPages}-page safety cap reached.`);
  }
  return rows;
}

async function collectOffers(state: CallState) {
  const offers: JsonRecord[] = [];
  let cursor: string | null = null;
  let completed = false;
  for (let page = 1; page <= state.args.maxPages; page += 1) {
    const result = await retailerRequest(state, {
      label: `offers.v11.cursor${page}`,
      path: "/offers",
      accept: ACCEPT_V11,
      query: { "page-size": 100, cursor },
    });
    const extracted = rowsFromPageWithContract(result.payload, ["offers"]);
    const rows = extracted.rows;
    const payload = result.payload as JsonRecord;
    const nextCursor = ((payload.page as JsonRecord | undefined)?.nextCursor || payload.nextCursor || null) as string | null;
    Object.assign(state.apiCalls[state.apiCalls.length - 1], {
      rows: rows.length,
      cursor,
      contractValid: !result.ok || extracted.matchedKey !== null,
      paginationComplete: result.ok && extracted.matchedKey !== null && !nextCursor,
    });
    if (!result.ok) break;
    if (!extracted.matchedKey) {
      markResponseShapeError(state, "offers", ["offers"]);
      break;
    }
    offers.push(...rows);
    if (!nextCursor) {
      completed = true;
      break;
    }
    if (nextCursor === cursor) {
      state.paginationWarnings.push("offers returned a repeated cursor; collection stopped.");
      break;
    }
    cursor = nextCursor;
    await sleep(160);
  }
  if (!completed) state.paginationWarnings.push("offers pagination incomplete: request failed, cursor repeated, or page safety cap reached.");
  return offers;
}

async function collectBodyPageEndpoint(
  state: CallState,
  input: {
    pathname: string;
    label: string;
    rowKeys: string[];
    body: JsonRecord;
    language?: string;
    allowEmptyObject?: boolean;
    emptyResponseKeys?: string[];
  },
) {
  const rows: JsonRecord[] = [];
  let completed = false;
  for (let page = 1; page <= state.args.maxPages; page += 1) {
    const result = await retailerRequest(state, {
      label: `${input.label}.page${page}`,
      path: input.pathname,
      method: "POST",
      body: { ...input.body, page },
      language: input.language,
    });
    const extracted = rowsFromPageWithContract(result.payload, input.rowKeys);
    const payloadKeys = result.payload !== null && typeof result.payload === "object" && !Array.isArray(result.payload)
      ? Object.keys(result.payload as JsonRecord)
      : [];
    const explicitEmpty = input.allowEmptyObject === true
      && result.payload !== null
      && typeof result.payload === "object"
      && !Array.isArray(result.payload)
      && (payloadKeys.length === 0 || payloadKeys.every(key => (input.emptyResponseKeys || []).includes(key)));
    const pageRows = extracted.rows;
    Object.assign(state.apiCalls[state.apiCalls.length - 1], {
      rows: pageRows.length,
      page,
      contractValid: !result.ok || extracted.matchedKey !== null || explicitEmpty,
      paginationComplete: result.ok && (extracted.matchedKey !== null || explicitEmpty) && pageRows.length === 0,
    });
    if (!result.ok) break;
    if (!extracted.matchedKey && !explicitEmpty) {
      markResponseShapeError(state, input.label, input.rowKeys);
      break;
    }
    rows.push(...pageRows);
    if (pageRows.length === 0) {
      completed = true;
      break;
    }
    await sleep(160);
  }
  if (!completed) state.paginationWarnings.push(`${input.label} pagination incomplete: request failed or page safety cap reached.`);
  return rows;
}

async function collectSingleListEndpoint(
  state: CallState,
  input: { pathname: string; label: string; rowKeys: string[]; query?: Record<string, unknown>; accept?: string },
) {
  const result = await retailerRequest(state, {
    label: input.label,
    path: input.pathname,
    accept: input.accept || ACCEPT_V10,
    query: input.query,
  });
  const extracted = rowsFromPageWithContract(result.payload, input.rowKeys);
  Object.assign(state.apiCalls[state.apiCalls.length - 1], {
    rows: extracted.rows.length,
    contractValid: !result.ok || extracted.matchedKey !== null,
    paginationComplete: result.ok && extracted.matchedKey !== null,
  });
  if (result.ok && !extracted.matchedKey) markResponseShapeError(state, input.label, input.rowKeys);
  return result.ok && extracted.matchedKey ? extracted.rows : [];
}

async function collectOfferInsights(state: CallState, offers: JsonRecord[]) {
  const rows: JsonRecord[] = [];
  for (const offer of offers) {
    if (!offer.offerId) continue;
    for (const metric of ["PRODUCT_VISITS", "BUY_BOX_PERCENTAGE"]) {
      const result = await retailerRequest(state, {
        label: `insight.offer.${metric}.${offer.ean}`,
        path: "/insights/offer",
        query: { "offer-id": offer.offerId, period: "DAY", "number-of-periods": 7, name: metric },
      });
      const insightContract = rowsFromPageWithContract(result.payload, ["offerInsights", "periods", "insights"]);
      if (result.ok && !insightContract.matchedKey) {
        markResponseShapeError(state, `insight.offer.${metric}.${offer.ean}`, ["offerInsights", "periods", "insights"]);
      }
      const insightRows = insightContract.rows;
      const offerInsights = rowsFromPage(result.payload, ["offerInsights"]);
      const periods = offerInsights.length && Array.isArray(offerInsights[0].periods)
        ? offerInsights[0].periods as JsonRecord[]
        : insightRows;
      const targetPeriods = periods.filter(row => inRange(periodDate(row), state.args.start, state.args.end));
      const additiveValues = targetPeriods.map(row => row.total ?? row.value ?? row.count);
      const weekTotal = metric === "PRODUCT_VISITS" && targetPeriods.length > 0 && additiveValues.every(value => Number.isFinite(Number(value)))
        ? additiveValues.reduce((sum, value) => sum + Number(value), 0)
        : null;
      const dailyCountryValues = targetPeriods.flatMap(row => {
        const date = periodDate(row);
        const countries = Array.isArray(row.countries) ? row.countries as JsonRecord[] : [];
        return countries.map(country => ({
          date,
          countryCode: String(country.countryCode || ""),
          value: country.value === null || country.value === undefined ? null : Number(country.value),
        })).filter(country => country.date && country.countryCode);
      });
      const sourceDates = periods.map(row => periodDate(row)).filter(Boolean).sort();
      rows.push({
        ean: offer.ean,
        offerId: offer.offerId,
        metric,
        period: "DAY",
        numberOfPeriods: 7,
        weekTotal: targetPeriods.length ? weekTotal : null,
        dailyCountryValues,
        targetPeriodAligned: result.ok && targetPeriods.length === 7 && new Set(targetPeriods.map(periodDate)).size === 7,
        sourcePeriod: {
          start: sourceDates[0] || null,
          end: sourceDates[sourceDates.length - 1] || null,
        },
        periods: sanitize(periods),
        status: result.status,
      });
      Object.assign(state.apiCalls[state.apiCalls.length - 1], { rows: periods.length });
      await sleep(90);
    }
  }
  return rows;
}

async function collectProductRanks(state: CallState, eans: string[], locales: string[]) {
  if (state.args.rankMode === "none") return [];
  const results: JsonRecord[] = [];
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
          const extracted = rowsFromPageWithContract(result.payload, ["ranks"]);
          const ranks = extracted.rows;
          const payload = result.payload as JsonRecord;
          const hasNextPage = payload.hasNextPage === true;
          Object.assign(state.apiCalls[state.apiCalls.length - 1], {
            rows: ranks.length,
            page,
            contractValid: !result.ok || extracted.matchedKey !== null,
            paginationComplete: result.ok && extracted.matchedKey !== null && !hasNextPage,
          });
          results.push({
            ean,
            date,
            locale,
            type: "SEARCH",
            page,
            status: result.status,
            data: {
              ranks: sanitize(ranks),
              hasNextPage,
            },
          });
          if (!result.ok) break;
          if (!extracted.matchedKey) {
            markResponseShapeError(state, `rank.${ean}.${date}.${locale}`, ["ranks"]);
            break;
          }
          if (!hasNextPage) break;
          if (page === state.args.maxPages) {
            state.paginationWarnings.push(`rank.${ean}.${date}.${locale} reached the page safety cap.`);
          }
          page += 1;
          await sleep(130);
        }
        await sleep(130);
      }
    }
  }
  return results;
}

function summarizeShipmentsByEan(shipmentDetails: JsonRecord[]) {
  const byEan = new Map<string, {
    orders: Set<string>;
    shipments: Set<string>;
    lines: number;
    units: number;
    grossOrderValue: number;
    commission: number;
  }>();
  for (const row of shipmentDetails) {
    const detail = row.detail as JsonRecord || {};
    const shipmentId = String(detail.shipmentId || row.shipmentId || "");
    const order = detail.order as JsonRecord | undefined;
    const orderId = String(order?.orderId || "");
    const shipmentItems = Array.isArray(detail.shipmentItems) ? detail.shipmentItems as JsonRecord[] : [];
    for (const item of shipmentItems) {
      const ean = String((item.product as JsonRecord | undefined)?.ean || item.ean || "");
      if (!ean) continue;
      const current = byEan.get(ean) || {
        orders: new Set<string>(),
        shipments: new Set<string>(),
        lines: 0,
        units: 0,
        grossOrderValue: 0,
        commission: 0,
      };
      const quantity = Number(item.quantityShipped || item.quantity || 0);
      const lineValue = Number(item.unitPrice || 0) * quantity;
      if (orderId) current.orders.add(orderId);
      if (shipmentId) current.shipments.add(shipmentId);
      current.lines += 1;
      current.units += quantity;
      current.grossOrderValue += lineValue;
      current.commission += Number(item.commission || 0);
      byEan.set(ean, current);
    }
  }
  return Object.fromEntries([...byEan.entries()].map(([ean, value]) => [ean, {
    orders: value.orders.size,
    shipments: value.shipments.size,
    lines: value.lines,
    units: value.units,
    grossOrderValue: Math.round((value.grossOrderValue + Number.EPSILON) * 100) / 100,
    commission: Math.round((value.commission + Number.EPSILON) * 100) / 100,
  }]));
}

function countCategoryTree(categories: JsonRecord[], depth = 1): { count: number; maxDepth: number } {
  let count = 0;
  let maxDepth = depth;
  for (const category of categories) {
    count += 1;
    const children = Array.isArray(category.subcategories) ? category.subcategories as JsonRecord[] : [];
    if (children.length) {
      const child = countCategoryTree(children, depth + 1);
      count += child.count;
      maxDepth = Math.max(maxDepth, child.maxDepth);
    }
  }
  return { count, maxDepth };
}

async function collectAdditionalSurfaces(state: CallState, eans: string[], offers: JsonRecord[]) {
  const calls: JsonRecord[] = [];
  const withLocalCalls = async <T>(fn: () => Promise<T>) => {
    const before = state.apiCalls.length;
    const result = await fn();
    calls.push(...state.apiCalls.slice(before));
    return result;
  };

  const productCategories = await withLocalCalls(async () => {
    const result = await retailerRequest(state, { label: "products.categories", path: "/products/categories", language: "nl" });
    const categories = rowsFromPage(result.payload, ["categories"]);
    const summary = countCategoryTree(categories);
    return { status: result.status, summary, sample: sanitize(categories.slice(0, 10)), raw: sanitize(result.payload) };
  });

  const productListFilters = [];
  for (const term of ["Aterra", "waterkaraf", "sporttas"]) {
    const result = await withLocalCalls(() => retailerRequest(state, {
      label: `products.listFilters.${term}`,
      path: "/products/list-filters",
      query: { "search-term": term, "country-code": "NL" },
      language: "nl",
    }));
    const payload = result.payload as JsonRecord;
    productListFilters.push({
      term,
      status: result.status,
      summary: {
        topKeys: Object.keys(payload).slice(0, 10),
        categories: rowsFromPage(payload, ["categories", "categoryValues"]).length,
        filters: Object.keys(payload).length,
      },
      sample: sanitize(payload),
    });
    await sleep(80);
  }

  const productRanks = [];
  const latestRankDate = dateAdd(dateInAmsterdam().date, -1);
  for (const ean of eans) {
    for (const type of ["SEARCH", "BROWSE"]) {
      const ranks: JsonRecord[] = [];
      let status = 200;
      let hasNextPage = false;
      for (let page = 1; page <= state.args.maxPages; page += 1) {
        const result = await withLocalCalls(() => retailerRequest(state, {
          label: `productRanks.${ean}.${type}.page${page}`,
          path: "/insights/product-ranks",
          query: { ean, date: latestRankDate, type, page },
          language: "nl-NL",
        }));
        status = result.status;
        const pageRows = rowsFromPage(result.payload, ["ranks"]);
        ranks.push(...pageRows);
        hasNextPage = (result.payload as JsonRecord).hasNextPage === true;
        Object.assign(state.apiCalls[state.apiCalls.length - 1], { rows: pageRows.length, page, paginationComplete: result.ok && !hasNextPage });
        if (!result.ok || !hasNextPage) break;
        await sleep(130);
      }
      if (hasNextPage) state.paginationWarnings.push(`current product rank ${ean}/${type} reached the page safety cap.`);
      productRanks.push({
        ean,
        type,
        date: latestRankDate,
        locale: "nl-NL",
        status,
        count: ranks.length,
        ranks: sanitize(ranks),
        paginationComplete: status >= 200 && status < 300 && !hasNextPage,
      });
      await sleep(130);
    }
  }

  const salesForecast = [];
  for (const offer of offers) {
    if (!offer.offerId) continue;
    for (const weeksAhead of [1, 4, 12]) {
      const result = await withLocalCalls(() => retailerRequest(state, {
        label: `salesForecast.${offer.ean}.${weeksAhead}`,
        path: "/insights/sales-forecast",
        query: { "offer-id": offer.offerId, "weeks-ahead": weeksAhead },
      }));
      salesForecast.push({
        ean: offer.ean,
        offerId: offer.offerId,
        weeksAhead,
        status: result.status,
        summary: sanitize(result.payload),
      });
      await sleep(80);
    }
  }

  const promotions: JsonRecord = { lists: [], details: [], products: [] };
  for (const promotionType of ["AWARENESS", "PRICE_OFF"]) {
    const promotionRows = await withLocalCalls(() => collectPageEndpoint(state, {
      pathname: "/promotions",
      label: `promotions.${promotionType}`,
      rowKeys: ["promotions"],
      query: { "promotion-type": promotionType },
    }));
    (promotions.lists as JsonRecord[]).push({ promotionType, count: promotionRows.length, rows: sanitize(promotionRows) });
    for (const promotion of promotionRows) {
      const promotionId = String(promotion.promotionId || promotion.id || "");
      if (!promotionId) continue;
      const detail = await withLocalCalls(() => retailerRequest(state, {
        label: `promotion.detail.${promotionId}`,
        path: `/promotions/${encodeURIComponent(promotionId)}`,
      }));
      (promotions.details as JsonRecord[]).push({
        promotionType,
        promotionId,
        status: detail.status,
        summary: sanitize(detail.payload),
      });
      const productRows = await withLocalCalls(() => collectPageEndpoint(state, {
        pathname: `/promotions/${encodeURIComponent(promotionId)}/products`,
        label: `promotion.products.${promotionId}`,
        rowKeys: ["products"],
      }));
      (promotions.products as JsonRecord[]).push({
        promotionType,
        promotionId,
        count: productRows.length,
        rows: sanitize(productRows),
      });
      await sleep(160);
    }
  }

  const replenishmentRows = await withLocalCalls(() => collectPageEndpoint(state, {
    pathname: "/replenishments",
    label: "replenishments.week",
    rowKeys: ["replenishments"],
    query: { "start-date": state.args.start, "end-date": state.args.end },
    allowEmptyObject: true,
  }));
  const deliveryDates = await withLocalCalls(() => retailerRequest(state, {
    label: "replenishments.deliveryDates",
    path: "/replenishments/delivery-dates",
  }));
  const shipmentInvoiceRequests = await withLocalCalls(() => collectPageEndpoint(state, {
    pathname: "/shipments/invoices/requests",
    label: "shipmentInvoiceRequests",
    rowKeys: ["shipmentInvoiceRequests", "invoiceRequests"],
    allowEmptyObject: true,
  }));
  const subscriptions = await withLocalCalls(() => retailerRequest(state, { label: "subscriptions", path: "/subscriptions" }));
  const subscriptionSignatureKeys = await withLocalCalls(() => retailerRequest(state, { label: "subscription.signatureKeys", path: "/subscriptions/signature-keys" }));
  const retailerCurrent = await withLocalCalls(() => retailerRequest(state, { label: "retailer.current", path: "/retailers/current" }));

  return {
    generatedAt: new Date().toISOString(),
    calls,
    productCategories,
    productListFilters,
    productRanks,
    salesForecast,
    promotions,
    replenishments: { status: "collected", count: replenishmentRows.length, rows: sanitize(replenishmentRows) },
    deliveryDates: { status: deliveryDates.status, summary: sanitize(deliveryDates.payload) },
    shipmentInvoiceRequests: { count: shipmentInvoiceRequests.length, rows: sanitize(shipmentInvoiceRequests) },
    subscriptions: { status: subscriptions.status, summary: sanitize(subscriptions.payload) },
    subscriptionSignatureKeys: { status: subscriptionSignatureKeys.status, summary: sanitize(subscriptionSignatureKeys.payload) },
    retailerCurrent: { status: retailerCurrent.status, summary: sanitize(retailerCurrent.payload) },
  };
}

async function collectSettlement(state: CallState) {
  const invoices = await collectSingleListEndpoint(state, {
    pathname: "/invoices",
    label: "invoices.week",
    rowKeys: ["invoiceListItems", "invoices"],
    query: { "period-start-date": state.args.start, "period-end-date": state.args.end },
  });
  const invoiceDetails: JsonRecord[] = [];
  const invoiceSpecifications: JsonRecord[] = [];
  for (const invoice of invoices) {
    const invoiceId = String(invoice.invoiceId || "");
    if (!invoiceId) continue;
    const detail = await retailerRequest(state, {
      label: `invoice.detail.${redactIdentifier(invoiceId)}`,
      path: `/invoices/${encodeURIComponent(invoiceId)}`,
    });
    invoiceDetails.push({ invoiceId, status: detail.status, body: sanitize(detail.payload) });

    const type = String(invoice.invoiceType || "");
    if (type === "ALL_IN_ONE") {
      const lines = await collectPageEndpoint(state, {
        pathname: `/invoices/${encodeURIComponent(invoiceId)}/specification`,
        label: `invoice.spec.${redactIdentifier(invoiceId)}`,
        rowKeys: ["invoiceSpecification", "invoiceLines", "InvoiceLine"],
        pageDelayMs: 7000,
      });
      invoiceSpecifications.push({
        invoiceId,
        invoiceType: type,
        invoicePeriod: sanitize(invoice.invoicePeriod || {}),
        rows: lines.length,
        lines: sanitize(lines),
      });
    }
    await sleep(160);
  }
  return { invoices: sanitize(invoices), invoiceDetails, invoiceSpecifications };
}

async function collectSnapshot(input: { start: string; end: string; rankMode: "primary" | "none" }) {
  const state: CallState = {
    args: { start: input.start, end: input.end, rankMode: input.rankMode, maxPages: MAX_PAGES },
    token: await getToken(),
    apiCalls: [],
    paginationWarnings: [],
  };

  const shipments = await collectPageEndpoint(state, {
    pathname: "/shipments",
    label: "shipments",
    rowKeys: ["shipments"],
    stopWhenOlderThanStart: "shipmentDateTime",
  });
  const weekShipments = shipments.filter(row => inRange(row.shipmentDateTime, input.start, input.end));
  const shipmentDetails: JsonRecord[] = [];
  const orderDetailsById = new Map<string, JsonRecord>();
  for (const shipment of weekShipments) {
    if (!shipment.shipmentId) continue;
    const shipmentId = String(shipment.shipmentId);
    const shipmentDetail = await retailerRequest(state, {
      label: `shipment.detail.${redactIdentifier(shipmentId)}`,
      path: `/shipments/${encodeURIComponent(shipmentId)}`,
    });
    shipmentDetails.push({ shipmentId, status: shipmentDetail.status, detail: sanitize(shipmentDetail.payload) });
    const payload = shipmentDetail.payload as JsonRecord;
    const order = payload.order as JsonRecord | undefined;
    const orderId = String(order?.orderId || (shipment.order as JsonRecord | undefined)?.orderId || "");
    if (orderId && !orderDetailsById.has(orderId)) {
      const orderDetail = await retailerRequest(state, {
        label: `order.detail.${redactIdentifier(orderId)}`,
        path: `/orders/${encodeURIComponent(orderId)}`,
      });
      orderDetailsById.set(orderId, { orderId, status: orderDetail.status, detail: sanitize(orderDetail.payload) });
    }
    await sleep(90);
  }
  const orderDetails = [...orderDetailsById.values()];

  const returns = await collectPageEndpoint(state, { pathname: "/returns", label: "returns", rowKeys: ["returns"], allowEmptyObject: true });
  const weekReturns = returns.filter(row => inRange(row.registrationDateTime, input.start, input.end));
  const unhandledReturns = await collectPageEndpoint(state, {
    pathname: "/returns",
    label: "returns.unhandled",
    rowKeys: ["returns"],
    query: { handled: false },
    allowEmptyObject: true,
  });

  const inventory = await collectPageEndpoint(state, { pathname: "/inventory", label: "inventory", rowKeys: ["inventory"], allowEmptyObject: true });
  const offers = await collectOffers(state);
  const offerDetails: JsonRecord[] = [];
  for (const offer of offers) {
    if (!offer.offerId) continue;
    const detail = await retailerRequest(state, {
      label: `offer.detail.${redactIdentifier(offer.offerId)}`,
      path: `/offers/${encodeURIComponent(String(offer.offerId))}`,
      accept: ACCEPT_V11,
    });
    offerDetails.push({ offerId: String(offer.offerId), status: detail.status, detail: sanitize(detail.payload) });
    await sleep(80);
  }

  const configuredEans = Object.keys(KEYWORD_CONFIG.products);
  const offerEans = offers.map(offer => String(offer.ean || "")).filter(Boolean);
  const eans = [...new Set([...configuredEans, ...offerEans, ...Object.keys(summarizeShipmentsByEan(shipmentDetails))])].sort();
  const offerInsights = await collectOfferInsights(state, offers.filter(offer => eans.includes(String(offer.ean || ""))));

  const products = [];
  for (const ean of eans) {
    const product: JsonRecord = { ean };
    const endpoints = [
      ["ratings", `/products/${ean}/ratings`, {}],
      ["assets", `/products/${ean}/assets`, {}],
      ["productIds", `/products/${ean}/product-ids`, {}],
      ["placement", `/products/${ean}/placement`, { "country-code": "NL" }],
      ["priceStarBoundaries", `/products/${ean}/price-star-boundaries`, {}],
    ] as const;
    for (const [key, path, query] of endpoints) {
      const result = await retailerRequest(state, {
        label: `product.${key}.${ean}`,
        path,
        query,
        language: key === "placement" ? "nl" : undefined,
      });
      product[key] = result.ok ? sanitize(result.payload) : { status: result.status, body: sanitize(result.payload) };
      await sleep(80);
    }
    product.competingOffers = sanitize(await collectPageEndpoint(state, {
      pathname: `/products/${ean}/offers`,
      label: `product.competingOffers.${ean}`,
      rowKeys: ["offers"],
      query: { "country-code": "NL", condition: "NEW" },
    }));
    products.push(product);
  }

  const productsListForAterra = await collectBodyPageEndpoint(state, {
    label: "products.list.aterra",
    pathname: "/products/list",
    rowKeys: ["products"],
    body: { countryCode: "NL", searchTerm: "Aterra", filterRanges: [], filterValues: [], sort: "RELEVANCE" },
    language: "nl",
    allowEmptyObject: true,
    emptyResponseKeys: ["sort"],
  });

  const commissions = [];
  for (const offer of offers) {
    const ean = String(offer.ean || "");
    const pricing = offer.pricing as JsonRecord | undefined;
    const bundlePrices = Array.isArray(pricing?.bundlePrices) ? pricing.bundlePrices as JsonRecord[] : [];
    const unitPrice = Number(bundlePrices[0]?.unitPrice || 0);
    if (!ean || !unitPrice) continue;
    const result = await retailerRequest(state, {
      label: `commission.${ean}`,
      path: `/commission/${encodeURIComponent(ean)}`,
      query: { "unit-price": unitPrice, condition: "NEW" },
    });
    commissions.push({ ean, unitPrice, status: result.status, result: sanitize(result.payload) });
    await sleep(80);
  }

  const productRanks = await collectProductRanks(state, eans, [...KEYWORD_CONFIG.locales]);
  const settlement = await collectSettlement(state);
  const additionalReadOnlySurfaces = await collectAdditionalSurfaces(state, eans, offers);
  const byEan = summarizeShipmentsByEan(shipmentDetails);
  const week = weekParts(input.start);
  const expectedUnavailableCalls = state.apiCalls.filter(call => call.final !== false && isExpectedUnavailable(call));
  const finalFailedCalls = state.apiCalls.filter(call => call.final !== false
    && (call.ok === false || call.contractValid === false || Number(call.status || 200) >= 400)
    && !isExpectedUnavailable(call));
  const retryableFailedCalls = finalFailedCalls.filter(call => [429, 599].includes(Number(call.status)) || Number(call.status) >= 500);

  return {
    week: { label: week.label, start: input.start, end: input.end },
    generatedAt: new Date().toISOString(),
    basis: "Cloud read-only Bol Retailer API weekly collector. Writes one sanitized JSON snapshot to Supabase Storage plus one run-log row. No dashboard transform/load is performed.",
    summary: {
      shipments: weekShipments.length,
      uniqueOrdersFromShipments: new Set(orderDetails.map(row => row.orderId)).size,
      shipmentLines: shipmentDetails.reduce((sum, row) => {
        const detail = row.detail as JsonRecord | undefined;
        return sum + (Array.isArray(detail?.shipmentItems) ? detail.shipmentItems.length : 0);
      }, 0),
      units: Object.values(byEan).reduce((sum, row) => sum + Number((row as JsonRecord).units || 0), 0),
      grossOrderValue: Object.values(byEan).reduce((sum, row) => sum + Number((row as JsonRecord).grossOrderValue || 0), 0),
      orderLineCommission: Object.values(byEan).reduce((sum, row) => sum + Number((row as JsonRecord).commission || 0), 0),
      returns: weekReturns.length,
      unhandledReturns: unhandledReturns.length,
      currentOffers: offers.length,
      currentInventoryRows: inventory.length,
      invoices: Array.isArray(settlement.invoices) ? settlement.invoices.length : 0,
      invoiceSpecificationPagesFetched: Array.isArray(settlement.invoiceSpecifications) ? settlement.invoiceSpecifications.length : 0,
      productEansFromOffers: new Set(offerEans).size,
      apiCalls: state.apiCalls.length,
      apiErrors: finalFailedCalls.length,
      retryableApiErrors: retryableFailedCalls.length,
      expectedUnavailable: expectedUnavailableCalls.map(call => ({ label: call.label, path: call.path, status: call.status })),
    },
    completeness: {
      note: "Offer insights are collected as latest seven daily periods because Bol does not accept an explicit historical week date on that endpoint. Product ranks are collected for the requested week dates.",
      rankMode: input.rankMode,
      locales: KEYWORD_CONFIG.locales,
      maxPages: MAX_PAGES,
      paginationWarnings: state.paginationWarnings,
      offerInsightsAligned: offerInsights.some(row => row.metric === "PRODUCT_VISITS") && offerInsights.filter(row => row.metric === "PRODUCT_VISITS").every(row => row.targetPeriodAligned === true),
      sourceSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      retryableApiErrors: retryableFailedCalls.length,
      failedCalls: finalFailedCalls.map(call => ({
        label: call.label,
        path: call.path,
        status: call.status,
        errorClass: call.errorClass,
      })),
    },
    operational: {
      byEan,
      shipments: sanitize(weekShipments),
      shipmentDetails,
      ordersFromShipmentDetails: orderDetails,
      returns: sanitize(weekReturns),
      unhandledReturns: sanitize(unhandledReturns),
    },
    currentState: {
      inventory: sanitize(inventory),
      offers: sanitize(offers),
      offerDetails,
      products,
      productsListForAterra: sanitize(productsListForAterra),
      commissions,
    },
    weekMetrics: {
      offerInsights,
    },
    settlement,
    apiCalls: state.apiCalls,
    additionalReadOnlySurfaces: {
      ...additionalReadOnlySurfaces,
      weeklyProductRanks: productRanks,
    },
  };
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function validateWeeklyPeriod(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error("start and end must use YYYY-MM-DD.");
  }
  if (dateAdd(start, 6) !== end || isoWeekStart(start) !== start) {
    throw new Error("The extraction period must be one complete Monday-Sunday week.");
  }
}

function datasetStatuses(snapshot: JsonRecord) {
  const calls = Array.isArray(snapshot.apiCalls) ? snapshot.apiCalls as JsonRecord[] : [];
  const completeness = snapshot.completeness as JsonRecord | undefined;
  const paginationWarnings = Array.isArray(completeness?.paginationWarnings) ? completeness.paginationWarnings as string[] : [];
  const groups: Record<string, string[]> = {
    commercial: ["shipments", "shipment.detail", "order.detail", "returns"],
    catalog: ["inventory", "offers", "offer.detail", "product.", "products."],
    insights: ["insight.", "rank.", "productRanks.", "salesForecast."],
    financial: ["invoices.", "invoice."],
    operations: ["promotions.", "promotion.", "replenishments.", "shipmentInvoiceRequests"],
    account: ["subscriptions", "subscription.", "retailer.current"],
  };
  return Object.fromEntries(Object.entries(groups).map(([dataset, prefixes]) => {
    const relevant = calls.filter(call => prefixes.some(prefix => String(call.label || "").startsWith(prefix)) && call.final !== false);
    const unavailable = relevant.filter(call => isExpectedUnavailable(call));
    const failed = relevant.filter(call => (call.ok === false || call.contractValid === false || Number(call.status || 200) >= 400) && !isExpectedUnavailable(call));
    const incompletePagination = relevant.some(call => call.paginationComplete === false && call.final !== false)
      && paginationWarnings.some(warning => prefixes.some(prefix => warning.startsWith(prefix)));
    const incompleteInsights = dataset === "insights" && (completeness?.offerInsightsAligned !== true || completeness?.rankMode !== "primary");
    return [dataset, {
      status: relevant.length === 0 ? "not_collected" : failed.length || incompletePagination || incompleteInsights ? "partial" : "complete",
      calls: relevant.length,
      errors: failed.length,
      unavailable: unavailable.length,
      rows: relevant.reduce((sum, call) => sum + Number(call.rows || 0), 0),
    }];
  }));
}

function isExpectedUnavailable(call: JsonRecord) {
  if (Number(call.status) !== 404) return false;
  const label = String(call.label || "");
  return label.includes("priceStarBoundaries") || label.startsWith("salesForecast.");
}

async function uploadJsonArtifact(
  supabase: ReturnType<typeof createClient>,
  path: string,
  value: unknown,
) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const checksum = await sha256Hex(text);
  const upload = await supabase.storage.from(BUCKET).upload(path, new Blob([text], { type: "application/json" }), {
    contentType: "application/json",
    upsert: false,
  });
  if (upload.error) throw new Error(`storage_upload: ${upload.error.message}`);
  const bytes = new TextEncoder().encode(text).byteLength;
  const slash = path.lastIndexOf("/");
  const directory = path.slice(0, slash);
  const filename = path.slice(slash + 1);
  const { data: listed, error: listError } = await supabase.storage.from(BUCKET).list(directory, { search: filename, limit: 10 });
  if (listError) throw new Error(`storage_verify: ${listError.message}`);
  const stored = listed?.find(item => item.name === filename);
  const storedBytes = Number((stored?.metadata as JsonRecord | undefined)?.size || 0);
  if (!stored || storedBytes !== bytes) throw new Error(`storage_verify: byte-size mismatch for ${filename}.`);
  const { data: downloaded, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError || !downloaded || await sha256Hex(await downloaded.text()) !== checksum) {
    throw new Error(`storage_verify: checksum mismatch for ${filename}.`);
  }
  return { path, sha256: checksum, bytes };
}

Deno.serve(async request => {
  const startedAt = Date.now();
  if (request.method !== "POST") return jsonResponse({ status: "method_not_allowed" }, 405);
  const expectedCronToken = env("BOL_RETAILER_CRON_TOKEN");
  const authorizationToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const providedCronToken = request.headers.get("x-aterra-cron-token") || authorizationToken;
  if (!providedCronToken || providedCronToken !== expectedCronToken) {
    return jsonResponse({ status: "unauthorized" }, 401);
  }

  const supabase = createClient(env("SUPABASE_URL"), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: JsonRecord;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return jsonResponse({ status: "invalid_request", message: "A JSON object is required." }, 400);
  }
  if ((body.start === undefined) !== (body.end === undefined)) {
    return jsonResponse({ status: "invalid_request", message: "Supply both start and end, or neither." }, 400);
  }
  const trigger = String(body.trigger || "manual");
  if (!["manual", "cron", "retry", "cloud-test"].includes(trigger)) {
    return jsonResponse({ status: "invalid_request", message: "Unsupported trigger." }, 400);
  }
  const nowAmsterdam = dateInAmsterdam();
  const forced = body.force === true;
  const expectedLocalHour = Number(body.expectedLocalHour ?? 9);
  if (trigger === "cron" && !forced && !(nowAmsterdam.weekday === "Mon" && nowAmsterdam.hour === expectedLocalHour && nowAmsterdam.minute < 20)) {
    return jsonResponse({
      status: "skipped",
      reason: `Cron guard: not Monday ${String(expectedLocalHour).padStart(2, "0")}:00 Europe/Amsterdam.`,
      amsterdamTime: nowAmsterdam,
    });
  }

  const period = typeof body.start === "string" && typeof body.end === "string"
    ? { start: body.start, end: body.end }
    : previousCompletedWeek(nowAmsterdam.date);
  try {
    validateWeeklyPeriod(period.start, period.end);
  } catch (error) {
    return jsonResponse({ status: "invalid_request", message: error instanceof Error ? error.message : "Invalid period." }, 400);
  }
  const week = weekParts(period.start);
  const invocationId = request.headers.get("x-supabase-execution-id") || crypto.randomUUID();
  const rankMode = body.rankMode === "none" ? "none" : "primary";
  const scheduleKey = String(body.scheduleKey || `${trigger}:${week.label}`);
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();

  const { error: recoveryError } = await supabase.from(RUN_TABLE).update({
    status: "failed",
    error_stage: "orchestration",
    error_code: "STALE_RUN_RECOVERED",
    error_detail: `Run exceeded the ${STALE_RUN_MINUTES}-minute lease and was closed before retry.`,
    completed_at: new Date().toISOString(),
  }).eq("status", "running").eq("iso_year", week.isoYear).eq("iso_week", week.isoWeek).lt("started_at", staleBefore);
  if (recoveryError) return jsonResponse({ status: "error", stage: "recover_run" }, 503);

  if (body.rerun !== true) {
    const { data: existing, error: lookupError } = await supabase.from(RUN_TABLE)
      .select("id,status,storage_path,completed_at,completeness")
      .eq("iso_year", week.isoYear)
      .eq("iso_week", week.isoWeek)
      .eq("schedule_key", scheduleKey)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) return jsonResponse({ status: "error", stage: "lookup_run" }, 503);
    if (existing?.status === "complete" || existing?.status === "running") {
      return jsonResponse({ status: existing.status === "complete" ? "already_complete" : "already_running", run: existing }, existing.status === "complete" ? 200 : 202);
    }
    const priorCompleteness = existing?.completeness as JsonRecord | undefined;
    if (body.retryOnly === true && existing?.status === "partial" && Number(priorCompleteness?.retryableApiErrors || 0) === 0) {
      return jsonResponse({ status: "no_retry_needed", reason: "The prior partial run has no transient API failures.", run: existing }, 200);
    }
  }

  const { data: run, error: runError } = await supabase.from(RUN_TABLE).insert({
    run_kind: "weekly",
    trigger_source: trigger,
    status: "running",
    iso_year: week.isoYear,
    iso_week: week.isoWeek,
    period_start: period.start,
    period_end: period.end,
    timezone: TIMEZONE,
    storage_bucket: BUCKET,
    invocation_id: invocationId,
    schedule_key: scheduleKey,
    source_schema_version: SNAPSHOT_SCHEMA_VERSION,
    last_heartbeat_at: new Date().toISOString(),
  }).select("id").single();
  if (runError?.code === "23505") return jsonResponse({ status: "already_running" }, 202);
  if (runError) return jsonResponse({ status: "error", stage: "create_run" }, 503);

  try {
    const snapshot = await collectSnapshot({ start: period.start, end: period.end, rankMode });
    const summary = snapshot.summary as JsonRecord;
    const statuses = datasetStatuses(snapshot as JsonRecord);
    const finalErrors = Number(summary.apiErrors || 0);
    const retryableErrors = Number(summary.retryableApiErrors || 0);
    const completeness = snapshot.completeness as JsonRecord;
    const paginationWarnings = Array.isArray(completeness.paginationWarnings) ? completeness.paginationWarnings as string[] : [];
    const insightsAligned = completeness.offerInsightsAligned === true;
    const finalStatus = finalErrors === 0 && paginationWarnings.length === 0 && insightsAligned && rankMode === "primary" ? "complete" : "partial";
    const warnings = [
      String((snapshot.completeness as JsonRecord).note || ""),
      ...(finalErrors > 0 ? [`${finalErrors} final Retailer API calls returned non-2xx statuses.`] : []),
      ...paginationWarnings,
      ...(!insightsAligned ? ["Offer insight dates do not fully align with the requested reporting week."] : []),
      ...(rankMode === "none" ? ["Weekly product-rank collection was disabled for this run."] : []),
    ].filter(Boolean);

    const basePath = `retailer-api/year=${week.isoYear}/week=${String(week.isoWeek).padStart(2, "0")}/run=${run.id}`;
    const artifactPayloads: Record<string, unknown> = {
      commercial: { week: snapshot.week, generatedAt: snapshot.generatedAt, operational: snapshot.operational },
      catalog: { week: snapshot.week, generatedAt: snapshot.generatedAt, currentState: snapshot.currentState },
      insights: { week: snapshot.week, generatedAt: snapshot.generatedAt, weekMetrics: snapshot.weekMetrics, ranks: (snapshot.additionalReadOnlySurfaces as JsonRecord).weeklyProductRanks },
      financial: { week: snapshot.week, generatedAt: snapshot.generatedAt, settlement: snapshot.settlement },
      operations: { week: snapshot.week, generatedAt: snapshot.generatedAt, data: snapshot.additionalReadOnlySurfaces },
      provenance: { week: snapshot.week, generatedAt: snapshot.generatedAt, summary, completeness, datasetStatuses: statuses, calls: snapshot.apiCalls },
    };
    const artifacts = [];
    for (const [name, payload] of Object.entries(artifactPayloads)) {
      artifacts.push({ name, ...await uploadJsonArtifact(supabase, `${basePath}/${name}.json`, payload) });
    }
    const manifest = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      runId: run.id,
      status: finalStatus,
      week: snapshot.week,
      generatedAt: snapshot.generatedAt,
      datasetStatuses: statuses,
      summary,
      completeness,
      warnings,
      artifacts,
    };
    const manifestArtifact = await uploadJsonArtifact(supabase, `${basePath}/manifest.json`, manifest);

    const { data: completedRun, error: completionError } = await supabase.from(RUN_TABLE).update({
      status: finalStatus,
      storage_path: manifestArtifact.path,
      snapshot_sha256: manifestArtifact.sha256,
      artifact_count: artifacts.length + 1,
      api_call_count: Number(summary.apiCalls || 0),
      api_error_count: finalErrors,
      product_count: Number(summary.productEansFromOffers || 0),
      warning_count: warnings.length,
      warnings,
      summary,
      completeness,
      dataset_status: statuses,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      last_heartbeat_at: new Date().toISOString(),
    })
      .eq("id", run.id)
      .eq("status", "running")
      .eq("invocation_id", invocationId)
      .select("id")
      .maybeSingle();
    if (completionError) throw new Error(`run_log_update: ${completionError.message}`);
    if (!completedRun) throw new Error("RUN_LEASE_LOST: terminal update was rejected because this invocation no longer owns the run.");

    return jsonResponse({
      status: finalStatus,
      runId: run.id,
      week: snapshot.week,
      storageBucket: BUCKET,
      storagePath: manifestArtifact.path,
      artifacts: artifacts.length + 1,
      apiCalls: summary.apiCalls,
      apiErrors: finalErrors,
      retryableApiErrors: retryableErrors,
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Bol Retailer extract error.";
    await supabase.from(RUN_TABLE).update({
      status: "failed",
      error_stage: "extract",
      error_code: "BOL_RETAILER_WEEKLY_EXTRACT_FAILED",
      error_detail: message,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      last_heartbeat_at: new Date().toISOString(),
    })
      .eq("id", run.id)
      .eq("status", "running")
      .eq("invocation_id", invocationId);
    return jsonResponse({ status: "failed", runId: run.id, message }, 500);
  }
});
