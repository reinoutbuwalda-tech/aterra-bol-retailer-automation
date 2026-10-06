import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { REPORT_BUCKET, requireEnvironment } from "@/lib/config";
import { renderReport, type ReportPayload } from "@/lib/report";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(token: string) {
  const expectedHash = requireEnvironment("REPORT_GENERATION_TOKEN_SHA256");
  const observed = Buffer.from(createHash("sha256").update(token).digest("hex"));
  const expected = Buffer.from(expectedHash);
  return observed.length === expected.length && timingSafeEqual(observed, expected);
}

export async function POST(request: Request) {
  const token = request.headers.get("x-aterra-report-token") || "";
  if (!token || !authorized(token)) return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data: job, error: claimError } = await supabase.rpc("claim_bol_retailer_html_report_job");
  if (claimError) return NextResponse.json({ status: "claim_failed" }, { status: 503 });
  if (!job) return NextResponse.json({ status: "idle" });
  const run = Array.isArray(job) ? job[0] : job;
  const runId = String(run.id);
  try {
    const { data: payload, error: payloadError } = await supabase.rpc("get_bol_retailer_html_report_payload", { p_revision_id: run.weekly_report_revision_id });
    if (payloadError || !payload) throw new Error(`Report payload unavailable: ${payloadError?.message || "empty"}`);
    const report = payload as ReportPayload;
    const revision = report.revision;
    const status = String(revision.status);
    if (status === "not_ready") throw new Error("Report revision is not ready for publication.");
    const year = Number(revision.iso_year);
    const week = Number(revision.iso_week);
    const html = renderReport(report);
    const storagePath = `year=${year}/week=${String(week).padStart(2, "0")}/revision=${revision.id}/report.html`;
    const upload = await supabase.storage.from(REPORT_BUCKET).upload(storagePath, html, { contentType: "text/html; charset=utf-8", upsert: true });
    if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);
    const reportUrl = `${requireEnvironment("NEXT_PUBLIC_APP_URL")}/reports/${year}/W${String(week).padStart(2, "0")}`;
    const { data: connection, error: connectionError } = await supabase.from("google_connections").select("encrypted_refresh_token").eq("id", "aterra-google").single();
    if (connectionError || !connection?.encrypted_refresh_token) throw new Error("Aterra Gmail connection is unavailable.");
    const emailResponse = await fetch("https://aterra-retailer-drive-broker.vercel.app/api/cron/retailer-drive-backup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-aterra-cron-token": token },
      body: JSON.stringify({ action: "report_email", year, week, url: reportUrl, summary: report.summary, reportStatus: status, encryptedRefreshToken: connection.encrypted_refresh_token }),
      signal: AbortSignal.timeout(60_000),
    });
    const email = await emailResponse.json().catch(() => ({})) as { id?: string; message?: string };
    if (!emailResponse.ok || !email.id) throw new Error(`Report email failed (${emailResponse.status}): ${email.message || "unknown error"}`);
    const { error: finishError } = await supabase.from("bol_retailer_html_report_runs").update({ status: "complete", report_status: status, storage_path: storagePath, hosted_url: reportUrl, email_message_id: email.id, completed_at: new Date().toISOString(), error_stage: null, error_detail: null }).eq("id", runId);
    if (finishError) throw new Error(`Run finalization failed: ${finishError.message}`);
    return NextResponse.json({ status: "complete", year, week, reportUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed.";
    await supabase.rpc("fail_bol_retailer_html_report_job", { p_run_id: runId, p_error_detail: message });
    return NextResponse.json({ status: "failed", message }, { status: 500 });
  }
}
