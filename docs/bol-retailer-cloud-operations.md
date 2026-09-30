# Retailer cloud extraction operations

Updated: 2026-09-29.

## Scheduled run

The production workflow runs every Monday in three stages:

1. 09:00 Europe/Amsterdam: collect the previous completed Monday-Sunday week into
   private Supabase Storage and write the authoritative manifest last.
2. 09:10 Europe/Amsterdam: a narrowly authenticated Vercel credential broker obtains
   a short-lived Google token and dispatches the Supabase backup worker. The worker
   verifies the complete source run and all seven checksums, copies the exact sanitized
   JSON artifacts to Google Drive, and generates a native human-readable Google Sheet.
3. A database trigger queues source contract `3.0` runs for the Supabase transform
   worker. The worker runs every five minutes, independently verifies the manifest and
   all artifact hashes, and atomically publishes facts, lineage, checks, exceptions,
   data-product revisions, and weekly reporting revisions.

Both stages retry once one hour later. Paired UTC summer/winter jobs use a local
Amsterdam weekday/hour guard, so only the correct daylight-saving job performs work.
The retry is idempotent: completed source and Drive runs are not duplicated.

Operational state on 29 September: extraction, Drive, and transform jobs are active. The broker
has the stable alias `aterra-retailer-drive-broker.vercel.app`; it is an immutable
preview deployment and does not change the production financial application.

Drive layout: `02 Retailer/<year>/W<week>/source-json` and `report`.

## Success criteria

1. Cron history confirms the dispatch command succeeded.
2. The extract run log has a terminal status, rather than `running`.
3. The manifest and six dataset files exist in private `bol-retailer-api-json` storage.
4. Every uploaded file has passed download-and-SHA256 verification.
5. `complete` requires no final API errors, no pagination warnings, aligned visits,
   and enabled weekly rank collection. `partial` remains usable evidence with gaps.
6. The Drive backup log is `complete`, records seven artifacts, and confirms checksums.
7. The Drive week folder contains seven JSON files and one automated review Sheet.
8. The transform run is `published`, no queue message remains, and each reporting
   data product has its own `ready`, `ready_with_limits`, `not_ready`, or
   `not_applicable` state.

```sql
select status, started_at, completed_at, duration_ms, artifact_count,
       api_call_count, api_error_count, storage_path, completeness, dataset_status
from public.bol_retailer_api_extract_runs
where schedule_key = 'weekly-primary-2026-09-21'
order by started_at desc;
```

Do not infer success from HTTP 200 alone: partial results also return HTTP 200.
Never print cron request headers or Vault values when investigating delivery.

```sql
select status, iso_year, iso_week, artifact_count, checksums_verified,
       total_bytes, error_stage, error_detail, google_sheet_url,
       drive_week_folder_url, started_at, completed_at
from public.bol_retailer_drive_backup_runs
order by started_at desc
limit 10;
```

## Google credential boundary

The OAuth client values and token-encryption key remain Vercel sensitive variables.
The broker authenticates the existing Vault cron token against the Vercel-sensitive
`RETAILER_DRIVE_CRON_TOKEN_SHA256` value, receives
the encrypted refresh token from Supabase, and sends only a short-lived access token to
the backup worker. It never returns or logs either token. If the Vault cron token is
rotated, update the Vercel fingerprint variable and redeploy before the next Monday run.

The Google project currently has Drive API enabled and Sheets API disabled. The worker
therefore creates an XLSX workbook in memory and uploads it through Drive with the native
Google Sheets MIME type. Drive performs the conversion without requiring the Sheets API.
The workbook follows the approved manual-review template: nine tabs, Dutch currency and
percentage formats, overview guidance, data-quality notes, filters, fixed widths, hidden
gridlines, and frozen table headers. Operational and financial source groups remain in
the JSON backup rather than appearing as extra review tabs.

## Reliability controls

- A partial unique index prevents two active extractions for the same ISO week.
- Run-log recovery and lookup errors stop collection rather than silently bypassing protection.
- OAuth requests have a timeout; API requests retain bounded retries for transient errors.
- Rank pagination caps and repeated offer cursors are surfaced as incomplete data.
- Visits require seven distinct reporting dates. Empty visits cannot pass completeness.
- Dataset status reflects missing dates and pagination warnings.
- Malformed JSON and incomplete date pairs are rejected before creating a run.
- Sensitive scalar fields are redacted as well as nested customer details.
- The Drive function independently rejects unredacted sensitive keys before upload.
- Existing Drive JSON files must match both byte size and source SHA-256 metadata.
- Files remain immutable per run. A manifest is written after all six data files verify.
- Only source contract `3.0` is transformed. Full business IDs remain exact; customer
  and other personal fields are excluded before storage.
