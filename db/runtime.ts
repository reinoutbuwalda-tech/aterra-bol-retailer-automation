import { env } from "cloudflare:workers";
import { benchmark, type FinanceException } from "@/lib/benchmark";

type RawDb = { exec(query: string): Promise<unknown>; prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results?: T[] }> } } };
type EvidenceInput = { id: string; fileName: string; drivePath: string; objectKey: string; sha256: string; mimeType: string };

function rawDb(): RawDb | null { return (env as unknown as { DB?: RawDb }).DB || null; }

async function ensureSchema(db: RawDb) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS exceptions (id TEXT PRIMARY KEY, title TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, detail TEXT NOT NULL, owner TEXT NOT NULL, resolution TEXT, resolved_by TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS source_files (id TEXT PRIMARY KEY, provider_id TEXT, file_name TEXT NOT NULL, drive_path TEXT NOT NULL, drive_file_id TEXT, object_key TEXT, sha256 TEXT NOT NULL, mime_type TEXT, period_start TEXT, period_end TEXT, received_at TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_email TEXT NOT NULL, action TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL, before_json TEXT, after_json TEXT, occurred_at TEXT NOT NULL);
  `);
  for (const item of benchmark.exceptions) {
    await db.prepare("INSERT OR IGNORE INTO exceptions (id,title,severity,status,source,detail,owner) VALUES (?,?,?,?,?,?,?)")
      .bind(item.id, item.title, item.severity, item.status, item.source, item.detail, item.owner).run();
  }
  const decisionTime = "2026-08-02T00:00:00.000Z";
  await db.prepare("UPDATE exceptions SET source='Owner decision', detail=? WHERE id='EX-006'")
    .bind("Reinout confirmed NL868817375B01 as the authoritative VAT ID for Treso ONO/Aterra.").run();
  await db.prepare("UPDATE exceptions SET title=?, status='resolved', source=?, detail=?, owner=?, resolution=?, resolved_by=?, resolved_at=COALESCE(resolved_at,?), updated_at=? WHERE id='EX-006' AND status='open'")
    .bind("Authoritative VAT identity confirmed", "Owner decision + source comparison", "Reinout confirmed NL868817375B01 as the authoritative VAT ID for Treso ONO/Aterra. NL005313044B88 is not valid for the current entity.", "Reinout", "Set NL868817375B01 as authoritative; reclassify MarktMentor as a billing-profile correction.", "reinout.buwalda@gmail.com", decisionTime, decisionTime).run();
  await db.prepare("INSERT OR IGNORE INTO audit_events (id,actor_email,action,object_type,object_id,after_json,occurred_at) VALUES (?,?,?,?,?,?,?)")
    .bind("decision-vat-id-2026-08-02", "reinout.buwalda@gmail.com", "entity.vat_id.confirm", "legal_entity", "treso-ono", JSON.stringify({ vatId: "NL868817375B01", status: "owner-confirmed", incorrectObservedValue: "NL005313044B88" }), decisionTime).run();
  await db.prepare("UPDATE exceptions SET title=?, source=?, detail=?, owner=?, updated_at=? WHERE id='EX-004' AND status='open'")
    .bind("Inventory valuation and landed cost missing", "Supplier + freight evidence", "Opening quantities are confirmed, but COGS and gross margin require approved unit cost and landed-cost valuation.", "Reinout + accountant", decisionTime).run();
  await db.prepare("UPDATE exceptions SET title=?, status='resolved', source='Owner decision', detail=?, owner='Reinout', resolution=?, resolved_by='reinout.buwalda@gmail.com', resolved_at=COALESCE(resolved_at,?), updated_at=? WHERE id='EX-007' AND status='open'")
    .bind("Bol export window clarified", "Bol's 14-day spans are export windows only. Accounting uses the underlying event dates.", "Use order and adjustment event dates, not export-window dates.", decisionTime, decisionTime).run();
  await db.prepare("UPDATE exceptions SET title=?, status='resolved', source='Owner decision', detail=?, owner='Reinout', resolution=?, resolved_by='reinout.buwalda@gmail.com', resolved_at=COALESCE(resolved_at,?), updated_at=? WHERE id='EX-008' AND status='open'")
    .bind("Bol order is the revenue event", "A Bol order creates revenue on its order date. Confirmed cancellations, refunds and credit notes reverse revenue and output VAT.", "Activate owner-approved Bol order and reversal policy.", decisionTime, decisionTime).run();
  await db.prepare("UPDATE exceptions SET title=?, severity='low', status='resolved', source='Owner decision', detail=?, owner='Reinout', resolution=?, resolved_by='reinout.buwalda@gmail.com', resolved_at=COALESCE(resolved_at,?), updated_at=? WHERE id='EX-009' AND status='open'")
    .bind("MarktMentor VAT field disregarded", "MarktMentor is treated solely as a third-party analytics subscription; its displayed customer VAT field is excluded from entity identity logic.", "Exclude MarktMentor customer VAT metadata from tax identity checks.", decisionTime, decisionTime).run();
  for (const [id, objectType, objectId, payload] of [
    ["decision-revenue-policy-2026-08-02", "accounting_policy", "POL-02", { event: "bol_order_date", cancellation: "bol_confirmation_date", refund: "bol_confirmation_date", creditNote: "bol_confirmation_date" }],
    ["decision-inventory-opening-2026-08-02", "inventory", "opening-balance", { carafeFruit: 100, carafeRvs: 100, sportsBag: 200, currentSportsBag: 195, warehouse: "Tien Fulfilment" }],
    ["decision-fulfilment-provider-2026-08-02", "source_provider", "tien-fulfilment", { current: true, historicalProvider: "Max Fulfilment", cutover: "derive from first Tien event" }],
  ] as const) {
    await db.prepare("INSERT OR IGNORE INTO audit_events (id,actor_email,action,object_type,object_id,after_json,occurred_at) VALUES (?,?,?,?,?,?,?)")
      .bind(id, "reinout.buwalda@gmail.com", "owner.decision.confirm", objectType, objectId, JSON.stringify(payload), decisionTime).run();
  }
  await db.prepare("UPDATE exceptions SET title=?, detail=?, owner='Accountant', updated_at=? WHERE id='EX-005' AND status='open'")
    .bind("Accounting policy accountant countersignature pending", "Reinout approved all ten policy proposals on 2 August 2026. Accountant countersignature is still required before activation for closed reporting and BTW.", decisionTime).run();
  await db.prepare("INSERT OR IGNORE INTO audit_events (id,actor_email,action,object_type,object_id,after_json,occurred_at) VALUES (?,?,?,?,?,?,?)")
    .bind("decision-policy-package-owner-approval-2026-08-02", "reinout.buwalda@gmail.com", "accounting_policy.owner_approve", "accounting_policy_set", "POL-01-POL-10", JSON.stringify({ status: "owner-approved", policies: ["POL-01","POL-02","POL-03","POL-04","POL-05","POL-06","POL-07","POL-08","POL-09","POL-10"], nextGate: "Dutch-accountant countersignature" }), decisionTime).run();
}

export async function getControlRoomState() {
  const db = rawDb();
  if (!db) return benchmark;
  try {
    await ensureSchema(db);
    const result = await db.prepare("SELECT id,title,severity,status,source,detail,owner FROM exceptions ORDER BY id").bind().all<FinanceException>();
    return { ...benchmark, exceptions: result.results?.length ? result.results : benchmark.exceptions };
  } catch { return benchmark; }
}

export async function resolveException(id: string, resolution: string, actorEmail: string) {
  const db = rawDb();
  if (!db) return { ok: false, error: "Persistent database is not available in this environment." };
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM exceptions WHERE id = ?").bind(id).all<Record<string, unknown>>();
  if (!current.results?.length) return { ok: false, error: "Exception not found." };
  const now = new Date().toISOString();
  await db.prepare("UPDATE exceptions SET status='resolved', resolution=?, resolved_by=?, resolved_at=?, updated_at=? WHERE id=?").bind(resolution, actorEmail, now, now, id).run();
  await db.prepare("INSERT INTO audit_events (id,actor_email,action,object_type,object_id,before_json,after_json,occurred_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actorEmail, "exception.resolve", "exception", id, JSON.stringify(current.results[0]), JSON.stringify({ status: "resolved", resolution }), now).run();
  return { ok: true };
}

export async function registerEvidence(input: EvidenceInput, actorEmail: string) {
  const db = rawDb();
  if (!db) return { ok: false, error: "Persistent database is not available in this environment." };
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO source_files (id,file_name,drive_path,object_key,sha256,mime_type,received_at,status) VALUES (?,?,?,?,?,?,?,?)")
    .bind(input.id, input.fileName, input.drivePath, input.objectKey, input.sha256, input.mimeType, now, "received").run();
  await db.prepare("INSERT INTO audit_events (id,actor_email,action,object_type,object_id,after_json,occurred_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actorEmail, "evidence.register", "source_file", input.id, JSON.stringify(input), now).run();
  return { ok: true };
}
