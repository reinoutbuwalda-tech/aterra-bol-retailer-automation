import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/auth";
import { signWeeklyReview } from "@/db/runtime";

export const runtime = "nodejs";

export async function POST() {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await signWeeklyReview(actor.email);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
