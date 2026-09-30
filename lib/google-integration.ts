import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const expectedAccount = () => (process.env.GOOGLE_FINANCE_ACCOUNT || "aterra.eu@gmail.com").toLowerCase();

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
];

const folderDefaults = {
  gmail: "17uNvRq8OGvteUHvV9lt3gVdU5ZWzF-CJ",
  bol: "19cTVPfFpfQQlCyQW3wXebcBz2vrOIMP9",
  marktmentor: "1G0ff8c9cD83NtkjS8bknAAUdAz3TZ5w8",
  tien: "1Eue8EippCi_MVW3hGtIkE9z3SNxMBz_D",
  import4you: "1ksFFslX1bKaGX7AhzVTCcoNPzS1cp1qs",
  bank: "1af3Id5T1mWCx6LMF5wLPam-1pOIZrfaS",
  manual: "14W6VfyXXuEkLSqbzRbzTxbjko8uCO94s",
} as const;

const folderIds = () => ({
  gmail: process.env.GOOGLE_DRIVE_GMAIL_FOLDER_ID || folderDefaults.gmail,
  bol: process.env.GOOGLE_DRIVE_BOL_FOLDER_ID || folderDefaults.bol,
  marktmentor: process.env.GOOGLE_DRIVE_MARKTMENTOR_FOLDER_ID || folderDefaults.marktmentor,
  tien: process.env.GOOGLE_DRIVE_TIEN_FOLDER_ID || folderDefaults.tien,
  import4you: process.env.GOOGLE_DRIVE_IMPORT4YOU_FOLDER_ID || folderDefaults.import4you,
  bank: process.env.GOOGLE_DRIVE_BANK_FOLDER_ID || folderDefaults.bank,
  manual: process.env.GOOGLE_DRIVE_MANUAL_FOLDER_ID || folderDefaults.manual,
});

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleConnection = {
  id: string;
  account_email: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  status: string;
};

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  historyId?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
};

export type GoogleSyncHealth = {
  status: "connected" | "not_connected" | "configuration_needed";
  accountEmail: string;
  gmailLastSuccess: string | null;
  driveLastSuccess: string | null;
  pendingJobs: number;
  failedJobs: number;
  intakeFolders: number;
  driveUrl: string;
};

function requireEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function encryptionKey() {
  const raw = requireEnvironment("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptToken(value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Unsupported encrypted token format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

function stateSignature(payload: string) {
  return createHmac("sha256", requireEnvironment("GOOGLE_OAUTH_STATE_SECRET")).update(payload).digest("base64url");
}

function createState(actorEmail: string) {
  const payload = Buffer.from(JSON.stringify({ actorEmail, nonce: randomBytes(16).toString("hex"), expiresAt: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${payload}.${stateSignature(payload)}`;
}

function verifyState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("Invalid Google OAuth state.");
  const expected = Buffer.from(stateSignature(payload));
  const observed = Buffer.from(signature);
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) throw new Error("Invalid Google OAuth state signature.");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { actorEmail: string; expiresAt: number };
  if (!decoded.actorEmail || decoded.expiresAt < Date.now()) throw new Error("Google OAuth state expired.");
  return decoded;
}

function callbackUrl(origin: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL || origin}/api/google/callback`;
}

export function getGoogleConfigurationIssues() {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_ENCRYPTION_KEY", "GOOGLE_OAUTH_STATE_SECRET"]
    .filter(name => !process.env[name]);
}

export function buildGoogleAuthorizationUrl(actorEmail: string, origin: string) {
  const params = new URLSearchParams({
    client_id: requireEnvironment("GOOGLE_CLIENT_ID"),
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: expectedAccount(),
    scope: GOOGLE_SCOPES.join(" "),
    state: createState(actorEmail),
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

async function exchangeAuthorizationCode(code: string, origin: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnvironment("GOOGLE_CLIENT_ID"),
      client_secret: requireEnvironment("GOOGLE_CLIENT_SECRET"),
      redirect_uri: callbackUrl(origin),
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}).`);
  return response.json() as Promise<TokenResponse>;
}

async function refreshAccessToken(connection: GoogleConnection) {
  if (!connection.encrypted_refresh_token) throw new Error("Google refresh token is unavailable; reconnect Aterra Gmail.");
  const tokens = await refreshGoogleAccessToken(connection.encrypted_refresh_token);
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const { error } = await db.from("google_connections").update({
    encrypted_access_token: encryptToken(tokens.access_token),
    token_expires_at: expiresAt,
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id);
  if (error) throw error;
  return tokens.access_token;
}

export async function refreshGoogleAccessToken(encryptedRefreshToken: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decryptToken(encryptedRefreshToken),
      client_id: requireEnvironment("GOOGLE_CLIENT_ID"),
      client_secret: requireEnvironment("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status}).`);
  const tokens = await response.json() as TokenResponse;
  return tokens;
}

async function getConnection() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const { data, error } = await db.from("google_connections").select("*").eq("id", "aterra-google").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Aterra Google is not connected.");
  return data as GoogleConnection;
}

async function accessToken() {
  const connection = await getConnection();
  const expiresAt = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  if (expiresAt > Date.now() + 120_000) return decryptToken(connection.encrypted_access_token);
  return refreshAccessToken(connection);
}

async function googleFetch(url: string, init: RequestInit = {}) {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Google API request failed (${response.status}): ${detail}`);
  }
  return response;
}

export async function completeGoogleAuthorization(code: string, state: string, origin: string) {
  const actor = verifyState(state);
  const tokens = await exchangeAuthorizationCode(code, origin);
  const profileResponse = await fetch(`${GMAIL_API}/profile`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (!profileResponse.ok) throw new Error("Could not verify the connected Gmail account.");
  const profile = await profileResponse.json() as { emailAddress: string };
  if (profile.emailAddress.toLowerCase() !== expectedAccount()) throw new Error(`Connect ${expectedAccount()}, not ${profile.emailAddress}.`);

  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const existing = await db.from("google_connections").select("encrypted_refresh_token").eq("id", "aterra-google").maybeSingle();
  if (existing.error) throw existing.error;
  const refreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : existing.data?.encrypted_refresh_token;
  const now = new Date().toISOString();
  const { error } = await db.from("google_connections").upsert({
    id: "aterra-google",
    account_email: profile.emailAddress.toLowerCase(),
    encrypted_access_token: encryptToken(tokens.access_token),
    encrypted_refresh_token: refreshToken,
    token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
    granted_scopes: (tokens.scope || GOOGLE_SCOPES.join(" ")).split(" "),
    status: "connected",
    connected_by: actor.actorEmail,
    last_error: null,
    updated_at: now,
  }, { onConflict: "id" });
  if (error) throw error;
  await Promise.all([
    enqueueGoogleJob("oauth:gmail-initial", "recovery", "gmail_sync", { mode: "initial" }),
    enqueueGoogleJob("oauth:drive-initial", "recovery", "drive_sync", { mode: "initial" }),
    enqueueGoogleJob("oauth:watch-setup", "recovery", "watch_renewal", {}),
  ]);
  return profile.emailAddress;
}

export async function enqueueGoogleJob(idempotencyKey: string, sourceChannel: "gmail" | "drive" | "manual" | "recovery", jobType: "gmail_sync" | "gmail_attachment" | "drive_sync" | "drive_file" | "watch_renewal", payload: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const { error } = await db.from("ingestion_jobs").upsert({
    idempotency_key: idempotencyKey,
    source_channel: sourceChannel,
    job_type: jobType,
    payload,
    status: "pending",
    available_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) throw error;
}

export async function getGoogleSyncHealth(): Promise<GoogleSyncHealth> {
  const db = getSupabaseAdmin();
  const driveUrl = "https://drive.google.com/drive/folders/1FRRQRwyXZKyP5kaBE_4tja-HQU0EHjSS";
  if (!db) return { status: "configuration_needed", accountEmail: expectedAccount(), gmailLastSuccess: null, driveLastSuccess: null, pendingJobs: 0, failedJobs: 0, intakeFolders: 7, driveUrl };
  const [connection, cursors, pending, failed, folders] = await Promise.all([
    db.from("google_connections").select("account_email,status").eq("id", "aterra-google").maybeSingle(),
    db.from("sync_cursors").select("source,last_success_at"),
    db.from("ingestion_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    db.from("ingestion_jobs").select("id", { count: "exact", head: true }).in("status", ["failed", "dead_letter"]),
    db.from("monitored_folders").select("id", { count: "exact", head: true }).eq("active", true).eq("folder_role", "intake"),
  ]);
  const bySource = new Map((cursors.data || []).map(cursor => [cursor.source, cursor.last_success_at]));
  return {
    status: connection.data?.status === "connected" ? "connected" : getGoogleConfigurationIssues().length ? "configuration_needed" : "not_connected",
    accountEmail: connection.data?.account_email || expectedAccount(),
    gmailLastSuccess: bySource.get("gmail") || null,
    driveLastSuccess: bySource.get("drive") || null,
    pendingJobs: pending.count || 0,
    failedJobs: failed.count || 0,
    intakeFolders: folders.count || 7,
    driveUrl,
  };
}

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyPubSubPush(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) throw new Error("Missing Pub/Sub identity token.");
  const audience = requireEnvironment("GOOGLE_PUBSUB_AUDIENCE");
  const result = await jwtVerify(bearer, googleJwks, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience });
  const expectedServiceAccount = requireEnvironment("GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT").toLowerCase();
  if (String(result.payload.email || "").toLowerCase() !== expectedServiceAccount || result.payload.email_verified !== true) throw new Error("Unexpected Pub/Sub service account.");
}

export function verifyDriveWebhook(request: Request) {
  const expected = Buffer.from(requireEnvironment("GOOGLE_DRIVE_WEBHOOK_TOKEN"));
  const observed = Buffer.from(request.headers.get("x-goog-channel-token") || "");
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) throw new Error("Invalid Drive channel token.");
}

function messageHeaders(message: GmailMessage) {
  return Object.fromEntries((message.payload?.headers || []).map(header => [header.name.toLowerCase(), header.value]));
}

function attachmentParts(part?: GmailPart): GmailPart[] {
  if (!part) return [];
  return [...(part.filename && part.body?.attachmentId ? [part] : []), ...(part.parts || []).flatMap(attachmentParts)];
}

function providerFor(sender: string, subject: string, filename: string) {
  const value = `${sender} ${subject} ${filename}`.toLowerCase();
  if (value.includes("tien fulfil") || value.includes("klantmail.snelstart.nl")) return "tien" as const;
  if (value.includes("import 4 you") || value.includes("import4you") || value.includes("i4y")) return "import4you" as const;
  if (value.includes("marktmentor")) return "marktmentor" as const;
  if (value.includes("bol.com") || value.includes("verkoper.bol")) return "bol" as const;
  if (value.includes("knab") || value.includes("afschrift") || value.includes("bank statement")) return "bank" as const;
  return "gmail" as const;
}

function isFinancialAttachment(part: GmailPart, sender: string, subject: string) {
  const filename = part.filename || "";
  const mime = part.mimeType || "";
  const supported = /pdf|xml|csv|spreadsheet|excel|ms-excel|image\/(png|jpeg)/i.test(mime) || /\.(pdf|xml|csv|xlsx?|png|jpe?g)$/i.test(filename);
  if (!supported) return false;
  const knownProvider = providerFor(sender, subject, filename) !== "gmail";
  const financialWords = /invoice|factuur|credit|refund|nota|declaration|aangifte|statement|afschrift|settlement|sales|verkoop/i.test(`${subject} ${filename}`);
  return knownProvider || financialWords;
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function saveCursor(source: "gmail" | "drive", fields: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const { error } = await db.from("sync_cursors").upsert({ source, ...fields, updated_at: new Date().toISOString() }, { onConflict: "source" });
  if (error) throw error;
}

async function queueGmailMessage(messageId: string) {
  const message = await (await googleFetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=full`)).json() as GmailMessage;
  const headers = messageHeaders(message);
  const sender = headers.from || "";
  const subject = headers.subject || "";
  const parts = attachmentParts(message.payload).filter(part => isFinancialAttachment(part, sender, subject));
  await Promise.all(parts.map(part => enqueueGoogleJob(
    `gmail:${message.id}:${part.body?.attachmentId}`,
    "gmail",
    "gmail_attachment",
    { messageId: message.id, attachmentId: part.body?.attachmentId, filename: part.filename, mimeType: part.mimeType, sender, subject, historyId: message.historyId },
  )));
  return { historyId: message.historyId, queued: parts.length };
}

async function fullGmailSync() {
  const query = encodeURIComponent("newer_than:90d has:attachment -in:spam -in:trash");
  let pageToken: string | undefined;
  let latestHistoryId: string | undefined;
  do {
    const url = `${GMAIL_API}/messages?q=${query}&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const page = await (await googleFetch(url)).json() as { messages?: { id: string }[]; nextPageToken?: string };
    for (const item of page.messages || []) {
      const result = await queueGmailMessage(item.id);
      if (result.historyId && (!latestHistoryId || BigInt(result.historyId) > BigInt(latestHistoryId))) latestHistoryId = result.historyId;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  if (latestHistoryId) await saveCursor("gmail", { cursor_value: latestHistoryId, last_success_at: new Date().toISOString(), last_error: null });
}

async function incrementalGmailSync(startHistoryId: string) {
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;
  do {
    const url = `${GMAIL_API}/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const response = await googleFetch(url);
    const page = await response.json() as { history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId?: string; nextPageToken?: string };
    const messageIds = new Set((page.history || []).flatMap(item => item.messagesAdded || []).map(item => item.message.id));
    for (const messageId of messageIds) await queueGmailMessage(messageId);
    if (page.historyId) latestHistoryId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  await saveCursor("gmail", { cursor_value: latestHistoryId, last_success_at: new Date().toISOString(), last_error: null });
}

async function processGmailSync(payload: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  if (payload.mode === "initial") return fullGmailSync();
  const { data } = await db.from("sync_cursors").select("cursor_value").eq("source", "gmail").maybeSingle();
  if (!data?.cursor_value) return fullGmailSync();
  try {
    await incrementalGmailSync(data.cursor_value);
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) return fullGmailSync();
    throw error;
  }
}

async function uploadGmailAttachment(payload: Record<string, unknown>) {
  const messageId = String(payload.messageId);
  const attachmentId = String(payload.attachmentId);
  const filename = String(payload.filename || "attachment").replace(/[\r\n]/g, "_");
  const mimeType = String(payload.mimeType || "application/octet-stream");
  const attachment = await (await googleFetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)).json() as { data: string };
  const bytes = decodeBase64Url(attachment.data);
  const provider = providerFor(String(payload.sender || ""), String(payload.subject || ""), filename);
  const parent = folderIds()[provider];
  const metadata = { name: filename, parents: [parent], appProperties: { gmailMessageId: messageId, gmailAttachmentId: attachmentId, source: "aterra-gmail" } };
  const boundary = `aterra-${randomBytes(12).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await googleFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,version,modifiedTime,webViewLink,parents", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await response.json() as { id: string; version?: string; modifiedTime?: string };
  const folderNames = { gmail: "Gmail Attachments", bol: "Bol", marktmentor: "Marktmentor", tien: "Tien Fulfilment", import4you: "Import 4 You", bank: "Bank Statements" } as const;
  await enqueueGoogleJob(`drive:${file.id}:${file.version || file.modifiedTime || "1"}`, "gmail", "drive_file", { driveFileId: file.id, provider, folderName: folderNames[provider], gmailMessageId: messageId, gmailAttachmentId: attachmentId });
}

async function monitoredFolders() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const { data, error } = await db.from("monitored_folders").select("drive_folder_id,folder_name,provider_id").eq("active", true).eq("folder_role", "intake");
  if (error) throw error;
  return data || [];
}

async function queueDriveFile(file: { id: string; version?: string; modifiedTime?: string; parents?: string[] }) {
  const folders = await monitoredFolders();
  const folder = folders.find(item => (file.parents || []).includes(item.drive_folder_id));
  if (!folder) return false;
  await enqueueGoogleJob(`drive:${file.id}:${file.version || file.modifiedTime || "1"}`, "drive", "drive_file", { driveFileId: file.id, providerId: folder.provider_id, folderName: folder.folder_name });
  return true;
}

async function initialDriveSync() {
  for (const folder of await monitoredFolders()) {
    const query = encodeURIComponent(`'${folder.drive_folder_id}' in parents and trashed = false`);
    const page = await (await googleFetch(`${DRIVE_API}/files?q=${query}&pageSize=1000&fields=files(id,name,mimeType,version,modifiedTime,parents,trashed)`)).json() as { files?: { id: string; version?: string; modifiedTime?: string; parents?: string[] }[] };
    for (const file of page.files || []) await queueDriveFile(file);
  }
  const token = await (await googleFetch(`${DRIVE_API}/changes/startPageToken?supportsAllDrives=true`)).json() as { startPageToken: string };
  await saveCursor("drive", { cursor_value: token.startPageToken, last_success_at: new Date().toISOString(), last_error: null });
}

async function incrementalDriveSync(startPageToken: string) {
  let pageToken: string | undefined = startPageToken;
  let newStartPageToken = startPageToken;
  do {
    const page = await (await googleFetch(`${DRIVE_API}/changes?pageToken=${encodeURIComponent(pageToken)}&pageSize=1000&includeRemoved=true&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,version,modifiedTime,parents,trashed))`)).json() as { nextPageToken?: string; newStartPageToken?: string; changes?: { removed?: boolean; file?: { id: string; version?: string; modifiedTime?: string; parents?: string[]; trashed?: boolean } }[] };
    for (const change of page.changes || []) if (!change.removed && !change.file?.trashed && change.file) await queueDriveFile(change.file);
    if (page.newStartPageToken) newStartPageToken = page.newStartPageToken;
    pageToken = page.nextPageToken;
  } while (pageToken);
  await saveCursor("drive", { cursor_value: newStartPageToken, last_success_at: new Date().toISOString(), last_error: null });
}

async function processDriveSync() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const { data } = await db.from("sync_cursors").select("cursor_value").eq("source", "drive").maybeSingle();
  return data?.cursor_value ? incrementalDriveSync(data.cursor_value) : initialDriveSync();
}

function exportMime(mimeType: string) {
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (mimeType === "application/vnd.google-apps.document") return "application/pdf";
  return null;
}

async function registerDriveFile(payload: Record<string, unknown>) {
  const driveFileId = String(payload.driveFileId);
  const metadata = await (await googleFetch(`${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?fields=id,name,mimeType,version,modifiedTime,createdTime,webViewLink,parents,size,md5Checksum,trashed`)).json() as { id: string; name: string; mimeType: string; version?: string; modifiedTime?: string; createdTime?: string; webViewLink?: string; parents?: string[]; size?: string; trashed?: boolean };
  if (metadata.trashed) return;
  const conversion = exportMime(metadata.mimeType);
  const downloadUrl = conversion
    ? `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}/export?mimeType=${encodeURIComponent(conversion)}`
    : `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?alt=media`;
  const bytes = Buffer.from(await (await googleFetch(downloadUrl)).arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const existing = await db.from("source_files").select("id").eq("sha256", sha256).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const rawProviderId = String(payload.providerId || payload.provider || "") || null;
  const providerId = rawProviderId === "import4you" ? "import-4-you" : rawProviderId === "gmail" ? "gmail-finance" : rawProviderId;
  const sourceId = `drive-${sha256.slice(0, 24)}`;
  const objectKey = `drive/${new Date().toISOString().slice(0, 10)}/${sourceId}-${metadata.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storedMime = conversion || metadata.mimeType;
  const upload = await db.storage.from("financial-evidence").upload(objectKey, bytes, { contentType: storedMime, upsert: false, metadata: { sha256, driveFileId } });
  if (upload.error) throw upload.error;
  const folderName = String(payload.folderName || providerId || "Gmail Attachments");
  const now = new Date().toISOString();
  const source = await db.from("source_files").insert({
    id: sourceId,
    provider_id: providerId,
    file_name: metadata.name,
    drive_path: `06 Finance / 00 Intake / ${folderName} / ${metadata.name}`,
    drive_file_id: metadata.id,
    drive_version: metadata.version || metadata.modifiedTime || null,
    drive_modified_at: metadata.modifiedTime || null,
    drive_web_view_link: metadata.webViewLink || null,
    object_key: objectKey,
    sha256,
    mime_type: storedMime,
    origin_channel: payload.gmailMessageId ? "gmail" : "drive",
    gmail_message_id: payload.gmailMessageId || null,
    gmail_attachment_id: payload.gmailAttachmentId || null,
    original_metadata: metadata,
    received_at: now,
    status: "received",
  });
  if (source.error) throw source.error;
  const adapter = metadata.mimeType.includes("xml") && (providerId === "tien" || providerId === "gmail-finance") ? "ubl-2.1" : "document-router";
  const run = await db.from("ingestion_runs").insert({ id: randomUUID(), source_file_id: sourceId, adapter, adapter_version: "1.0.0", status: "awaiting_validation", started_at: now, completed_at: now });
  if (run.error) throw run.error;
  await db.from("audit_events").insert({ id: randomUUID(), actor_email: expectedAccount(), action: "evidence.auto_register", object_type: "source_file", object_id: sourceId, after_json: { driveFileId, sha256, adapter }, occurred_at: now });
}

