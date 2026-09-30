#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "generate-weekly-report.mjs");
const COLLECTOR_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "collect-weekly-snapshot.mjs");

const week = {
  label: "2026-W01",
  start: "2025-12-29",
  end: "2026-01-04",
};

function runReport(args) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: "utf8",
  });
  const payload = JSON.parse(result.status === 0 ? result.stdout : result.stderr);
  return { ...result, payload };
}

function runCollector(args, env = process.env) {
  const result = spawnSync(process.execPath, [COLLECTOR_PATH, ...args], {
    encoding: "utf8",
    env,
  });
  const payload = JSON.parse(result.status === 0 ? result.stdout : result.stderr);
  return { ...result, payload };
}

async function withFixture(files, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), "bol-retailer-report-test-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(dir, name), `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
    }
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function rankCallsForWeek(ean) {
  return ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]
    .map(date => ({ ean, date, locale: "nl-NL", status: 200, page: 1, rows: 0 }));
}

test("includes products that sold during the week even when no current offer exists", async () => {
  const ean = "1111111111111";
  const keywords = {
    locales: ["nl-NL"],
    products: {
      [ean]: { shortName: "Legacy product", primaryKeyword: "legacy" },
    },
  };
  const snapshot = {
    week,
    summary: { apiCalls: 7, apiErrors: 0 },
    apiCalls: rankCallsForWeek(ean),
    operational: {
      byEan: {
        [ean]: { orders: 1, shipments: 1, lines: 1, units: 2, grossOrderValue: 40, commission: 6 },
      },
      ordersFromShipmentDetails: [],
      returns: [],
    },
    currentState: { offers: [] },
    weekMetrics: { offerInsights: [{ ean, metric: "PRODUCT_VISITS", weekTotal: 10 }] },
  };
  const ranks = { calls: rankCallsForWeek(ean), dailyRankObservations: [] };

  await withFixture({ "snapshot.json": snapshot, "keywords.json": keywords, "ranks.json": ranks }, async dir => {
    const result = runReport([
      "--snapshot", path.join(dir, "snapshot.json"),
      "--ranks", path.join(dir, "ranks.json"),
      "--keywords", path.join(dir, "keywords.json"),
      "--out-dir", dir,
      "--report-slug", "legacy-product",
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.payload.products, 1);
    const report = JSON.parse(await readFile(path.join(dir, "legacy-product.json"), "utf8"));
    assert.equal(report.scorecard[0].ean, ean);
    assert.equal(report.scorecard[0].product, "Legacy product");
    assert.equal(report.scorecard[0].unitsSold, 2);
  });
});

test("collector blocks safely when managed credentials are unavailable", () => {
  const env = { ...process.env };
  delete env.BOL_RETAILER_CLIENT_ID;
  delete env.BOL_RETAILER_CLIENT_SECRET;
  const result = runCollector([
    "--start", week.start,
    "--end", week.end,
    "--out-dir", tmpdir(),
    "--dry-run",
  ], env);

  assert.equal(result.status, 1);
  assert.equal(result.payload.status, "error");
  assert.match(result.payload.message, /BOL_RETAILER_CLIENT_ID/);
  assert.doesNotMatch(JSON.stringify(result.payload), /secret|Bearer|Basic\s/i);
});

test("successful empty rank calls satisfy date coverage without inventing rank observations", async () => {
  const ean = "2222222222222";
  const keywords = {
    locales: ["nl-NL"],
    products: {
      [ean]: { shortName: "Quiet product", primaryKeyword: "quiet" },
    },
  };
  const snapshot = {
    week,
    summary: { apiCalls: 7, apiErrors: 0 },
    apiCalls: rankCallsForWeek(ean),
    operational: { byEan: {}, ordersFromShipmentDetails: [], returns: [] },
    currentState: { offers: [{ ean, unknownProductTitle: "Quiet product" }] },
    weekMetrics: { offerInsights: [{ ean, metric: "PRODUCT_VISITS", weekTotal: 0 }] },
  };
  const ranks = { calls: rankCallsForWeek(ean), dailyRankObservations: [] };

  await withFixture({ "snapshot.json": snapshot, "keywords.json": keywords, "ranks.json": ranks }, async dir => {
    const result = runReport([
      "--snapshot", path.join(dir, "snapshot.json"),
      "--ranks", path.join(dir, "ranks.json"),
      "--keywords", path.join(dir, "keywords.json"),
      "--out-dir", dir,
      "--report-slug", "empty-ranks",
      "--dry-run",
    ]);

    assert.equal(result.status, 0);
    assert.deepEqual(result.payload.rankDates, rankCallsForWeek(ean).map(call => call.date));
    assert.equal(result.payload.keywordGroups, 0);
  });
});

test("unlinked returns are visible and excluded from value adjustments", async () => {
  const ean = "3333333333333";
  const keywords = {
    locales: ["nl-NL"],
    products: {
      [ean]: { shortName: "Return product", primaryKeyword: "return" },
    },
  };
  const snapshot = {
    week,
    summary: { apiCalls: 7, apiErrors: 0 },
    apiCalls: rankCallsForWeek(ean),
    operational: {
      byEan: {
        [ean]: { orders: 1, shipments: 1, lines: 1, units: 1, grossOrderValue: 50, commission: 8 },
      },
      ordersFromShipmentDetails: [{ orderId: "order-1", detail: { orderId: "order-1", orderItems: [] } }],
      returns: [{
        returnId: "return-1",
        returnItems: [{ orderId: "order-1", ean, expectedQuantity: 1, handled: false }],
      }],
    },
    currentState: { offers: [{ ean, unknownProductTitle: "Return product" }] },
    weekMetrics: { offerInsights: [{ ean, metric: "PRODUCT_VISITS", weekTotal: 4 }] },
  };
  const ranks = { calls: rankCallsForWeek(ean), dailyRankObservations: [] };

  await withFixture({ "snapshot.json": snapshot, "keywords.json": keywords, "ranks.json": ranks }, async dir => {
    const result = runReport([
      "--snapshot", path.join(dir, "snapshot.json"),
      "--ranks", path.join(dir, "ranks.json"),
      "--keywords", path.join(dir, "keywords.json"),
      "--out-dir", dir,
      "--report-slug", "unlinked-return",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.payload.warnings.join("\n"), /could not be linked/);
    const report = JSON.parse(await readFile(path.join(dir, "unlinked-return.json"), "utf8"));
    assert.equal(report.scorecard[0].returns, 1);
    assert.equal(report.scorecard[0].unlinkedReturns, 1);
    assert.equal(report.scorecard[0].netShippedGms, 50);
  });
});
