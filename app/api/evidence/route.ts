import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getApiActor } from "@/lib/auth";
import { registerEvidence } from "@/db/runtime";

type Bucket = { put(key: string, value: ArrayBuffer, options?: unknown): Promise<unknown> };

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
  const bucket = (env as unknown as { EVIDENCE?: Bucket }).EVIDENCE;
  if (!bucket) return NextResponse.json({ error: "Evidence storage is unavailable" }, { status: 503 });
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType: file.type }, customMetadata: { sha256: hash, actor: actor.email, drivePath } });
  const result = await registerEvidence({ id, fileName: file.name, drivePath, objectKey, sha256: hash, mimeType: file.type || "application/octet-stream" }, actor.email);
  return NextResponse.json({ ...result, id, sha256: hash }, { status: result.ok ? 201 : 503 });
}
