import { NextRequest, NextResponse } from "next/server";
import { getApiActor } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { registerEvidence } from "@/db/runtime";

export async function POST(request: NextRequest) {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (actor.role === "architect") return NextResponse.json({ error: "Read-only role" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  const drivePath = String(form.get("drivePath") || "Manual upload");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "File exceeds 20 MB" }, { status: 413 });
  const bytes = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const objectKey = `evidence/${new Date().toISOString().slice(0, 10)}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Evidence storage is unavailable" }, { status: 503 });
  const { error: uploadError } = await db.storage.from("financial-evidence").upload(objectKey, bytes, { contentType: file.type || "application/octet-stream", upsert: false, metadata: { sha256: hash, actor: actor.email, drivePath } });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 503 });
  const result = await registerEvidence({ id, fileName: file.name, drivePath, objectKey, sha256: hash, mimeType: file.type || "application/octet-stream" }, actor.email);
  return NextResponse.json({ ...result, id, sha256: hash }, { status: result.ok ? 201 : 503 });
}
