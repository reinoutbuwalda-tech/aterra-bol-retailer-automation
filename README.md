# Aterra Financial Control Room

Private financial operations application for Treso ONO / Aterra.

## Runtime

- Next.js on Vercel
- Clerk invitation-only authentication
- Supabase PostgreSQL and private evidence storage
- Server-enforced roles for owners, architects and accountants
- Direct OAuth connection to `aterra.eu@gmail.com`
- Event-driven Gmail and Drive intake with a daily recovery run

## Authorized users

- Reinout — owner
- Thijs — owner
- Hidde — read-only architect

Access is enforced by both Clerk authentication and the server-side email-to-role allowlist in `lib/auth.ts`.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the Clerk and Supabase environment values.
3. Run `npm install`.
4. Run `npm run dev`.

Database schema changes are stored in `supabase/migrations` and must pass Supabase security and performance advisors before production use.

## Retailer data foundation

- [Architecture and traceability](docs/bol-retailer-data-foundation.md)
- [Cloud operations runbook](docs/bol-retailer-cloud-operations.md)
- [Roadmap and remaining build plan](docs/bol-retailer-data-foundation-roadmap.md)

## Automatic finance intake

The connection is deliberately Drive-first: Gmail attachments are classified and copied into `06 Finance / 00 Intake`; Drive file IDs, versions, source links and SHA-256 fingerprints are then registered in Supabase. New evidence remains `awaiting_validation` and cannot change P&L, cash flow, balance or BTW until deterministic checks and any required human approval succeed.

The production flow has three safeguards:

1. Gmail Pub/Sub and Drive change notifications enqueue small, idempotent jobs.
2. The worker retries failures with backoff and quarantines a job after five attempts.
3. A daily Vercel recovery run renews expiring watches and catches missed notifications.

The Google Cloud setup must use the Aterra-controlled OAuth client, Pub/Sub topic and push service account. Only an owner can start OAuth, and the callback rejects every mailbox except `aterra.eu@gmail.com`. Tokens are encrypted with AES-256-GCM before database storage.

Required values are documented in `.env.example`. After deployment, open **Controls → Connect Aterra Gmail** while signed in as an owner. The Controls page reports the last successful Gmail and Drive sync, queue depth, failures and the canonical Drive intake link.
