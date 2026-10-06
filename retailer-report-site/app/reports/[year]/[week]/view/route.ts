import { requireAllowedUser } from "@/lib/auth";
import { REPORT_BUCKET } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ year: string; week: string }> }) {
  await requireAllowedUser();
  const { year, week } = await params;
  const weekNumber = Number(week.replace(/^W/i, ""));
  const { data: run, error } = await getSupabaseAdmin().from("bol_retailer_html_report_runs").select("storage_path").eq("iso_year", Number(year)).eq("iso_week", weekNumber).eq("status", "complete").maybeSingle();
  if (error || !run) return new Response("Rapport niet gevonden.", { status: 404 });
  const { data, error: downloadError } = await getSupabaseAdmin().storage.from(REPORT_BUCKET).download(run.storage_path);
  if (downloadError || !data) return new Response("Rapportbestand niet beschikbaar.", { status: 404 });
  return new Response(await data.text(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" } });
}
