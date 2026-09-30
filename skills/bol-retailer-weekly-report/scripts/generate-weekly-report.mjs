#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_KEYWORDS_PATH = path.join(SKILL_DIR, "references", "product-keywords.json");
const SECRET_PATTERNS = [
  /BOL_RETAILER_CLIENT_ID/i,
  /BOL_RETAILER_CLIENT_SECRET/i,
  /access_token/i,
  /client_secret/i,
  /authorization/i,
  /bearer\s+[a-z0-9._-]{20,}/i,
  /basic\s+[a-z0-9+/=_-]{20,}/i,
];

function parseArgs(argv) {
  const args = {
    outDir: null,
    snapshot: null,
    ranks: null,
    keywords: DEFAULT_KEYWORDS_PATH,
    reportSlug: null,
    allowPartialRank: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--snapshot") args.snapshot = argv[++i];
    else if (value === "--ranks") args.ranks = argv[++i];
    else if (value === "--keywords") args.keywords = argv[++i];
    else if (value === "--out-dir") args.outDir = argv[++i];
    else if (value === "--report-slug") args.reportSlug = argv[++i];
    else if (value === "--allow-partial-rank") args.allowPartialRank = true;
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--help" || value === "-h") {
      console.log(`Usage:
  node generate-weekly-report.mjs --snapshot <weekly-snapshot.json> --out-dir <docs-dir> [options]

Options:
  --ranks <rank-json>          Optional keyword-rank JSON. If omitted, ranks are read from the snapshot when present.
  --keywords <json>            Product keyword/watchlist config. Defaults to the skill reference config.
  --report-slug <slug>         Output slug. Defaults to bol-retailer-<week-label>-weekly-report.
  --allow-partial-rank         Do not fail when rank coverage is fewer than 7 dates; still marks the caveat visibly.
  --dry-run                    Validate and render in memory without writing output files.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!args.snapshot) throw new Error("Missing --snapshot <weekly-snapshot.json>.");
  if (!args.outDir) throw new Error("Missing --out-dir <docs-dir>.");
  return args;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function money(value) {
  return value === null || value === undefined ? "N/A" : `EUR ${Number(value).toFixed(2)}`;
}

function number(value) {
  return value === null || value === undefined ? "N/A" : String(value);
}

function count(value) {
  return value === null || value === undefined ? "N/A" : String(value);
}

function percent(value) {
  return value === null || value === undefined ? "N/A" : `${Number(value).toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/_+/g, "-")
    .toLowerCase();
}

function normalizeKeyword(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("nl-NL");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function fileSha256(filePath) {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

async function acquireLock(outDir, slug) {
  const lockPath = path.join(outDir, `.${slug}.lock`);
  const handle = await fs.open(lockPath, "wx").catch(error => {
    if (error.code === "EEXIST") {
      throw new Error(`Another report render appears to be running for ${slug}. Lock file: ${lockPath}`);
    }
    throw error;
  });
  await handle.writeFile(JSON.stringify({
    pid: process.pid,
    createdAt: new Date().toISOString(),
    slug,
  }, null, 2));
  await handle.close();
  return lockPath;
}

async function releaseLock(lockPath) {
  if (!lockPath) return;
  await fs.unlink(lockPath).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
}

function offers(snapshot) {
  return Array.isArray(snapshot.currentState?.offers) ? snapshot.currentState.offers : [];
}

function offerByEan(snapshot) {
  return new Map(offers(snapshot).filter(offer => offer.ean).map(offer => [offer.ean, offer]));
}

function offerNameForEan(ean, snapshot, keywords) {
  const offer = offerByEan(snapshot).get(ean);
  return keywords.products?.[ean]?.shortName || offer?.unknownProductTitle || offer?.store?.productTitle || ean;
}

function eansFromKeywords(keywords) {
  return Object.keys(keywords.products || {});
}

function eansFromRanks(rankPayload) {
  return [...new Set([
    ...(rankPayload.observations || []).map(row => row.ean),
    ...(rankPayload.calls || []).map(row => row.ean),
  ].filter(Boolean))];
}

function productUniverse(snapshot, keywords, rankPayload) {
  return [...new Set([
    ...offers(snapshot).map(offer => offer.ean),
    ...Object.keys(snapshot.operational?.byEan || {}),
    ...(snapshot.weekMetrics?.offerInsights || []).map(row => row.ean),
    ...(snapshot.operational?.returns || []).flatMap(returnRecord => (returnRecord.returnItems || []).map(item => item.ean)),
    ...eansFromRanks(rankPayload),
    ...eansFromKeywords(keywords),
  ].filter(Boolean))].sort();
}

function productVisits(snapshot) {
  const result = {};
  const coverage = {};
  for (const item of snapshot.weekMetrics?.offerInsights || []) {
    if (item.metric !== "PRODUCT_VISITS" || !item.ean) continue;
    result[item.ean] = (result[item.ean] || 0) + Number(item.weekTotal || item.total || 0);
    coverage[item.ean] = "observed";
  }
  return { values: result, coverage };
}

function returnAdjustments(snapshot) {
  const orderDetails = new Map((snapshot.operational?.ordersFromShipmentDetails || []).map(row => [row.orderId, row.detail]));
  const result = {};
  const unmatched = [];
  const ambiguous = [];
  for (const returnRecord of snapshot.operational?.returns || []) {
    for (const item of returnRecord.returnItems || []) {
      const order = orderDetails.get(item.orderId);
      const sameEanItems = (order?.orderItems || []).filter(candidate => candidate.product?.ean === item.ean);
      const orderItem = item.orderItemId
        ? (order?.orderItems || []).find(candidate => candidate.orderItemId === item.orderItemId)
        : sameEanItems.length === 1
          ? sameEanItems[0]
          : null;
      const quantity = Number(item.expectedQuantity || item.quantity || 0);
      const adjustment = result[item.ean] || {
        returnUnits: 0,
        linkedReturnUnits: 0,
        unlinkedReturnUnits: 0,
        ambiguousReturnUnits: 0,
        returnValue: 0,
        returnCommission: 0,
        unresolved: 0,
        reasons: new Set(),
      };
      adjustment.returnUnits += quantity;
      if (orderItem) {
        const unitPrice = Number(orderItem.unitPrice || 0);
        const shippedQuantity = Number(orderItem.quantityShipped || orderItem.quantity || 1);
        const commission = Number(orderItem.commission || 0);
        adjustment.linkedReturnUnits += quantity;
        adjustment.returnValue += quantity * unitPrice;
        adjustment.returnCommission += shippedQuantity > 0 ? commission * quantity / shippedQuantity : 0;
      } else if (sameEanItems.length > 1) {
        adjustment.ambiguousReturnUnits += quantity;
        ambiguous.push({ ean: item.ean, orderId: item.orderId, quantity, reason: "multiple matching order items" });
      } else {
        adjustment.unlinkedReturnUnits += quantity;
        unmatched.push({ ean: item.ean, orderId: item.orderId, quantity, reason: order ? "no matching order item" : "order detail unavailable" });
      }
      if (!item.handled) adjustment.unresolved += quantity;
      if (item.returnReason?.mainReason) adjustment.reasons.add(item.returnReason.mainReason);
      result[item.ean] = adjustment;
    }
  }
  const byEan = Object.fromEntries(Object.entries(result).map(([ean, value]) => [ean, {
    ...value,
    returnValue: round(value.returnValue),
    returnCommission: round(value.returnCommission),
    reasons: [...value.reasons].sort(),
  }]));
  return { byEan, unmatched, ambiguous };
}

function rankObservationsFromSnapshot(snapshot) {
  const observations = [];
  const calls = [];
  for (const result of snapshot.additionalReadOnlySurfaces?.productRanks || []) {
    if (result.type && result.type !== "SEARCH") continue;
    const ranks = Array.isArray(result.sample?.ranks) ? result.sample.ranks : [];
    calls.push({
      ean: result.ean,
      date: result.date || snapshot.week?.end,
      locale: result.locale || "nl-NL",
      page: result.page || 1,
      status: result.status,
      rows: ranks.length,
    });
    for (const rank of ranks) {
      if (!rank.searchTerm) continue;
      observations.push({
        date: result.date || snapshot.week?.end,
        ean: result.ean,
        locale: result.locale || "nl-NL",
        searchTermRaw: String(rank.searchTerm),
        searchTermNormalized: normalizeKeyword(rank.searchTerm),
        placement: rank.wasSponsored === true ? "SPONSORED" : "ORGANIC",
        rank: Number(rank.rank),
        impressions: Number(rank.impressions || 0),
      });
    }
  }
  return { observations, calls };
}

function normalizeRankPayload(payload) {
  if (Array.isArray(payload.dailyRankObservations)) {
    return {
      observations: payload.dailyRankObservations.map(row => ({
        date: row.date,
        ean: row.ean,
        locale: row.locale || "nl-NL",
        searchTermRaw: row.searchTermRaw || row.searchTerm || "",
        searchTermNormalized: row.searchTermNormalized || normalizeKeyword(row.searchTermRaw || row.searchTerm),
        placement: row.placement || (row.wasSponsored ? "SPONSORED" : "ORGANIC"),
        rank: Number(row.rank),
        impressions: Number(row.impressions || 0),
      })),
      calls: payload.calls || [],
    };
  }
  if (Array.isArray(payload.observations)) return { observations: payload.observations, calls: payload.calls || [] };
  return { observations: [], calls: [] };
}

function aggregateRanks(observations) {
  const groups = new Map();
  for (const row of observations) {
    if (!row.ean || !row.searchTermNormalized || !Number.isFinite(row.rank)) continue;
    const key = [row.ean, row.locale || "nl-NL", row.searchTermNormalized, row.placement].join("|");
    const current = groups.get(key) || {
      ean: row.ean,
      locale: row.locale || "nl-NL",
      searchTerm: row.searchTermNormalized,
      rawVariants: new Set(),
      placement: row.placement,
      observations: 0,
      dates: new Set(),
      impressions: 0,
      weightedRankTotal: 0,
      rankTotal: 0,
      bestRank: Number.POSITIVE_INFINITY,
      worstRank: Number.NEGATIVE_INFINITY,
    };
    current.rawVariants.add(row.searchTermRaw || row.searchTermNormalized);
    current.observations += 1;
    if (row.date) current.dates.add(row.date);
    current.impressions += Number(row.impressions || 0);
    current.weightedRankTotal += row.rank * Number(row.impressions || 0);
    current.rankTotal += row.rank;
    current.bestRank = Math.min(current.bestRank, row.rank);
    current.worstRank = Math.max(current.worstRank, row.rank);
    groups.set(key, current);
  }
  return [...groups.values()].map(group => ({
    ean: group.ean,
    locale: group.locale,
    searchTerm: group.searchTerm,
    rawVariants: [...group.rawVariants].sort(),
    placement: group.placement,
    observations: group.observations,
    daysObserved: group.dates.size,
    impressions: group.impressions,
    weeklyRank: round(group.impressions > 0 ? group.weightedRankTotal / group.impressions : group.rankTotal / group.observations, 1),
    bestRank: group.bestRank,
    worstRank: group.worstRank,
  })).sort((a, b) =>
    a.ean.localeCompare(b.ean)
      || a.locale.localeCompare(b.locale)
      || a.searchTerm.localeCompare(b.searchTerm)
      || a.placement.localeCompare(b.placement),
  );
}

function findRank(aggregates, ean, keyword, placement, locale = "nl-NL") {
  const normalized = normalizeKeyword(keyword);
  return aggregates.find(row => row.ean === ean && row.locale === locale && row.searchTerm === normalized && row.placement === placement) || null;
}

function rankDisplay(rank) {
  if (!rank) return "Not observed";
  return `${rank.weeklyRank} (${rank.bestRank}-${rank.worstRank}; ${rank.impressions} impr.)`;
}

function expectedWeekDates(snapshot) {
  if (!snapshot.week?.start || !snapshot.week?.end) return [];
  const dates = [];
  const current = new Date(`${snapshot.week.start}T00:00:00.000Z`);
  const end = new Date(`${snapshot.week.end}T00:00:00.000Z`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(end.getTime()) || current > end) return [];
  while (current <= end && dates.length < 31) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function expectedKeywordRows(keywords, ean) {
  const config = keywords.products?.[ean] || {};
  return [...new Set([
    config.primaryKeyword,
    ...(config.secondaryKeywords || []),
    ...(config.strategicKeywords || []),
  ].filter(Boolean).map(normalizeKeyword))];
}

function rankCoverageMatrix({ snapshot, keywords, rankPayload }) {
  const dates = expectedWeekDates(snapshot);
  const locales = Array.isArray(keywords.locales) && keywords.locales.length ? keywords.locales : ["nl-NL"];
  const eans = productUniverse(snapshot, keywords, rankPayload);
  const calls = rankPayload.calls || [];
  const observations = rankPayload.observations || [];
  const successfulCallKeys = new Set(calls
    .filter(call => Number(call.status || 200) === 200)
    .map(call => [call.ean, call.date || snapshot.week?.end, call.locale || "nl-NL"].join("|")));
  const observationKeys = new Set(observations
    .filter(row => row.ean && row.date)
    .map(row => [row.ean, row.date, row.locale || "nl-NL"].join("|")));
  const expectedRows = [];
  for (const ean of eans) {
    for (const locale of locales) {
      for (const date of dates) {
        const key = [ean, date, locale].join("|");
        expectedRows.push({
          ean,
          date,
          locale,
          callSucceeded: successfulCallKeys.has(key),
          observed: observationKeys.has(key),
          keywordsConfigured: expectedKeywordRows(keywords, ean),
        });
      }
    }
  }
  const successfulDates = [...new Set(calls
    .filter(call => Number(call.status || 200) === 200 && call.date)
    .map(call => call.date))].sort();
  const observedDates = [...new Set(observations.map(row => row.date).filter(Boolean))].sort();
  const expectedCount = expectedRows.length;
  const successfulCount = expectedRows.filter(row => row.callSucceeded).length;
  return {
    expectedDates: dates,
    successfulDates,
    observedDates,
    expectedCount,
    successfulCount,
    missingCalls: expectedRows.filter(row => !row.callSucceeded),
    successfulEmptyCalls: expectedRows.filter(row => row.callSucceeded && !row.observed),
  };
}

function sourceConsistency(snapshot, calls) {
  const warnings = [];
  if (snapshot.summary?.apiCalls !== undefined && Array.isArray(snapshot.apiCalls) && snapshot.summary.apiCalls !== snapshot.apiCalls.length) {
    warnings.push(`Snapshot summary.apiCalls (${snapshot.summary.apiCalls}) does not match apiCalls array length (${snapshot.apiCalls.length}).`);
  }
  if (snapshot.summary?.apiErrors !== undefined && Array.isArray(snapshot.apiCalls)) {
    const observedErrors = snapshot.apiCalls.filter(call => Number(call.status || 200) >= 400).length;
    if (observedErrors !== snapshot.summary.apiErrors) warnings.push(`Snapshot summary.apiErrors (${snapshot.summary.apiErrors}) does not match observed apiCalls errors (${observedErrors}).`);
  }
  const incompletePages = calls.filter(call => call.hasNextPage === true || call.paginationComplete === false);
  if (incompletePages.length > 0) warnings.push(`${incompletePages.length} rank calls indicate pagination may be incomplete.`);
  return warnings;
}

function buildScorecard(snapshot, keywords, aggregates, rankPayload) {
  const visits = productVisits(snapshot);
  const returns = returnAdjustments(snapshot);
  return productUniverse(snapshot, keywords, rankPayload).map(ean => {
    const trading = snapshot.operational?.byEan?.[ean] || {
      orders: 0,
      shipments: 0,
      lines: 0,
      units: 0,
      grossOrderValue: 0,
      commission: 0,
    };
    const adjustment = returns.byEan[ean] || {
      returnUnits: 0,
      linkedReturnUnits: 0,
      unlinkedReturnUnits: 0,
      ambiguousReturnUnits: 0,
      returnValue: 0,
      returnCommission: 0,
      unresolved: 0,
      reasons: [],
    };
    const primaryKeyword = keywords.products?.[ean]?.primaryKeyword || "";
    const netShippedGms = Number(trading.grossOrderValue || 0) - Number(adjustment.returnValue || 0);
    const retainedCommission = Number(trading.commission || 0) - Number(adjustment.returnCommission || 0);
    const unitsSold = Number(trading.units || 0);
    const visitCount = visits.values[ean] ?? null;
    return {
      ean,
      product: offerNameForEan(ean, snapshot, keywords),
      primaryKeyword,
      netShippedGms: round(netShippedGms),
      unitsSold,
      asp: unitsSold > 0 ? round(Number(trading.grossOrderValue || 0) / unitsSold) : null,
      conversionRate: visitCount && visitCount > 0 ? round((unitsSold / visitCount) * 100, 2) : null,
      conversionStatus: visitCount === null ? "Unavailable because PRODUCT_VISITS was not observed." : "Trading conversion: shipped units divided by Product visits.",
      productVisits: visitCount,
      productVisitsStatus: visits.coverage[ean] ? "verified" : "not_observed",
      revenueAfterCommission: round(netShippedGms - retainedCommission),
      returns: adjustment.returnUnits,
      linkedReturns: adjustment.linkedReturnUnits,
      unlinkedReturns: adjustment.unlinkedReturnUnits,
      ambiguousReturns: adjustment.ambiguousReturnUnits,
      unresolvedReturns: adjustment.unresolved,
      returnReasons: adjustment.reasons,
      sponsoredRank: primaryKeyword ? findRank(aggregates, ean, primaryKeyword, "SPONSORED") : null,
      organicRank: primaryKeyword ? findRank(aggregates, ean, primaryKeyword, "ORGANIC") : null,
    };
  });
}

function qualityGates({ snapshot, keywords, scorecard, observations, calls, rankCoverage, returnMatching, allowPartialRank }) {
  const hardFailures = [];
  const warnings = [];
  if (!snapshot.week?.start || !snapshot.week?.end) hardFailures.push("Snapshot has no week.start/week.end.");
  if (snapshot.week?.start && snapshot.week?.end && snapshot.week.start > snapshot.week.end) hardFailures.push("Snapshot week.start is after week.end.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.week?.start || "")) hardFailures.push("Snapshot week.start must use YYYY-MM-DD.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.week?.end || "")) hardFailures.push("Snapshot week.end must use YYYY-MM-DD.");
  const universe = productUniverse(snapshot, keywords, { observations, calls });
  if (universe.length === 0) hardFailures.push("Snapshot has no product universe: no offers, trading EANs, rank EANs, visits, returns, or configured keyword products.");
  if (!snapshot.operational?.byEan) hardFailures.push("Snapshot has no operational.byEan trading totals.");
  if (!snapshot.summary && !snapshot.operational) warnings.push("Snapshot has no summary object; final run summary may be less useful.");
  const totalUnits = scorecard.reduce((sum, row) => sum + row.unitsSold, 0);
  if (totalUnits === 0 && !snapshot.completeness?.note) warnings.push("No shipped units found; confirm this was truly a zero-sales week.");
  if (scorecard.some(row => row.unresolvedReturns > 0)) warnings.push("Unresolved returns are present; net GMS and after-commission revenue are provisional.");
  if (scorecard.some(row => row.productVisitsStatus === "not_observed" && row.unitsSold > 0)) warnings.push("At least one selling product has no PRODUCT_VISITS row; offer insight coverage may be incomplete.");
  if (returnMatching.unmatched.length > 0) warnings.push(`${returnMatching.unmatched.length} return items could not be linked to an order line; return value adjustments exclude those units.`);
  if (returnMatching.ambiguous.length > 0) warnings.push(`${returnMatching.ambiguous.length} return items matched multiple possible order lines; return value adjustments exclude those units.`);
  for (const warning of sourceConsistency(snapshot, calls)) warnings.push(warning);
  const rankDates = rankCoverage.successfulDates;
  if (rankCoverage.expectedDates.length && rankDates.length < rankCoverage.expectedDates.length) {
    const message = `Rank API coverage includes ${rankDates.length}/${rankCoverage.expectedDates.length} report dates with successful calls.`;
    if (allowPartialRank) warnings.push(message);
    else hardFailures.push(`${message} Re-run with --allow-partial-rank only for a clearly labelled partial report.`);
  }
  if (rankCoverage.expectedCount > 0 && rankCoverage.successfulCount < rankCoverage.expectedCount) {
    warnings.push(`Rank coverage matrix has ${rankCoverage.successfulCount}/${rankCoverage.expectedCount} successful EAN-date-locale calls.`);
  }
  const failedRankCalls = calls.filter(call => call.status && call.status !== 200);
  if (failedRankCalls.length > 0) warnings.push(`${failedRankCalls.length} rank API calls were non-successful.`);
  warnings.push("Conversion is shown as trading conversion: shipped units divided by Product visits. It is not a perfectly cohort-matched order-placement conversion.");
  return { hardFailures, warnings, rankDates, failedRankCalls };
}

function buildMarkdown({ snapshot, scorecard, aggregates, quality, calls, rankCoverage }) {
  const lines = [
    `# Bol Weekly Trading Report - ${snapshot.week.label || `${snapshot.week.start} to ${snapshot.week.end}`}`,
    "",
    `Period: ${snapshot.week.start} to ${snapshot.week.end}`,
    "",
    "> Retailer API report artifact. No dashboard, database, scheduled job or production workflow was changed by this renderer.",
    "",
    "## Product scorecard",
    "",
    "| Product | EAN | Net shipped GMS | Units sold | ASP | Conversion | Product visits | Revenue after commission | Returns | Primary keyword | Sponsored rank | Organic rank |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|",
  ];
  for (const row of scorecard) {
    const returnNotes = [
      `${row.returns}`,
      row.unresolvedReturns ? `${row.unresolvedReturns} unresolved` : null,
      row.unlinkedReturns ? `${row.unlinkedReturns} unlinked` : null,
      row.ambiguousReturns ? `${row.ambiguousReturns} ambiguous` : null,
    ].filter(Boolean).join("; ");
    lines.push(`| ${markdownCell(row.product)} | ${row.ean} | ${money(row.netShippedGms)} | ${row.unitsSold} | ${money(row.asp)} | ${percent(row.conversionRate)} | ${count(row.productVisits)} | ${money(row.revenueAfterCommission)} | ${returnNotes} | ${markdownCell(row.primaryKeyword)} | ${rankDisplay(row.sponsoredRank)} | ${rankDisplay(row.organicRank)} |`);
  }
  lines.push(
    "",
    "## Keyword rank matrix",
    "",
    `Successful rank dates represented: ${quality.rankDates.length ? quality.rankDates.join(", ") : "none"}. Observed rank dates: ${rankCoverage.observedDates.length ? rankCoverage.observedDates.join(", ") : "none"}. Successful empty calls mean Bol returned no observation; they do not mean rank zero.`,
    "",
    "| Product EAN | Locale | Keyword | Placement | Weekly rank | Best | Worst | Impressions | Days observed | Raw variants |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---|",
  );
  for (const row of aggregates) {
    lines.push(`| ${row.ean} | ${row.locale} | ${markdownCell(row.searchTerm)} | ${row.placement} | ${row.weeklyRank} | ${row.bestRank} | ${row.worstRank} | ${row.impressions} | ${row.daysObserved}/7 | ${markdownCell(row.rawVariants.join(", "))} |`);
  }
  lines.push(
    "",
    "## Data quality",
    "",
    ...quality.warnings.map(warning => `- Warning: ${warning}`),
    `- Rank requests represented: ${calls.length}; non-successful requests: ${quality.failedRankCalls.length}; successful EAN-date-locale coverage: ${rankCoverage.successfulCount}/${rankCoverage.expectedCount}.`,
    "- Product visits are Bol `PRODUCT_VISITS`; rank impressions are separate list-page visibility observations.",
    "- Revenue after commission is a commercial indicator, not accounting profit or settled revenue.",
    "",
  );
  return lines.join("\n");
}

function mixRows(scorecard) {
  const positiveRows = scorecard.filter(row => row.netShippedGms > 0);
  const total = positiveRows.reduce((sum, row) => sum + row.netShippedGms, 0);
  return positiveRows
    .sort((a, b) => b.netShippedGms - a.netShippedGms)
    .map((row, index) => ({
      ...row,
      share: total > 0 ? round((row.netShippedGms / total) * 100, 1) : 0,
      tone: index === 0 ? "" : index === 1 ? " blue" : " amber",
    }));
}

function buildHtml({ snapshot, scorecard, aggregates, quality, rankCoverage }) {
  const totalNet = round(scorecard.reduce((sum, row) => sum + (row.netShippedGms || 0), 0));
  const totalUnits = scorecard.reduce((sum, row) => sum + row.unitsSold, 0);
  const grossForAsp = Object.values(snapshot.operational?.byEan || {}).reduce((sum, row) => sum + Number(row.grossOrderValue || 0), 0);
  const totalVisits = scorecard.reduce((sum, row) => sum + Number(row.productVisits || 0), 0);
  const totalConversion = totalVisits > 0 ? round((totalUnits / totalVisits) * 100, 2) : null;
  const missingVisitProducts = scorecard.filter(row => row.productVisitsStatus === "not_observed").length;
  const totalAfterCommission = round(scorecard.reduce((sum, row) => sum + (row.revenueAfterCommission || 0), 0));
  const unresolvedReturns = scorecard.reduce((sum, row) => sum + row.unresolvedReturns, 0);
  const period = `${snapshot.week.start} - ${snapshot.week.end}`;
  const rankNotice = quality.rankDates.length >= 7
    ? "Rank coverage includes all seven report dates."
    : `Rank coverage is partial: ${quality.rankDates.length}/7 report dates.`;
  const attention = [
    unresolvedReturns > 0 ? ["red", "Resolve open returns", "Net GMS and after-commission revenue remain provisional until Bol completes unresolved returns."] : null,
    quality.rankDates.length < 7 ? ["amber", "Complete rank coverage", "Keyword ranks should be collected daily for a true weekly rank view."] : null,
    missingVisitProducts > 0 ? ["amber", "Confirm visit coverage", `${missingVisitProducts} products have no PRODUCT_VISITS row in the supplied snapshot.`] : null,
    totalNet > 0 ? ["", "Protect revenue leaders", `${mixRows(scorecard).slice(0, 2).map(row => row.product).join(" and ")} drive most weekly net shipped GMS.`] : null,
    ["", "Read conversion as trading conversion", "Conversion is shipped units divided by Product visits; it is useful commercially, but not a pure order-placement cohort."],
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aterra Bol Weekly Report - ${escapeHtml(snapshot.week.label || period)}</title>
  <style>
    :root { --ink:#18201f; --muted:#66716e; --line:#dce2df; --paper:#fff; --canvas:#f3f5f3; --teal:#176b5b; --teal-soft:#dcece7; --amber:#a45e08; --amber-soft:#fff0d8; --red:#a33a3a; --red-soft:#f8e3e1; --blue:#315f85; --blue-soft:#e2ebf2; --shadow:0 12px 30px rgba(25,35,32,.07); --radius:8px; }
    * { box-sizing:border-box; } body { margin:0; color:var(--ink); background:var(--canvas); font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:14px; line-height:1.45; letter-spacing:0; }
    .shell { width:min(1480px, calc(100% - 40px)); margin:0 auto; }
    .topbar { position:sticky; top:0; z-index:10; border-bottom:1px solid var(--line); background:rgba(255,255,255,.96); backdrop-filter:blur(12px); }
    .topbar-inner { min-height:60px; display:flex; align-items:center; justify-content:space-between; gap:20px; }
    .brand { display:flex; align-items:center; gap:10px; font-weight:750; font-size:16px; }
    .brand-mark { width:28px; height:28px; display:grid; place-items:center; color:white; background:var(--teal); border-radius:6px; font-size:13px; font-weight:800; }
    .top-meta { display:flex; align-items:center; gap:16px; color:var(--muted); font-size:12px; }
    .status-dot { display:inline-block; width:7px; height:7px; margin-right:6px; border-radius:50%; background:var(--amber); }
    main { padding:34px 0 64px; } .report-head { display:flex; justify-content:space-between; align-items:flex-end; gap:24px; margin-bottom:24px; }
    .eyebrow { margin:0 0 5px; color:var(--teal); font-size:12px; font-weight:800; text-transform:uppercase; }
    h1,h2,h3,p { margin-top:0; } h1 { margin-bottom:7px; font-size:clamp(28px,4vw,43px); line-height:1.08; font-weight:760; }
    .subtitle { margin:0; color:var(--muted); font-size:15px; } .period { min-width:230px; padding:12px 14px; border:1px solid var(--line); background:var(--paper); border-radius:var(--radius); text-align:right; }
    .period strong { display:block; font-size:15px; } .period span { color:var(--muted); font-size:12px; }
    .notice { display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:start; margin-bottom:22px; padding:13px 15px; border:1px solid #edcf9f; border-left:4px solid var(--amber); border-radius:var(--radius); background:var(--amber-soft); color:#684216; }
    .notice-symbol { width:21px; height:21px; display:grid; place-items:center; border:1px solid currentColor; border-radius:50%; font-weight:800; font-size:12px; }
    .notice strong { display:block; margin-bottom:2px; color:#4d310f; }
    .kpi-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:26px; }
    .kpi { min-height:116px; padding:16px; border:1px solid var(--line); border-radius:var(--radius); background:var(--paper); box-shadow:0 4px 12px rgba(25,35,32,.035); }
    .kpi-label { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--muted); font-size:12px; font-weight:700; }
    .kpi-value { margin-top:13px; font-size:27px; line-height:1; font-weight:760; font-variant-numeric:tabular-nums; }
    .kpi-note { margin-top:9px; color:var(--muted); font-size:11px; }
    .tag { display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:800; text-transform:uppercase; }
    .tag.verified { color:var(--teal); background:var(--teal-soft); } .tag.provisional { color:var(--amber); background:var(--amber-soft); } .tag.unavailable { color:var(--red); background:var(--red-soft); }
    .section { margin-top:30px; } .section-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:12px; }
    h2 { margin-bottom:2px; font-size:20px; line-height:1.2; } .section-copy { margin:0; color:var(--muted); font-size:12px; }
    .panel { border:1px solid var(--line); border-radius:var(--radius); background:var(--paper); box-shadow:var(--shadow); overflow:hidden; }
    .table-wrap { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
    th { padding:11px 12px; border-bottom:1px solid var(--line); color:var(--muted); background:#f9faf9; font-size:10px; font-weight:800; text-align:right; text-transform:uppercase; white-space:nowrap; }
    th:first-child,td:first-child { text-align:left; } td { padding:14px 12px; border-bottom:1px solid #edf0ee; text-align:right; vertical-align:middle; white-space:nowrap; } tbody tr:last-child td { border-bottom:0; } tbody tr:hover { background:#fafcfb; }
    .product-cell { display:flex; align-items:center; gap:11px; min-width:210px; white-space:normal; } .product-code { flex:0 0 34px; width:34px; height:34px; display:grid; place-items:center; border-radius:7px; background:var(--blue-soft); color:var(--blue); font-size:11px; font-weight:800; }
    .product-cell strong { display:block; font-size:13px; } .product-cell small { display:block; margin-top:2px; color:var(--muted); font-size:10px; }
    .money { font-weight:720; } .na { color:#909895; } .return-alert { color:var(--red); font-weight:720; }
    .analysis-grid { display:grid; grid-template-columns:1.05fr 1.45fr; gap:14px; margin-top:14px; } .analysis-block { padding:18px; border:1px solid var(--line); border-radius:var(--radius); background:var(--paper); }
    h3 { margin-bottom:3px; font-size:14px; } .microcopy { color:var(--muted); font-size:11px; }
    .mix-row { display:grid; grid-template-columns:145px 1fr 62px; gap:12px; align-items:center; margin-top:16px; } .mix-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
    .track { height:10px; border-radius:3px; background:#edf1ef; overflow:hidden; } .bar { height:100%; border-radius:3px; background:var(--teal); } .bar.blue { background:var(--blue); } .bar.amber { background:#c98b37; }
    .mix-value { font-weight:720; text-align:right; } .insight-list { margin:14px 0 0; padding:0; list-style:none; } .insight-list li { display:grid; grid-template-columns:9px 1fr; gap:10px; padding:11px 0; border-bottom:1px solid #edf0ee; }
    .insight-list li:last-child { border-bottom:0; padding-bottom:0; } .insight-dot { width:7px; height:7px; margin-top:6px; border-radius:50%; background:var(--teal); } .insight-dot.amber { background:var(--amber); } .insight-dot.red { background:var(--red); }
    .insight-list strong { display:block; margin-bottom:2px; font-size:12px; } .insight-list span { color:var(--muted); font-size:11px; }
    .placement { display:inline-block; min-width:72px; padding:3px 6px; border-radius:4px; font-size:9px; font-weight:850; text-align:center; } .placement.SPONSORED { color:var(--blue); background:var(--blue-soft); } .placement.ORGANIC { color:var(--teal); background:var(--teal-soft); }
    .rank-guide { padding:14px 16px; border-bottom:1px solid var(--line); color:var(--muted); background:#fbfcfb; }
    .rank-guide p { max-width:980px; margin:0; font-size:12px; }
    .confidence-grid { display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid var(--line); } .confidence-item { padding:17px; border-right:1px solid var(--line); } .confidence-item:last-child { border-right:0; } .confidence-item p { margin:8px 0 0; color:var(--muted); font-size:11px; }
    footer { display:flex; justify-content:space-between; gap:20px; padding-top:22px; color:var(--muted); font-size:10px; }
    @media (max-width:1120px) { .kpi-grid { grid-template-columns:repeat(3,1fr); } .analysis-grid { grid-template-columns:1fr; } }
    @media (max-width:720px) { .shell { width:min(100% - 24px, 1480px); } .top-meta span:first-child { display:none; } main { padding-top:22px; } .report-head { align-items:flex-start; flex-direction:column; } .period { width:100%; text-align:left; } .kpi-grid { grid-template-columns:repeat(2,1fr); } .kpi { min-height:104px; padding:13px; } .kpi-value { font-size:22px; } .section-heading { align-items:flex-start; flex-direction:column; } .confidence-grid { grid-template-columns:1fr; } .confidence-item { border-right:0; border-bottom:1px solid var(--line); } .confidence-item:last-child { border-bottom:0; } footer { flex-direction:column; } }
  </style>
</head>
<body>
  <header class="topbar"><div class="shell topbar-inner"><div class="brand"><span class="brand-mark">A</span>Aterra Commerce</div><div class="top-meta"><span>Bol Retailer API</span><span><i class="status-dot"></i>Weekly report</span></div></div></header>
  <main class="shell">
    <section class="report-head"><div><p class="eyebrow">Weekly trading control</p><h1>Bol performance, ${escapeHtml(snapshot.week.label || "weekly report")}</h1><p class="subtitle">Product economics, customer demand and keyword visibility in one decision view.</p></div><div class="period"><strong>${escapeHtml(period)}</strong><span>Retailer API operations</span></div></section>
    <aside class="notice"><span class="notice-symbol">i</span><div><strong>${escapeHtml(rankNotice)}</strong>${escapeHtml(quality.warnings[0] || "Verified values, provisional values and unavailable values are separated below.")}</div></aside>
    <section class="kpi-grid" aria-label="Weekly summary">
      <article class="kpi"><div class="kpi-label"><span>Net shipped GMS</span><span class="tag provisional">Provisional</span></div><div class="kpi-value">${money(totalNet)}</div><div class="kpi-note">After registered returns</div></article>
      <article class="kpi"><div class="kpi-label"><span>Units sold</span><span class="tag verified">Verified</span></div><div class="kpi-value">${totalUnits}</div><div class="kpi-note">Shipment-derived units</div></article>
      <article class="kpi"><div class="kpi-label"><span>ASP</span><span class="tag verified">Verified</span></div><div class="kpi-value">${money(totalUnits > 0 ? grossForAsp / totalUnits : null)}</div><div class="kpi-note">Gross shipped GMS / units</div></article>
      <article class="kpi"><div class="kpi-label"><span>Product visits</span><span class="tag ${missingVisitProducts ? "provisional" : "verified"}">${missingVisitProducts ? "Partial" : "Verified"}</span></div><div class="kpi-value">${totalVisits}</div><div class="kpi-note">Bol PRODUCT_VISITS${missingVisitProducts ? "; missing rows exist" : ""}</div></article>
      <article class="kpi"><div class="kpi-label"><span>After commission</span><span class="tag provisional">Provisional</span></div><div class="kpi-value">${money(totalAfterCommission)}</div><div class="kpi-note">Commercial indicator</div></article>
      <article class="kpi"><div class="kpi-label"><span>Conversion</span><span class="tag verified">Trading</span></div><div class="kpi-value">${percent(totalConversion)}</div><div class="kpi-note">Units sold / Product visits</div></article>
    </section>
    <section class="section"><div class="section-heading"><div><h2>Product scorecard</h2><p class="section-copy">Primary ranks use each product's configured core keyword. All observed keywords are listed below.</p></div></div><div class="panel table-wrap"><table><thead><tr><th>Product</th><th>Net GMS</th><th>Units</th><th>ASP</th><th>Conversion</th><th>Visits</th><th>After commission</th><th>Returns</th><th>Primary keyword</th><th>Sponsored</th><th>Organic</th></tr></thead><tbody>
      ${scorecard.map(row => {
        const returnNotes = [
          `${row.returns}`,
          row.unresolvedReturns ? `${row.unresolvedReturns} unresolved` : null,
          row.unlinkedReturns ? `${row.unlinkedReturns} unlinked` : null,
          row.ambiguousReturns ? `${row.ambiguousReturns} ambiguous` : null,
        ].filter(Boolean).join("; ");
        return `<tr><td><div class="product-cell"><span class="product-code">${escapeHtml(row.product.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(row.product)}</strong><small>EAN ${escapeHtml(row.ean)}</small></div></div></td><td class="money">${money(row.netShippedGms)}</td><td>${row.unitsSold}</td><td>${money(row.asp)}</td><td>${percent(row.conversionRate)}</td><td>${count(row.productVisits)}</td><td class="money">${money(row.revenueAfterCommission)}</td><td class="${row.unresolvedReturns || row.unlinkedReturns || row.ambiguousReturns ? "return-alert" : ""}">${escapeHtml(returnNotes)}</td><td>${escapeHtml(row.primaryKeyword || "N/A")}</td><td>${escapeHtml(rankDisplay(row.sponsoredRank))}</td><td>${escapeHtml(rankDisplay(row.organicRank))}</td></tr>`;
      }).join("\n")}
    </tbody></table></div>
    <div class="analysis-grid"><article class="analysis-block"><h3>Net GMS mix</h3><div class="microcopy">Contribution by product after registered returns</div>${mixRows(scorecard).map(row => `<div class="mix-row"><span class="mix-label">${escapeHtml(row.product)}</span><div class="track"><div class="bar${row.tone}" style="width:${row.share}%"></div></div><span class="mix-value">${row.share}%</span></div>`).join("")}</article><article class="analysis-block"><h3>Management attention</h3><div class="microcopy">Issues and opportunities visible in this week</div><ul class="insight-list">${attention.map(([tone, title, body]) => `<li><span class="insight-dot ${tone}"></span><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div></li>`).join("")}</ul></article></div></section>
    <section class="section"><div class="section-heading"><div><h2>Keyword positions</h2><p class="section-copy">Case variants are combined analytically while raw search terms remain visible. Successful rank coverage: ${rankCoverage.successfulCount}/${rankCoverage.expectedCount} EAN-date-locale calls.</p></div></div><div class="panel"><div class="rank-guide"><p>Each row shows where Bol observed a product for a specific keyword, locale and placement type during the report week. Rank is the product's position in the Bol result list, so a lower number is better, and impressions show how often Bol reported that observed placement. Observed days shows on how many of the seven report days Bol returned that exact product-keyword-locale-placement combination; a missing day means not observed, not rank zero.</p></div><div class="table-wrap"><table><thead><tr><th>EAN</th><th>Locale</th><th>Keyword</th><th>Placement</th><th>Rank</th><th>Impressions</th><th>Observed</th><th>Raw variants</th></tr></thead><tbody>${aggregates.map(row => `<tr><td>${escapeHtml(row.ean)}</td><td>${escapeHtml(row.locale)}</td><td>${escapeHtml(row.searchTerm)}</td><td><span class="placement ${escapeHtml(row.placement)}">${escapeHtml(row.placement)}</span></td><td><strong>${number(row.weeklyRank)}</strong><br><small>${number(row.bestRank)}-${number(row.worstRank)}</small></td><td>${row.impressions}</td><td>${row.daysObserved}/${rankCoverage.expectedDates.length || 7} days</td><td>${escapeHtml(row.rawVariants.join(", "))}</td></tr>`).join("")}</tbody></table></div><div class="confidence-grid"><div class="confidence-item"><span class="tag verified">Verified</span><p>Shipments, units, GMS, commission, Product visits and rank observations come from the supplied Retailer API snapshot.</p></div><div class="confidence-item"><span class="tag provisional">Provisional</span><p>Net GMS and after-commission revenue include linked returns; unlinked or unresolved returns remain visible.</p></div><div class="confidence-item"><span class="tag verified">Trading</span><p>Conversion is units sold divided by Product visits; it is a weekly trading rate, not a pure order-placement cohort.</p></div></div></div></section>
    <footer><span>Aterra - Bol Retailer API - Privacy-safe report artifact</span><span>No dashboard, database, schedule or production workflow changed by this renderer</span></footer>
  </main>
</body>
</html>`;
}

function buildReportData({ snapshot, scorecard, aggregates, observations, calls, quality, rankCoverage, returnMatching }) {
  return {
    report: "Aterra Bol Retailer weekly report",
    week: snapshot.week,
    generatedAt: new Date().toISOString(),
    dataSafety: "Generated from sanitized Retailer API snapshot; no credentials are included.",
    quality: {
      hardFailures: quality.hardFailures,
      warnings: quality.warnings,
      rankDates: quality.rankDates,
      failedRankCalls: quality.failedRankCalls.length,
      rankCoverage: {
        expectedDates: rankCoverage.expectedDates,
        successfulDates: rankCoverage.successfulDates,
        observedDates: rankCoverage.observedDates,
        expectedCount: rankCoverage.expectedCount,
        successfulCount: rankCoverage.successfulCount,
        missingCallCount: rankCoverage.missingCalls.length,
        successfulEmptyCallCount: rankCoverage.successfulEmptyCalls.length,
      },
      returnMatching: {
        unmatchedCount: returnMatching.unmatched.length,
        ambiguousCount: returnMatching.ambiguous.length,
        unmatched: returnMatching.unmatched,
        ambiguous: returnMatching.ambiguous,
      },
    },
    scorecard,
    keywordRanks: aggregates,
    dailyRankObservations: observations,
    calls,
  };
}

function buildManifest({ args, snapshot, reportData, snapshotHash, ranksHash, keywordsHash, paths }) {
  const manifestData = JSON.stringify(reportData);
  return {
    runId: randomUUID(),
    status: "generated",
    generatedAt: reportData.generatedAt,
    report: reportData.report,
    week: snapshot.week,
    inputs: {
      snapshotPath: path.resolve(args.snapshot),
      snapshotSha256: snapshotHash,
      ranksPath: args.ranks ? path.resolve(args.ranks) : null,
      ranksSha256: ranksHash,
      keywordsPath: path.resolve(args.keywords),
      keywordsSha256: keywordsHash,
    },
    outputs: paths,
    mode: {
      allowPartialRank: args.allowPartialRank,
      dryRun: args.dryRun,
    },
    quality: reportData.quality,
    counts: {
      products: reportData.scorecard.length,
      keywordGroups: reportData.keywordRanks.length,
      dailyRankObservations: reportData.dailyRankObservations.length,
      apiCallsRepresented: reportData.calls.length,
      outputJsonSha256: createHash("sha256").update(manifestData).digest("hex"),
    },
    operationalBoundary: "Renderer only. No dashboard, database, scheduled job, email automation, Bol write endpoint, or Advertising API workflow changed.",
  };
}

function scanForSecrets(label, content) {
  const match = SECRET_PATTERNS.find(pattern => pattern.test(content));
  if (match) throw new Error(`Privacy check failed for ${label}: output appears to contain a secret-like token or header.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await readJson(args.snapshot);
  const keywords = await readJson(args.keywords);
  const rankPayload = args.ranks ? normalizeRankPayload(await readJson(args.ranks)) : rankObservationsFromSnapshot(snapshot);
  const aggregates = aggregateRanks(rankPayload.observations);
  const scorecard = buildScorecard(snapshot, keywords, aggregates, rankPayload);
  const rankCoverage = rankCoverageMatrix({ snapshot, keywords, rankPayload });
  const returnMatching = returnAdjustments(snapshot);
  const quality = qualityGates({
    snapshot,
    keywords,
    scorecard,
    observations: rankPayload.observations,
    calls: rankPayload.calls,
    rankCoverage,
    returnMatching,
    allowPartialRank: args.allowPartialRank,
  });
  const slug = args.reportSlug || `bol-retailer-${slugify(snapshot.week?.label || `${snapshot.week?.start}-${snapshot.week?.end}`)}-weekly-report`;
  const htmlPath = path.join(args.outDir, `${slug}.html`);
  const mdPath = path.join(args.outDir, `${slug}.md`);
  const jsonPath = path.join(args.outDir, `${slug}.json`);
  const manifestPath = path.join(args.outDir, `${slug}.run.json`);

  if (quality.hardFailures.length) {
    return {
      exitCode: 2,
      payload: {
        status: "blocked",
        week: snapshot.week || null,
        hardFailures: quality.hardFailures,
        warnings: quality.warnings,
      },
    };
  }

  const reportData = buildReportData({ snapshot, scorecard, aggregates, observations: rankPayload.observations, calls: rankPayload.calls, quality, rankCoverage, returnMatching });
  const markdown = `${buildMarkdown({ snapshot, scorecard, aggregates, quality, calls: rankPayload.calls, rankCoverage })}\n`;
  const html = buildHtml({ snapshot, scorecard, aggregates, quality, rankCoverage });
  const json = `${JSON.stringify(reportData, null, 2)}\n`;

  scanForSecrets("json", json);
  scanForSecrets("markdown", markdown);
  scanForSecrets("html", html);

  const snapshotHash = await fileSha256(args.snapshot);
  const ranksHash = args.ranks ? await fileSha256(args.ranks) : null;
  const keywordsHash = await fileSha256(args.keywords);
  const paths = {
    htmlPath,
    markdownPath: mdPath,
    jsonPath,
    manifestPath,
  };
  const manifest = `${JSON.stringify(buildManifest({ args, snapshot, reportData, snapshotHash, ranksHash, keywordsHash, paths }), null, 2)}\n`;
  scanForSecrets("manifest", manifest);

  let lockPath = null;
  if (!args.dryRun) {
    await fs.mkdir(args.outDir, { recursive: true });
    lockPath = await acquireLock(args.outDir, slug);
    try {
      await writeAtomic(jsonPath, json);
      await writeAtomic(mdPath, markdown);
      await writeAtomic(htmlPath, html);
      await writeAtomic(manifestPath, manifest);
    } finally {
      await releaseLock(lockPath);
    }
  }

  return {
    exitCode: 0,
    payload: {
      status: args.dryRun ? "validated" : "generated",
      htmlPath: args.dryRun ? null : htmlPath,
      markdownPath: args.dryRun ? null : mdPath,
      jsonPath: args.dryRun ? null : jsonPath,
      manifestPath: args.dryRun ? null : manifestPath,
      products: scorecard.length,
      warnings: quality.warnings,
      rankDates: quality.rankDates,
      keywordGroups: aggregates.length,
      dryRun: args.dryRun,
    },
  };
}

main()
  .then(result => {
    const writer = result.exitCode === 0 ? console.log : console.error;
    writer(JSON.stringify(result.payload, null, 2));
    process.exit(result.exitCode);
  })
  .catch(error => {
    console.error(JSON.stringify({
      status: "error",
      message: error.message,
    }, null, 2));
    process.exit(1);
  });
