import { benchmark, type FinanceException } from "@/lib/benchmark";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getGoogleSyncHealth } from "@/lib/google-integration";

type EvidenceInput = { id: string; fileName: string; drivePath: string; objectKey: string; sha256: string; mimeType: string };

const decisionTime = "2026-08-02T00:00:00.000Z";

async function seedGovernanceState() {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const exceptions = benchmark.exceptions.map(item => ({
    id: item.id, title: item.title, severity: item.severity, status: item.status,
    source: item.source, detail: item.detail, owner: item.owner,
  }));
  const { error: exceptionError } = await db.from("exceptions").upsert(exceptions, { onConflict: "id", ignoreDuplicates: true });
  if (exceptionError) throw exceptionError;

  const decisions = [
    { id: "decision-vat-id-2026-08-02", actor_email: "reinout.buwalda@gmail.com", action: "entity.vat_id.confirm", object_type: "legal_entity", object_id: "treso-ono", after_json: { vatId: "NL868817375B01", status: "owner-confirmed", incorrectObservedValue: "NL005313044B88" }, occurred_at: decisionTime },
    { id: "decision-revenue-policy-2026-08-02", actor_email: "reinout.buwalda@gmail.com", action: "owner.decision.confirm", object_type: "accounting_policy", object_id: "POL-02", after_json: { event: "bol_order_date", cancellation: "bol_confirmation_date", refund: "bol_confirmation_date", creditNote: "bol_confirmation_date" }, occurred_at: decisionTime },
    { id: "decision-inventory-opening-2026-08-02", actor_email: "reinout.buwalda@gmail.com", action: "owner.decision.confirm", object_type: "inventory", object_id: "opening-balance", after_json: { carafeFruit: 100, carafeRvs: 100, sportsBag: 200, currentSportsBag: 195, warehouse: "Tien Fulfilment" }, occurred_at: decisionTime },
    { id: "decision-fulfilment-provider-2026-08-02", actor_email: "reinout.buwalda@gmail.com", action: "owner.decision.confirm", object_type: "source_provider", object_id: "tien-fulfilment", after_json: { current: true, historicalProvider: "Max Fulfilment", cutover: "derive from first Tien event" }, occurred_at: decisionTime },
    { id: "decision-policy-package-owner-approval-2026-08-02", actor_email: "reinout.buwalda@gmail.com", action: "accounting_policy.owner_approve", object_type: "accounting_policy_set", object_id: "POL-01-POL-10", after_json: { status: "owner-approved", policies: ["POL-01","POL-02","POL-03","POL-04","POL-05","POL-06","POL-07","POL-08","POL-09","POL-10"], nextGate: "Dutch-accountant countersignature" }, occurred_at: decisionTime },
  ];
  const { error: auditError } = await db.from("audit_events").upsert(decisions, { onConflict: "id", ignoreDuplicates: true });
  if (auditError) throw auditError;
  return db;
}

export async function getControlRoomState() {
  const googleSync = await getGoogleSyncHealth().catch(() => ({
    status: "configuration_needed" as const,
    accountEmail: "aterra.eu@gmail.com",
    gmailLastSuccess: null,
    driveLastSuccess: null,
    pendingJobs: 0,
    failedJobs: 0,
    intakeFolders: 7,
    driveUrl: "https://drive.google.com/drive/folders/1FRRQRwyXZKyP5kaBE_4tja-HQU0EHjSS",
  }));
  try {
    const db = await seedGovernanceState();
    if (!db) return { ...benchmark, googleSync };
    const { data, error } = await db.from("exceptions").select("id,title,severity,status,source,detail,owner").order("id");
    if (error) throw error;
    return { ...benchmark, exceptions: data?.length ? data as FinanceException[] : benchmark.exceptions, googleSync };
  } catch {
    return { ...benchmark, googleSync };
  }
}

export async function resolveException(id: string, resolution: string, actorEmail: string) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Persistent database is not available in this environment." };
  const { data: current, error: readError } = await db.from("exceptions").select("*").eq("id", id).maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!current) return { ok: false, error: "Exception not found." };
  const now = new Date().toISOString();
  const { error: updateError } = await db.from("exceptions").update({ status: "resolved", resolution, resolved_by: actorEmail, resolved_at: now, updated_at: now }).eq("id", id);
  if (updateError) return { ok: false, error: updateError.message };
  const { error: auditError } = await db.from("audit_events").insert({ id: crypto.randomUUID(), actor_email: actorEmail, action: "exception.resolve", object_type: "exception", object_id: id, before_json: current, after_json: { status: "resolved", resolution }, occurred_at: now });
  return auditError ? { ok: false, error: auditError.message } : { ok: true };
}

export async function registerEvidence(input: EvidenceInput, actorEmail: string) {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Persistent database is not available in this environment." };
  const now = new Date().toISOString();
  const { error: sourceError } = await db.from("source_files").insert({ id: input.id, file_name: input.fileName, drive_path: input.drivePath, object_key: input.objectKey, sha256: input.sha256, mime_type: input.mimeType, received_at: now, status: "received" });
  if (sourceError) return { ok: false, error: sourceError.message };
  const { error: auditError } = await db.from("audit_events").insert({ id: crypto.randomUUID(), actor_email: actorEmail, action: "evidence.register", object_type: "source_file", object_id: input.id, after_json: input, occurred_at: now });
  return auditError ? { ok: false, error: auditError.message } : { ok: true };
}
