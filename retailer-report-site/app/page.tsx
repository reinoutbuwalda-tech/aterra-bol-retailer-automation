import Link from "next/link";
import { requireAllowedUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { email } = await requireAllowedUser();
  const { data, error } = await getSupabaseAdmin().from("bol_retailer_html_report_runs").select("iso_year,iso_week,report_status,storage_path,completed_at").eq("status", "complete").order("iso_year", { ascending: false }).order("iso_week", { ascending: false });
  if (error) throw error;
  return <><header className="nav"><strong>Aterra Retailer Reports</strong><span>{email}</span></header><main className="page"><h1>Weekrapporten</h1><p className="lead">Gecontroleerde Bol Retailer-rapporten uit de Supabase reporting-laag.</p><section className="reports">{data?.length ? data.map(report => <Link className="row" key={`${report.iso_year}-${report.iso_week}`} href={`/reports/${report.iso_year}/W${String(report.iso_week).padStart(2, "0")}`}><div><div className="week">{report.iso_year}-W{String(report.iso_week).padStart(2, "0")}</div><div className="muted">Gegenereerd {new Date(report.completed_at).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}</div></div><span className="badge">{report.report_status === "ready" ? "Gereed" : "Met beperkingen"}</span><span className="button">Open</span></Link>) : <div className="empty">Er zijn nog geen cloudrapporten gepubliceerd.</div>}</section></main></>;
}
