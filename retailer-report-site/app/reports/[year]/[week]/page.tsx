import { requireAllowedUser } from "@/lib/auth";

export default async function ReportPage({ params }: { params: Promise<{ year: string; week: string }> }) {
  await requireAllowedUser();
  const { year, week } = await params;
  return <iframe title={`Aterra Retailer ${year}-${week}`} src={`/reports/${year}/${week}/view`} style={{ width: "100%", height: "100vh", border: 0, display: "block" }} />;
}
