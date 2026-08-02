import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the financial control room and removes the starter", async () => {
  const [ui, benchmark, layout, css] = await Promise.all([
    readFile(new URL("../app/control-room.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/benchmark.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Aterra Financial Control Room/);
  assert.match(ui, /Bol revenue progression/);
  assert.match(ui, /Traceability chain/);
  assert.match(ui, /Captured BTW lines/);
  assert.match(ui, /is authoritative/);
  assert.match(benchmark, /€3,001\.69/);
  assert.match(benchmark, /Treso ONO/);
  assert.match(benchmark, /NL868817375B01/);
  assert.match(benchmark, /NL005313044B88/);
  assert.match(benchmark, /owner-confirmed/);
  assert.match(benchmark, /not the BTW reserve/i);
  assert.match(css, /--forest:#4a6741/);
  assert.doesNotMatch(ui + layout, /Starter Project|react-loading-skeleton/);
});

test("keeps consequential actions behind human and policy gates", async () => {
  const [auth, exceptionApi, evidenceApi] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/exceptions/resolve/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evidence/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /t\.w\.dewaard@gmail\.com/);
  assert.match(auth, /hiddebaron@live\.nl/);
  assert.match(exceptionApi, /Read-only role/);
  assert.match(evidenceApi, /SHA-256/);
});
