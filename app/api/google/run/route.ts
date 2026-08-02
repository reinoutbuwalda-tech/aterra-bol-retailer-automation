import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/auth";
import { enqueueGoogleJob, runGoogleWorker } from "@/lib/google-integration";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (actor.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const key = new Date().toISOString();
  await enqueueGoogleJob(`manual:gmail:${key}`, "manual", "gmail_sync", {});
  await enqueueGoogleJob(`manual:drive:${key}`, "manual", "drive_sync", {});
  return NextResponse.json(await runGoogleWorker(20));
}
