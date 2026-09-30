import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repo = "/Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app";
const snapshotPath = path.join(repo, "docs/bol-retailer-api-2026-W39-snapshot-2026-09-28.json");
const reportPath = path.join(repo, "docs/bol-retailer-2026-W39-weekly-report.json");
const cloudDir = path.join(repo, "outputs/retailer-drive-w39/cloud-source/run=32a6e6ad-9a82-453f-840e-078ae592cfe2");
const outputDir = path.join(repo, "outputs/retailer-drive-w39");
const outputPath = path.join(outputDir, "Aterra-Bol-Retailer-2026-W39-data-review.xlsx");

const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(cloudDir, "manifest.json"), "utf8"));

const workbook = Workbook.create();
for (const name of ["Overview", "Products", "Weekly ranks", "Daily ranks", "Shipments", "Returns", "Offers", "API quality", "Source index"]) {
  workbook.worksheets.add(name);
}
const font = "Arial";
const colors = {
  text: "#202124",
  muted: "#5F6368",
  header: "#E8EAED",
  border: "#DADCE0",
  warning: "#FEF7E0",
  warningText: "#8A4B08",
  good: "#E6F4EA",
  goodText: "#137333",
};

function writeTable(sheet, startRow, headers, rows, tableName) {
  const start = startRow - 1;
  const matrix = [headers, ...rows];
  const range = sheet.getRangeByIndexes(start, 0, matrix.length, headers.length);
  range.values = matrix;
  range.format.font = { name: font, size: 10, color: colors.text };
  range.format.verticalAlignment = "center";
  range.format.borders = {
    insideHorizontal: { style: "thin", color: colors.border },
    bottom: { style: "thin", color: colors.border },
  };
  const header = sheet.getRangeByIndexes(start, 0, 1, headers.length);
  header.format.fill = colors.header;
  header.format.font = { name: font, size: 10, bold: true, color: colors.text };
  header.format.horizontalAlignment = "center";
  header.format.rowHeightPx = 28;
  const table = sheet.tables.add(range, true, tableName);
  table.showBandedRows = false;
  table.showFilterButton = true;
  return { range, table, firstDataRow: startRow + 1, lastDataRow: startRow + rows.length };
}

function setupSheet(sheet, title, context) {
  sheet.showGridLines = false;
  sheet.getRange("A2").values = [[title]];
  sheet.getRange("A2").format.font = { name: font, size: 14, bold: true, color: colors.text };
  sheet.getRange("A3").values = [[context]];
  sheet.getRange("A3").format.font = { name: font, size: 10, italic: true, color: colors.muted };
}

