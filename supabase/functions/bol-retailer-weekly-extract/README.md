# Bol Retailer weekly JSON extract

Cloud-native foundational layer for Aterra's Bol Retailer API data.

## What it does

- Runs from Supabase Cron every Monday 09:00 Europe/Amsterdam.
- Collects the previous Monday-Sunday ISO week.
- Calls only read-only Bol Retailer API endpoints.
- Stores an immutable manifest plus complete dataset JSON artifacts in private Supabase Storage bucket `bol-retailer-api-json`.
- Stores one metadata/log row in `public.bol_retailer_api_extract_runs`.
- Marks a run `partial` when final API errors, pagination caps, rank omissions, or insight-date misalignment remain.
- Recovers stale `running` leases and skips duplicate successful schedule keys.
- Retries incomplete Monday runs at 10:00 Europe/Amsterdam.
- Emits source contract `3.0`, which preserves full business identifiers and country while excluding personal customer data.
- Enqueues a transform run after the source row reaches a terminal state. The extractor itself never writes fact or reporting tables.

## Required secrets

Set these as Supabase Edge Function secrets:

- `BOL_RETAILER_CLIENT_ID`
- `BOL_RETAILER_CLIENT_SECRET`
- `BOL_RETAILER_CRON_TOKEN`

The Cron migration expects a Vault secret named:

- `aterra_bol_retailer_cron_token`

That Vault value must match `BOL_RETAILER_CRON_TOKEN`. It is used only for invoking this Edge Function from `pg_net`.

## Manual test

After deployment, force a one-off run for a known period:

```bash
curl -X POST "https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract" \
  -H "x-aterra-cron-token: $BOL_RETAILER_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual","force":true,"start":"2026-08-31","end":"2026-09-06"}'
```

The period must be exactly one Monday-Sunday week. Add `"rerun":true` only for an intentional repeat of an already completed schedule key.

## Storage layout

Each run writes under `retailer-api/year=<YYYY>/week=<WW>/run=<run-id>/`:

- `manifest.json`
- `commercial.json`
- `catalog.json`
- `insights.json`
- `financial.json`
- `operations.json`
- `provenance.json`

The log row points to `manifest.json` and records dataset status, artifacts, warnings, final API errors, and completeness metadata.

## Downstream transform

Source contract `3.0` runs are queued in `pgmq` for `bol-retailer-transform`. The worker verifies the manifest and every artifact checksum before it writes facts, lineage, quality checks, exceptions, data-product revisions, and weekly report revisions. Publication is atomic and idempotent.

A source run may be `partial` while individual data products are usable. For example, commercial shipment facts can be `ready` when a historical rerun cannot recover all seven visit dates. In that case weekly visits and units-per-visit remain `null/not_ready`; partial daily observations stay available only as evidence.

Do not print or commit any secret values.
