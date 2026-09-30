# Operational Runbook

Use this runbook for scheduled or manually triggered Aterra Bol Retailer weekly report runs.

## Cloud Foundation

The approved cloud workflow has separate source and review stages:

- Supabase Cron invokes `bol-retailer-weekly-extract` Monday at 09:00 Europe/Amsterdam.
- A DST-matched 10:00 retry runs only when the prior run is absent, failed, or has transient API failures.
- The function stores immutable JSON under `bol-retailer-api-json/retailer-api/year=<YYYY>/week=<WW>/run=<run-id>/`.
- `manifest.json` is authoritative. Its sibling files are `commercial.json`, `catalog.json`, `insights.json`, `financial.json`, `operations.json`, and `provenance.json`.
- `public.bol_retailer_api_extract_runs` is operational metadata only. Trust `complete`; inspect `partial`; never consume `running`, `failed`, or `skipped` as a complete source.
- At 09:10 Europe/Amsterdam, the Drive backup stage verifies the complete source run and all checksums, copies seven sanitized JSON artifacts to `02 Retailer/<year>/W<week>/source-json`, and creates the canonical native Google Sheet under `report`.
- A 10:10 retry is idempotent and runs only when needed. Trust `public.bol_retailer_drive_backup_runs.status = 'complete'`; a successful dispatch alone is insufficient.
- The Sheet must use the canonical polished nine-tab `data review` structure. The earlier simplified `automated data review` workbook is deprecated.

The cloud collector must preserve complete paginated rows, final-call status, pagination-cap warnings, source dates, checksums, and per-dataset status. A successful HTTP invocation is not proof of a trustworthy dataset; use the run status and manifest.

If a run remains `running` beyond its lease, the next invocation closes it as failed before retrying. Do not manually delete run rows or artifact objects during ordinary recovery.

Dashboard loading, email delivery, and Advertising API operations remain separate workflows.

## Normal Monday Run

1. Determine the previous completed ISO week, Monday through Sunday, in Europe/Amsterdam.
2. Confirm `BOL_RETAILER_CLIENT_ID` and `BOL_RETAILER_CLIENT_SECRET` are available in the managed runtime without printing values.
3. For cloud operation, inspect the latest Supabase run manifest. For local/manual operation, fetch Retailer API data with read-only requests only, preferably using `scripts/collect-weekly-snapshot.mjs`.
4. For the scheduled cloud run, verify the Drive backup log, seven JSON files, and canonical nine-tab Sheet. For a local run, save a sanitized weekly snapshot under `/Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app/docs` using the snapshot contract.
5. For local HTML output, render the report with `scripts/generate-weekly-report.mjs`.
6. Review the JSON result from stdout:
   - `status: generated` means output files are ready.
   - `status: blocked` means the report was not generated because a hard gate failed.
   - `status: error` means the runner itself failed before completing validation.
7. Report the output paths and caveats to Reinout.

## Collector Command

```bash
node /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/collect-weekly-snapshot.mjs \
  --start <YYYY-MM-DD> \
  --end <YYYY-MM-DD> \
  --out-dir /Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app/docs
```

The collector is read-only. It records sanitized call provenance, follows page and cursor pagination with safety caps, captures successful empty rank calls, and redacts customer/order/shipment identifiers before writing the snapshot. It does not write to Supabase, dashboard code, cron, email, Bol write endpoints, or Advertising workflows.

Use `--rank-mode none` only for a commercial snapshot that will later receive a separate rank payload. Normal weekly reports should keep rank collection enabled.

## Renderer Command

```bash
node /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/generate-weekly-report.mjs \
  --snapshot <sanitized-weekly-snapshot.json> \
  --out-dir /Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app/docs \
  --report-slug bol-retailer-<YYYY-Www>-weekly-report
```

Use `--dry-run` to validate without writing files.

Use `--allow-partial-rank` only for a deliberately labelled partial/test report. The normal weekly operational report should have seven rank dates.

## Outputs

The renderer writes files atomically:

- `<slug>.html`: visual report for review/sharing.
- `<slug>.md`: concise text report for quick inspection.
- `<slug>.json`: structured report data.
- `<slug>.run.json`: operational manifest with input hashes, output paths, quality status, and counts.

If a run is interrupted, a hidden lock file named `.<slug>.lock` may remain in the output directory. Only remove it after confirming no matching report render is currently running.

## Exit Codes

- `0`: generated or dry-run validated.
- `1`: runner error such as invalid JSON, unreadable files, bad arguments, lock conflict, or privacy scan failure.
- `2`: data-quality hard failure. The report is blocked by design.

## Blocked Run Triage

Missing credentials:
State that managed credentials are unavailable. Do not ask the user to paste credentials into chat. Recommend fixing the local/Vercel managed environment.

Collector limitation:
Offer insights are collected as the latest seven daily periods because the endpoint accepts period and count rather than an explicit historical week date. Monday morning collection is therefore the intended operational timing for the previous completed week.

Partial rank coverage:
If fewer than seven rank dates are present, run is blocked unless the user explicitly approves a partial report. A partial report must visibly label rank coverage.

Missing commercial data:
Check whether the snapshot includes a product universe, `operational.byEan`, shipment-derived order details, returns, and offer insights. A product can be valid for the week even when it is no longer present in current offers.

Provenance mismatch:
If `summary.apiCalls` or `summary.apiErrors` disagrees with the top-level `apiCalls` array, treat the snapshot as auditable with caveats only. Prefer regenerating the snapshot before sending a final weekly report.

Unlinked returns:
When return items cannot be matched to a single order line, the report keeps the return units visible but excludes return value and commission adjustment for those units. Review the return manually in Bol before using the net revenue figure for decisions.

Secret/privacy failure:
Do not send or share outputs. Inspect the generated content locally, remove unsafe fields at the source, and regenerate.

## Operational Boundaries

The weekly report workflow is read-only for Bol and artifact-only locally. It must not create dashboard features, Supabase tables, production ingestion, schedules, email automation, or Advertising API changes unless Reinout separately approves that scope.

## Weekly Summary Format

When the run completes, summarize:

- Report week.
- HTML path.
- Product count.
- Net GMS, units, product visits, and unresolved returns when available.
- Rank coverage, e.g. `7/7 dates` or blocked/partial.
- Rank EAN-date-locale coverage and whether empty successful calls were captured.
- Main warnings.
- Whether conversion was unavailable or verified.
