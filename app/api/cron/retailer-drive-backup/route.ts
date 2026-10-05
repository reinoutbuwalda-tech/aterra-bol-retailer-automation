import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { refreshGoogleAccessToken } from "@/lib/google-integration";

export const runtime = "nodejs";
export const maxDuration = 300;

const BACKUP_URL = "https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-drive-backup";

function authorized(value: string) {
  const expectedHash = process.env.RETAILER_DRIVE_CRON_TOKEN_SHA256 || "";
  if (!expectedHash) return false;
  const observed = Buffer.from(createHash("sha256").update(value).digest("hex"));
  const expected = Buffer.from(expectedHash);
  return observed.length === expected.length && timingSafeEqual(observed, expected);
}

export async function POST(request: Request) {
  const cronToken = request.headers.get("x-aterra-cron-token") || "";
  if (!cronToken || !authorized(cronToken)) return NextResponse.json({ status: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "invalid_request" }, { status: 400 });
  }

  try {
    const encryptedRefreshToken = typeof body.encryptedRefreshToken === "string" ? body.encryptedRefreshToken : "";
    if (!encryptedRefreshToken) return NextResponse.json({ status: "invalid_request", reason: "Missing encrypted Google refresh token." }, { status: 400 });
    const workerBody = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== "encryptedRefreshToken"),
    );
    const googleTokens = await refreshGoogleAccessToken(encryptedRefreshToken);
    const response = await fetch(BACKUP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aterra-cron-token": cronToken,
        "x-google-access-token": googleTokens.access_token,
      },
      body: JSON.stringify(workerBody),
      signal: AbortSignal.timeout(290_000),
    });
    const result = await response.json().catch(() => ({ status: "invalid_worker_response" }));
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      status: "failed",
      stage: "google_credential_broker",
      message: error instanceof Error ? error.message : "Credential broker failed.",
    }, { status: 500 });
  }
}
