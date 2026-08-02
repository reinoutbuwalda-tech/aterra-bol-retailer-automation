import { NextResponse } from "next/server";
import { enqueueGoogleJob, verifyDriveWebhook } from "@/lib/google-integration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    verifyDriveWebhook(request);
    const channelId = request.headers.get("x-goog-channel-id") || "unknown";
    const messageNumber = request.headers.get("x-goog-message-number") || crypto.randomUUID();
    await enqueueGoogleJob(`drive:notification:${channelId}:${messageNumber}`, "drive", "drive_sync", { channelId, messageNumber, resourceState: request.headers.get("x-goog-resource-state") });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Invalid Drive notification" }, { status: 401 });
  }
}
