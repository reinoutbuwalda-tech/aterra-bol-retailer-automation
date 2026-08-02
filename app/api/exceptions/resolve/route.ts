import { NextRequest, NextResponse } from "next/server";
import { getApiActor } from "@/lib/auth";
import { resolveException } from "@/db/runtime";

export async function POST(request: NextRequest) {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (actor.role === "architect") return NextResponse.json({ error: "Read-only role" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json() as { id?: string; resolution?: string };
  if (!body.id || !body.resolution?.trim()) return NextResponse.json({ error: "ID and resolution are required" }, { status: 400 });
  const result = await resolveException(body.id, body.resolution.trim(), actor.email);
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
