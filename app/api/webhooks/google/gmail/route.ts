import { NextResponse } from "next/server";
import { decodePubSubNotification, enqueueGoogleJob, verifyPubSubPush } from "@/lib/google-integration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await verifyPubSubPush(request);
    const body = await request.json() as { message?: { data?: string; messageId?: string } };
    if (!body.message?.data) return NextResponse.json({ error: "Missing Pub/Sub message" }, { status: 400 });
    const notification = decodePubSubNotification(body.message.data);
    if (notification.emailAddress.toLowerCase() !== (process.env.GOOGLE_FINANCE_ACCOUNT || "aterra.eu@gmail.com").toLowerCase()) return NextResponse.json({ error: "Unexpected mailbox" }, { status: 403 });
    await enqueueGoogleJob(`gmail:history:${notification.historyId}`, "gmail", "gmail_sync", { historyId: notification.historyId, pubsubMessageId: body.message.messageId });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Invalid Gmail notification" }, { status: 401 });
  }
}