async function renewWatches() {
  const topicName = requireEnvironment("GOOGLE_PUBSUB_TOPIC");
  const gmailWatch = await (await googleFetch(`${GMAIL_API}/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" }) })).json() as { historyId: string; expiration: string };
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const gmailExisting = await db.from("sync_cursors").select("cursor_value").eq("source", "gmail").maybeSingle();
  await saveCursor("gmail", { cursor_value: gmailExisting.data?.cursor_value || gmailWatch.historyId, watch_expires_at: new Date(Number(gmailWatch.expiration)).toISOString(), last_success_at: new Date().toISOString(), last_error: null });

  const existing = await db.from("sync_cursors").select("cursor_value").eq("source", "drive").maybeSingle();
  let pageToken = existing.data?.cursor_value;
  if (!pageToken) {
    const token = await (await googleFetch(`${DRIVE_API}/changes/startPageToken?supportsAllDrives=true`)).json() as { startPageToken: string };
    pageToken = token.startPageToken;
  }
  const channelId = randomUUID();
  const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
  const address = `${requireEnvironment("NEXT_PUBLIC_APP_URL")}/api/webhooks/google/drive`;
  const driveWatch = await (await googleFetch(`${DRIVE_API}/changes/watch?pageToken=${encodeURIComponent(pageToken)}&supportsAllDrives=true&includeItemsFromAllDrives=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: channelId, type: "web_hook", address, token: requireEnvironment("GOOGLE_DRIVE_WEBHOOK_TOKEN"), expiration }) })).json() as { resourceId: string; expiration?: string };
  await saveCursor("drive", { cursor_value: pageToken, watch_channel_id: channelId, watch_resource_id: driveWatch.resourceId, watch_expires_at: new Date(Number(driveWatch.expiration || expiration)).toISOString(), last_success_at: new Date().toISOString(), last_error: null });
}