- Gross weekly sales use outbound shipment items, not all order items.
- Returns change provisional value only after an exact order-ID and EAN match.
- Weekly visits publish only when every offer has all seven reporting dates. Partial
  daily visit observations remain queryable but are not exposed as a weekly total.
- `operations.json` and the manifest remain evidence rather than business fact tables.
- A lower-readiness rerun remains an inactive revision and cannot replace a better
  active weekly report. A provisional automated revision cannot replace an accounting-
  approved report.
- Transient transform failures retry with bounded backoff and become
  `RETRY_EXHAUSTED` after five failed attempts.

## Structured foundation

The private `bol_retailer` schema contains normalized source facts. The private
`pipeline` schema contains runs, source evidence, row sightings, quality checks,
exceptions, and the durable queue. The private `reporting` schema contains immutable
data-product and weekly-report revisions plus current-state views.

EAN is the first product join key. Current mappings include the three Aterra products
and Besrey DIY fort EAN `6970452112658`; the sports bag is the confirmed 54 L product.
Reporting remains provisional until accounting settlement is reconciled.

The W36-W39 contract `3.0` backfill published on 29 September. Commercial controls
reconciled exactly for W36 (32 units, EUR 1,003.68 gross, EUR 177.50 commission), W38
(18 units, EUR 614.82 gross, EUR 108.05 commission), and W39 (23 units, EUR 769.77
gross, EUR 134.13 commission). Checksum-verified, date-aligned pre-3.0 insight artifacts
restore complete weekly visits for W37 (290), W38 (268), and W39 (338) through separate
data-product revisions. Their redacted offer IDs are restored only by exact EAN match to
the full contract 3.0 catalog facts. W36 remains `not_ready` for traffic because its old
artifact contains W37 dates; it is rejected rather than relabeled. Partial visit totals
are never replaced with zero or published as a complete weekly metric.

Every active mapped offer receives a weekly product row, including products with zero
shipments, returns, or visits. This prevents a zero-sales product from disappearing from
traffic totals or trend analysis.

## Verification

`node --test tests/retailer-cloud-extract.test.mjs` runs the collector regression cases.
The 19 September cloud validation made 221 API calls with zero final API errors,
wrote seven verified files in 48,519 ms, and returned HTTP 200 without timeout.
Its W37 result correctly remained partial because rolling visits no longer covered W37.
The final version 16 validation on 20 September repeated all 221 API calls with
zero final API errors, seven verified artifacts, and a duration of 39,988 ms.
Only the insights group was partial; other collected groups had no unexpected errors.
Four expected-unavailable catalog calls were recorded separately. Deployed source
was checked against local source. The cron date guard and self-disable command
were exercised inside a rolled-back transaction without dispatching an extraction.

The final 28 September W39 source backup copied seven checksum-verified JSON files
totalling 4,271,819 bytes. The polished report rebuild completed in 9,040 ms and created
a nine-tab native Google Sheet matching the approved manual-review structure.
The log records `complete`, zero final errors, and the Drive/Sheet URLs. A second request
returned `already_complete`, proving idempotent replay behavior.

## Remaining limitations

- The collector still runs in one Edge Function invocation. Growing volume or long
  rate-limit delays can exceed platform duration limits; resumable collection is not implemented.
- Stale runs are recovered on the next invocation after 20 minutes. There is no separate watchdog.
- The broker is intentionally a small cloud dependency because Vercel sensitive values
  cannot be exported to Supabase. Its stable alias must continue pointing at the tested
  immutable deployment.
- Offer insights expose a rolling window; retrying an old week cannot reconstruct missing traffic.
- Source contracts before `3.0` used lossy identifier redaction. Contract `3.0`
  preserves business identifiers for accounting joins while continuing to remove
  personal data.
- Stored artifacts from older runs are not rewritten by these improvements.
- Historical data and current-state snapshots remain distinct in their JSON groups.
- A pre-3.0 insights artifact may be promoted only when its stored hash and byte count
  match the manifest and every EAN has seven distinct dates equal to the target week.

Keep the Advertising workflow separate. Its future facts can use the same pipeline and
revision principles, but it must retain separate source contracts and schemas.