function safeText(value) {
  if (value == null) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function identifier(value) {
  return value == null || value === "" ? "" : Number(value);
}

function flattenShipments(shipments) {
  const rows = [];
  for (const shipment of shipments || []) {
    for (const item of shipment.shipmentItems || []) {
      rows.push([
        snapshot.week.label,
        shipment.shipmentDateTime || "",
        shipment.shipmentId || "",
        shipment.order?.orderId || "",
        shipment.order?.orderPlacedDateTime || "",
        item.orderItemId || "",
        identifier(item.ean),
        shipment.transport?.transportId || "",
        "API source",
        "",
      ]);
    }
  }
  return rows;
}

function flattenReturns(returns) {
  const rows = [];
  for (const ret of returns || []) {
    for (const item of ret.returnItems || []) {
      rows.push([
        snapshot.week.label,
        ret.registrationDateTime || "",
        ret.returnId || "",
        item.rmaId || "",
        item.orderId || "",
        identifier(item.ean),
        item.expectedQuantity ?? "",
        item.handled ?? "",
        item.returnReason?.mainReason || "",
        item.returnReason?.detailedReason || "",
        "Customer comments excluded",
        "",
      ]);
    }
  }
  return rows;
}

const overview = workbook.worksheets.getItem("Overview");
setupSheet(overview, "Aterra Bol Retailer data review", `${snapshot.week.label} | ${snapshot.week.start} to ${snapshot.week.end}`);
overview.getRange("A5:B5").values = [["Metric", "Value"]];
overview.getRange("A6:A14").values = [
  ["Products"],
  ["Net shipped GMS"],
  ["Units sold"],
  ["Product visits"],
  ["Trading conversion"],
  ["Revenue after commission"],
  ["Returns"],
  ["Rank dates covered"],
  ["API errors"],
];
overview.getRange("B6:B14").formulas = [
  ["=COUNTA(Products!A7:A10)"],
  ["=SUM(Products!D7:D10)"],
  ["=SUM(Products!E7:E10)"],
  ["=SUM(Products!G7:G10)"],
  ["=IF(B9=0,\"n.a.\",B8/B9)"],
  ["=SUM(Products!J7:J10)"],
  ["=SUM(Products!K7:K10)"],
  [`=${report.quality.rankDates.length}`],
  [`=${snapshot.summary.apiErrors}`],
];
overview.getRange("A5:B14").format.font = { name: font, size: 10, color: colors.text };
overview.getRange("A5:B5").format.fill = colors.header;
overview.getRange("A5:B5").format.font = { name: font, size: 10, bold: true, color: colors.text };
overview.getRange("A5:B14").format.borders = { preset: "all", style: "thin", color: colors.border };
overview.getRange("B7").format.numberFormat = "€#,##0.00";
overview.getRange("B8:B9").format.numberFormat = "#,##0";
overview.getRange("B10").format.numberFormat = "0.0%";
overview.getRange("B11").format.numberFormat = "€#,##0.00";
overview.getRange("B12:B14").format.numberFormat = "#,##0";
overview.getRange("D5:F5").values = [["Data-quality status", "Detail", "Reviewer note"]];
const warningRows = [
  ["Cloud run", manifest.status, ""],
  ["Rank coverage", `${report.quality.rankDates.length}/7 dates; ${report.quality.rankCoverage.successfulCount}/${report.quality.rankCoverage.expectedCount} calls`, ""],
  ["Returns", `${report.quality.returnMatching.unmatchedCount} unmatched return item`, ""],
  ["Conversion", "Shipped units divided by Bol Product Visits", ""],
  ["Drive source JSON", "Not uploaded in this test: customer-comment fields require redaction", ""],
];
overview.getRange("D6:F10").values = warningRows;
overview.getRange("D5:F10").format.font = { name: font, size: 10, color: colors.text };
overview.getRange("D5:F5").format.fill = colors.header;
overview.getRange("D5:F5").format.font = { name: font, size: 10, bold: true, color: colors.text };
overview.getRange("D6:F10").format.wrapText = true;
overview.getRange("D6:F10").format.borders = { preset: "all", style: "thin", color: colors.border };
overview.getRange("D10:F10").format.fill = colors.warning;
overview.getRange("D10:F10").format.font = { name: font, size: 10, color: colors.warningText };
overview.getRange("A17:F17").values = [["How to use this workbook", "", "", "", "", ""]];
overview.getRange("A17:F17").format.font = { name: font, size: 10, bold: true, color: colors.text };
overview.getRange("A18:F20").values = [
  ["1", "Use Products for weekly product economics.", "", "", "", ""],
  ["2", "Filter Daily ranks by EAN, keyword, locale and placement to verify visibility.", "", "", "", ""],
  ["3", "Use the final Reviewer note columns without changing API values.", "", "", "", ""],
];
overview.getRange("A18:F20").format.font = { name: font, size: 10, color: colors.text };
overview.getRange("A:F").format.columnWidthPx = 150;
overview.getRange("A:A").format.columnWidthPx = 175;
overview.getRange("B:B").format.columnWidthPx = 125;
overview.getRange("D:D").format.columnWidthPx = 135;
overview.getRange("E:E").format.columnWidthPx = 330;
overview.getRange("F:F").format.columnWidthPx = 200;

const products = workbook.worksheets.getItem("Products");
setupSheet(products, "Weekly product metrics", "Values are derived from the sanitized W39 Retailer API snapshot.");
const productHeaders = ["EAN", "Product", "Primary keyword", "Net shipped GMS", "Units sold", "ASP", "Product visits", "Trading conversion", "Conversion status", "Revenue after commission", "Returns", "Unresolved returns", "Sponsored weekly rank", "Organic weekly rank", "Reviewer note"];
const productRows = report.scorecard.map(row => [
  identifier(row.ean),
  row.product,
  row.primaryKeyword,
  row.netShippedGms,
  row.unitsSold,
  row.asp,
  row.productVisits,
  row.productVisits ? row.unitsSold / row.productVisits : null,
  row.productVisitsStatus === "verified" ? "Verified: units / visits" : row.conversionStatus,
  row.revenueAfterCommission,
  row.returns,
  row.unresolvedReturns,
  row.sponsoredRank?.weeklyRank ?? "Not observed",
  row.organicRank?.weeklyRank ?? "Not observed",
  "",
]);
writeTable(products, 6, productHeaders, productRows, "ProductsTable");
products.freezePanes.freezeRows(6);
products.freezePanes.freezeColumns(2);
products.getRange("D7:D10").format.numberFormat = "€#,##0.00";
products.getRange("A7:A10").format.numberFormat = "0";
products.getRange("E7:E10").format.numberFormat = "#,##0";
products.getRange("F7:F10").format.numberFormat = "€#,##0.00";
products.getRange("G7:G10").format.numberFormat = "#,##0";
products.getRange("H7:H10").format.numberFormat = "0.0%";
products.getRange("J7:J10").format.numberFormat = "€#,##0.00";
products.getRange("K7:N10").format.numberFormat = "#,##0.0";
products.getRange("A:O").format.columnWidthPx = 120;
products.getRange("B:B").format.columnWidthPx = 190;
products.getRange("C:C").format.columnWidthPx = 150;
products.getRange("I:I").format.columnWidthPx = 190;
products.getRange("H:H").format.columnWidthPx = 150;
products.getRange("J:J").format.columnWidthPx = 175;
products.getRange("L:L").format.columnWidthPx = 150;
products.getRange("M:N").format.columnWidthPx = 190;
products.getRange("O:O").format.columnWidthPx = 220;

const weeklyRanks = workbook.worksheets.getItem("Weekly ranks");
setupSheet(weeklyRanks, "Weekly keyword ranks", "One row per EAN, locale, normalized keyword and placement.");
const weeklyRankRows = report.keywordRanks.map(row => [
  snapshot.week.label,
  identifier(row.ean),
  row.locale,
  row.searchTerm,
  safeText(row.rawVariants),
  row.placement,
  row.observations,
  row.daysObserved,
  row.impressions,
  row.weeklyRank,
  row.bestRank,
  row.worstRank,
  "",
]);
writeTable(weeklyRanks, 6, ["ISO week", "EAN", "Locale", "Keyword", "Raw variants", "Placement", "Observations", "Days observed", "Impressions", "Weekly rank", "Best rank", "Worst rank", "Reviewer note"], weeklyRankRows, "WeeklyRanksTable");
weeklyRanks.freezePanes.freezeRows(6);
weeklyRanks.freezePanes.freezeColumns(2);
weeklyRanks.getRange("A:M").format.columnWidthPx = 115;
weeklyRanks.getRange(`B7:B${6 + weeklyRankRows.length}`).format.numberFormat = "0";
weeklyRanks.getRange("D:E").format.columnWidthPx = 180;
weeklyRanks.getRange("M:M").format.columnWidthPx = 220;

const dailyRanks = workbook.worksheets.getItem("Daily ranks");
setupSheet(dailyRanks, "Daily keyword-rank observations", "Observed rows only. Successful empty calls are listed on API quality.");
const dailyRankRows = report.dailyRankObservations.map(row => [
  row.date,
  snapshot.week.label,
  identifier(row.ean),
  row.locale,
  row.searchTermRaw,
  row.searchTermNormalized,
  row.placement,
  row.rank,
  row.impressions,
  "",
]);
writeTable(dailyRanks, 6, ["Date", "ISO week", "EAN", "Locale", "Raw keyword", "Normalized keyword", "Placement", "Rank", "Impressions", "Reviewer note"], dailyRankRows, "DailyRanksTable");
dailyRanks.freezePanes.freezeRows(6);
dailyRanks.freezePanes.freezeColumns(3);
dailyRanks.getRange("A:J").format.columnWidthPx = 125;
dailyRanks.getRange(`C7:C${6 + dailyRankRows.length}`).format.numberFormat = "0";
dailyRanks.getRange("E:F").format.columnWidthPx = 180;
dailyRanks.getRange("J:J").format.columnWidthPx = 220;

const shipments = workbook.worksheets.getItem("Shipments");
setupSheet(shipments, "Shipment evidence", "Identifiers are redacted in the sanitized snapshot.");
const shipmentRows = flattenShipments(snapshot.operational.shipments);
writeTable(shipments, 6, ["ISO week", "Shipment datetime", "Shipment ID", "Order ID", "Order placed datetime", "Order item ID", "EAN", "Transport ID", "Verification status", "Reviewer note"], shipmentRows, "ShipmentsTable");
shipments.freezePanes.freezeRows(6);
shipments.freezePanes.freezeColumns(2);
shipments.getRange("A:J").format.columnWidthPx = 145;
shipments.getRange(`G7:G${6 + shipmentRows.length}`).format.numberFormat = "0";
shipments.getRange("J:J").format.columnWidthPx = 220;

const returnsSheet = workbook.worksheets.getItem("Returns");
setupSheet(returnsSheet, "Return evidence", "Customer comments are deliberately excluded from this workbook.");
const returnRows = flattenReturns(snapshot.operational.returns);
writeTable(returnsSheet, 6, ["ISO week", "Registered datetime", "Return ID", "RMA ID", "Order ID", "EAN", "Quantity", "Handled", "Main reason", "Detailed reason", "Privacy treatment", "Reviewer note"], returnRows, "ReturnsTable");
returnsSheet.freezePanes.freezeRows(6);
returnsSheet.freezePanes.freezeColumns(2);
returnsSheet.getRange("A:L").format.columnWidthPx = 140;
returnsSheet.getRange(`F7:F${6 + returnRows.length}`).format.numberFormat = "0";
returnsSheet.getRange("I:J").format.columnWidthPx = 190;
returnsSheet.getRange("K:L").format.columnWidthPx = 220;

const offers = workbook.worksheets.getItem("Offers");
setupSheet(offers, "Current offer and inventory state", `Current-state capture generated ${snapshot.generatedAt}.`);
const offerRows = (snapshot.currentState.offers || []).map(row => [
  identifier(row.ean),
  row.unknownProductTitle || "",
  row.lastModifiedDateTime || "",
  row.onHoldByRetailer ?? "",
  row.stock?.amount ?? "",
  row.stock?.correctedStock ?? "",
  row.stock?.managedByRetailer ?? "",
  safeText((row.countryAvailabilities || []).filter(x => x.forSale).map(x => x.countryCode)),
  row.pricing?.bundlePrices?.[0]?.unitPrice ?? "",
  row.fulfilment?.method || "",
  row.fulfilment?.schedule || "",
  "",
]);
writeTable(offers, 6, ["EAN", "Product", "Last modified", "On hold", "Stock", "Corrected stock", "Managed by retailer", "For sale in", "Unit price", "Fulfilment", "Schedule", "Reviewer note"], offerRows, "OffersTable");
offers.freezePanes.freezeRows(6);
offers.freezePanes.freezeColumns(2);
offers.getRange("A:L").format.columnWidthPx = 135;
offers.getRange(`A7:A${6 + offerRows.length}`).format.numberFormat = "0";
offers.getRange("B:B").format.columnWidthPx = 190;
offers.getRange("L:L").format.columnWidthPx = 220;
offers.getRange("I7:I10").format.numberFormat = "€#,##0.00";

const quality = workbook.worksheets.getItem("API quality");
setupSheet(quality, "API calls and completeness", "Use this tab to verify pagination, errors, empty rank calls and rate-limit evidence.");
const callRows = snapshot.apiCalls.map(row => [
  row.label,
  row.method,
  row.path,
  row.status,
  row.ok,
  row.ms,
  row.rows,
  row.page ?? "",
  row.cursor ? "present" : "",
  row.paginationComplete ?? "",
  row.rate?.limit ?? "",
  row.rate?.remaining ?? "",
  row.rate?.reset ?? "",
]);
writeTable(quality, 6, ["Call", "Method", "Path", "HTTP status", "OK", "Duration ms", "Rows", "Page", "Cursor", "Pagination complete", "Rate limit", "Remaining", "Reset"], callRows, "ApiCallsTable");
quality.freezePanes.freezeRows(6);
quality.freezePanes.freezeColumns(3);
quality.getRange("A:M").format.columnWidthPx = 115;
quality.getRange("A:A").format.columnWidthPx = 235;
quality.getRange("C:C").format.columnWidthPx = 280;

const sources = workbook.worksheets.getItem("Source index");
setupSheet(sources, "Source manifest and checksums", "Supabase manifest is authoritative. Raw Drive upload is pending customer-comment redaction.");
const artifactRows = [];
for (const artifact of manifest.artifacts || []) {
  const localPath = path.join(cloudDir, path.basename(artifact.path));
  const bytes = await fs.readFile(localPath);
  const localSha = crypto.createHash("sha256").update(bytes).digest("hex");
  artifactRows.push([
    path.basename(artifact.path),
    artifact.path,
    artifact.bytes,
    artifact.sha256,
    localSha,
    localSha === artifact.sha256 ? "Matched" : "Mismatch",
    path.basename(artifact.path) === "commercial.json" ? "Drive upload pending privacy redaction" : "Not uploaded in test",
    "",
  ]);
}
const manifestBytes = await fs.readFile(path.join(cloudDir, "manifest.json"));
artifactRows.unshift([
  "manifest.json",
  `retailer-api/year=2026/week=39/run=${manifest.runId}/manifest.json`,
  manifestBytes.length,
  "Manifest is authoritative",
  crypto.createHash("sha256").update(manifestBytes).digest("hex"),
  "Read successfully",
  "Not uploaded in test",
  "",
]);
writeTable(sources, 6, ["Artifact", "Supabase path", "Bytes", "Manifest SHA-256", "Downloaded SHA-256", "Checksum result", "Drive status", "Reviewer note"], artifactRows, "SourceIndexTable");
sources.freezePanes.freezeRows(6);
sources.freezePanes.freezeColumns(1);
sources.getRange("A:H").format.columnWidthPx = 150;
sources.getRange("B:B").format.columnWidthPx = 430;
sources.getRange("D:E").format.columnWidthPx = 430;
sources.getRange("G:H").format.columnWidthPx = 230;

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  used.format.font = { name: font, size: 10, color: colors.text };
  used.format.verticalAlignment = "center";
}

workbook.recalculate();
const overviewCheck = await workbook.inspect({
  kind: "table",
  range: "Overview!A1:F20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
});
console.log(overviewCheck.ndjson);
const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errorCheck.ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const name of ["Overview", "Products", "Weekly ranks", "Daily ranks", "Shipments", "Returns", "Offers", "API quality", "Source index"]) {
  const preview = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `preview-${name.toLowerCase().replace(/\s+/g, "-")}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ status: "created", outputPath, sheets: workbook.worksheets.items.map(s => s.name) }));