async function handleJob(job: { job_type: string; payload: Record<string, unknown> }) {
  if (job.job_type === "gmail_sync") return processGmailSync(job.payload);
  if (job.job_type === "gmail_attachment") return uploadGmailAttachment(job.payload);
  if (job.job_type === "drive_sync") return processDriveSync();
  if (job.job_type === "drive_file") return registerDriveFile(job.payload);
  if (job.job_type === "watch_renewal") return renewWatches();
  throw new Error(`Unsupported ingestion job: ${job.job_type}`);
}

export async function runGoogleWorker(limit = 20) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured.");
  const { data: jobs, error } = await db.from("ingestion_jobs").select("id,job_type,payload,attempts").eq("status", "pending").lte("available_at", new Date().toISOString()).order("created_at").limit(limit);
  if (error) throw error;
  let completed = 0;
  let failed = 0;
  for (const job of jobs || []) {
    const claimed = await db.from("ingestion_jobs").update({ status: "processing", locked_at: new Date().toISOString(), locked_by: "google-worker", attempts: job.attempts + 1, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "pending").select("id").maybeSingle();
    if (claimed.error || !claimed.data) continue;
    try {
      await handleJob({ job_type: job.job_type, payload: job.payload || {} });
      await db.from("ingestion_jobs").update({ status: "completed", completed_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      completed += 1;
    } catch (jobError) {
      const attempts = job.attempts + 1;
      const message = jobError instanceof Error ? jobError.message.slice(0, 1000) : "Unknown processing error";
      const status = attempts >= 5 ? "dead_letter" : "pending";
      const delayMinutes = Math.min(60, 2 ** attempts);
      await db.from("ingestion_jobs").update({ status, last_error: message, available_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      failed += 1;
    }
  }
  return { inspected: jobs?.length || 0, completed, failed };
}

export function decodePubSubNotification(data: string) {
  return JSON.parse(decodeBase64Url(data).toString("utf8")) as { emailAddress: string; historyId: string };
}
