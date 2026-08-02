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
