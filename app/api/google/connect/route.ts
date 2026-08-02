import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/auth";
import { buildGoogleAuthorizationUrl, getGoogleConfigurationIssues } from "@/lib/google-integration";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (actor.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const issues = getGoogleConfigurationIssues();
  if (issues.length) return NextResponse.json({ error: `Google connection is not configured: ${issues.join(", ")}` }, { status: 503 });
  return NextResponse.redirect(buildGoogleAuthorizationUrl(actor.email, new URL(request.url).origin));
}
