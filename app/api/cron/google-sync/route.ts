import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { enqueueGoogleJob, runGoogleWorker } from "@/lib/google-integration";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !value) return false;
  const expected = Buffer.from(secret);
  const observed = Buffer.from(value);
  return expected.length === observed.length && timingSafeEqual(expected, observed);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const day = new Date().toISOString().slice(0, 10);
  await enqueueGoogleJob(`recovery:gmail:${day}`, "recovery", "gmail_sync", {});
  await enqueueGoogleJob(`recovery:drive:${day}`, "recovery", "drive_sync", {});
  await enqueueGoogleJob(`renew-watches:${day}`, "recovery", "watch_renewal", {});
  return NextResponse.json(await runGoogleWorker(50));
}
