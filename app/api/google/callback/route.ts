import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/auth";
import { completeGoogleAuthorization } from "@/lib/google-integration";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await getApiActor();
  if (!actor || actor.role !== "owner") return NextResponse.redirect(new URL("/unauthorized", request.url));
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || url.searchParams.has("error")) return NextResponse.redirect(new URL("/?google=cancelled", request.url));
  try {
    await completeGoogleAuthorization(code, state, url.origin);
    return NextResponse.redirect(new URL("/?google=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/?google=failed", request.url));
  }
}
