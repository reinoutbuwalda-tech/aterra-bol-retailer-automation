import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the financial control room and removes the starter", async () => {
  const [ui, benchmark, layout, css, revenueCss] = await Promise.all([
    readFile(new URL("../app/control-room.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/benchmark.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/revenue-period.css", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Aterra Financial Control Room/);
  assert.match(ui, /Bol revenue progression/);
  assert.match(ui, /Traceability chain/);
  assert.match(ui, /Captured BTW lines/);
  assert.match(ui, /Operating model/);
  assert.match(ui, /Opening to current inventory/);
  assert.match(ui, /Bol orders → revenue/);
  assert.match(ui, /All ten policy proposals approved/);
  assert.match(ui, /Reporting period/);
  assert.match(ui, /Customer sales value · incl\. BTW/);
  assert.match(ui, /Management P&amp;L/);
  assert.match(ui, /Profit &amp; loss line/);
  assert.match(ui, /Review evidence/);
  assert.match(ui, /drive-document-link/);
  assert.match(ui, /document ↗/);
  assert.match(ui, /Refunds, cancellations and credit notes remain separate reversals/);
  assert.match(benchmark, /€3,001\.69/);
  assert.match(benchmark, /revenueExVat: 5210\.96/);
  assert.match(benchmark, /revenueIncVat: 6305\.26/);
  assert.match(benchmark, /1gf8aMMgVAgbVV5aR6Y8e5uboq7eJSXYg/);
  assert.match(benchmark, /1XQcm0FZEe6h_WTO5YxZFTMbOVIfFiBkA/);
  assert.match(benchmark, /Treso ONO/);
  assert.match(benchmark, /NL868817375B01/);
  assert.match(benchmark, /owner-confirmed/);
  assert.match(benchmark, /Fruit-infuser carafe/);
  assert.match(benchmark, /current: 195/);
  assert.match(benchmark, /order date/);
  assert.match(benchmark, /POL-01 through POL-10/);
  assert.match(benchmark, /owner-approved/);
  assert.match(benchmark, /not the BTW reserve/i);
  assert.match(css, /--forest:#4a6741/);
  assert.match(revenueCss, /reporting-scope/);
  assert.doesNotMatch(ui + layout, /Starter Project|react-loading-skeleton/);
});

test("keeps consequential actions behind human and policy gates", async () => {
  const [auth, exceptionApi, evidenceApi, proxy, database] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/exceptions/resolve/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evidence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/runtime.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /t\.w\.dewaard@gmail\.com/);
  assert.match(auth, /hiddebaron@live\.nl/);
  assert.match(exceptionApi, /Read-only role/);
  assert.match(evidenceApi, /SHA-256/);
  assert.match(auth, /currentUser/);
  assert.match(proxy, /auth\.protect/);
  assert.match(database, /audit_events/);
  assert.match(database, /getSupabaseAdmin/);
  assert.doesNotMatch(auth, /ChatGPT/);
});
