---
name: bol-retailer-weekly-report
description: Create Aterra's weekly Bol Retailer trading report from verified Retailer API data, including product economics, visits, returns, and keyword rank visibility. Use for weekly Bol report generation or refinement, not for Advertising API workflows.
---

# Bol Retailer Weekly Report

Use this skill when Reinout asks to create, refresh, explain, diagnose, or improve the Aterra weekly Bol.com Retailer API report. The target report is the W36-style visual HTML trading report with per-product metrics and keyword visibility.

## Scope

This skill is for Retailer API reporting only. Keep it separate from the existing Bol Advertising API workflow unless the user explicitly asks to combine the two later.

The report should help Aterra decide what to do per product each week:

- Net shipped GMS
- Units sold
- ASP
- Conversion rate as weekly trading conversion when product visits exist
- Product visits / glance views
- Revenue after commission
- Returns
- Sponsored rank
- Organic rank
- Keyword-level rank observations

For the exact output shape, read [references/weekly-report-spec.md](references/weekly-report-spec.md). For data validation rules, read [references/data-quality-gates.md](references/data-quality-gates.md). For the sanitized input shape, read [references/snapshot-contract.md](references/snapshot-contract.md). For product keyword/watchlist defaults, use [references/product-keywords.json](references/product-keywords.json). For scheduled or manually triggered operations, read [references/operational-runbook.md](references/operational-runbook.md).

The approved Monday cloud workflow stores the authoritative Supabase source artifacts and then creates a Google Drive backup plus a native Google Sheet. Treat `manifest.json` and both run logs as authoritative; do not infer completeness from Cron or HTTP success alone.

## Canonical Monday Workbook

The polished nine-tab Google Sheet named `Aterra Bol Retailer <YYYY-Www> data review` is the mandatory Monday workbook structure. The approved reference is the W39 canonical workbook created on 2026-09-28. Do not substitute the earlier simplified `automated data review` layout or add/remove tabs without Reinout's approval.

Tabs, in order: `Overview`, `Products`, `Weekly ranks`, `Daily ranks`, `Shipments`, `Returns`, `Offers`, `API quality`, `Source index`.

Preserve the approved human-review conventions: Dutch currency and percentage presentation, Europe/Amsterdam context, styled report headings, overview instructions and quality panel, hidden gridlines, filters, stable column widths, frozen table headers/identifier columns, conversion-status and reviewer-note columns. Keep Operations and Financial payloads in the seven JSON backups; do not add them as workbook tabs.

## Preferred Workflow

Use `scripts/collect-weekly-snapshot.mjs` to create a sanitized weekly Retailer API snapshot from read-only calls, then use `scripts/generate-weekly-report.mjs` to render it. The renderer deterministically produces HTML, Markdown, JSON, and a run manifest, applies data-quality gates, writes atomically, uses a lock file for overlapping runs, and scans outputs for secret-like content. The renderer treats missing data explicitly: true zero, not observed, provisional, unavailable, and failed should not be collapsed into the same value.

Collector example:

```bash
node /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/collect-weekly-snapshot.mjs \
  --start 2026-08-31 \
  --end 2026-09-06 \
  --out-dir /Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app/docs
```

Example:

```bash
node /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/generate-weekly-report.mjs \
  --snapshot /Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app/docs/bol-retailer-api-w36-full-snapshot-2026-09-09.json \
  --out-dir /Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app/docs \
  --report-slug bol-retailer-2026-W36-weekly-report \
  --allow-partial-rank
```

Use `--allow-partial-rank` only when the report clearly labels the rank coverage caveat. A normal weekly run should aim for seven daily rank dates.

Use `--dry-run` for operational validation without writing files.

If no weekly snapshot exists yet, first gather the Retailer API data with the collector or equivalent read-only calls, save a sanitized snapshot following `references/snapshot-contract.md`, then run the renderer. If credentials are unavailable, report the run as blocked rather than asking the user to paste secrets.

## Operating Modes

Generate weekly report:
Create or refresh the HTML/Markdown/JSON artifacts for a completed ISO week. Prefer the runner script.

Refresh keyword ranks:
Collect or replace only the rank payload, then re-run the report renderer with the same commercial snapshot.

Diagnose blocked run:
Check whether the problem is missing credentials, missing snapshot data, partial rank coverage, lock conflict, pagination failure, provenance mismatch, privacy scan failure, or a data-quality hard failure. Do not print secrets or raw auth headers.

Explain report:
Summarize verified facts, provisional values, unavailable values, limitations, and recommended actions in non-technical commercial language.

Improve template:
Edit the HTML/report shape while preserving the metric definitions, caveats, and privacy checks.

## Safety Boundaries

Do not create or modify dashboard features, Supabase tables, production data pipelines, scheduled jobs, cron jobs, email automations, or Advertising API workflows while using this skill unless the user separately approves that work.

Never print, store, copy, or expose Bol credentials. Use `BOL_RETAILER_CLIENT_ID` and `BOL_RETAILER_CLIENT_SECRET` from the managed local or Vercel environment only. If the user has pasted credentials in chat, do not repeat them; recommend rotation when relevant.

Use read-only API calls for report generation unless the user explicitly asks for a write action and the Aterra approval rules allow it.

## Data Rules

Separate verified values, provisional values, unavailable values, assumptions, and limitations in the report. This matters more than filling every cell.

Use shipment-derived orders for historical shipped-week sales when the order-list endpoint undercounts older handled orders. Do not rely on the first page of paginated responses; follow pagination to completion and state the pagination method.

Build the product list as the union of shipped trading rows, returns, product visits, rank calls/observations, configured keyword products, and current offers. Do not restrict the weekly report to current offers only; historical sold products can otherwise disappear.

Treat returns as provisional until Bol has resolved them. Net shipped GMS and revenue after commission may need restatement after W+1 or W+4.

Calculate weekly trading conversion as shipped units divided by Bol `PRODUCT_VISITS` when visits exist. Label it as a commercial trading rate, not a perfectly cohort-matched order-placement conversion.

Call Bol `PRODUCT_VISITS` "Product visits" or "glance views" consistently, and distinguish them from product-rank impressions.

## Rank Rules

A product does not have one rank. Rank varies by date, keyword, locale, and sponsored versus organic placement.

For weekly rank, collect daily product-rank observations for every report date, active EAN, locale, placement, and page until `hasNextPage` is false. Normalize keywords for aggregation, but preserve raw keyword variants in the report.

Use impression-weighted weekly rank when impressions exist. Also show best rank, worst rank, impressions, and days observed. Missing observations mean "Not observed", not rank zero.

Show one primary keyword in the product scorecard, but include the full keyword matrix below it. Count rank coverage from successful EAN-date-locale API calls, not only from observations. A successful empty call means "not observed"; it still proves the query ran. If only a one-day rank test exists, label it clearly as a one-day snapshot.

## Validation

After changing the renderer, run:

```bash
node --check /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/collect-weekly-snapshot.mjs
node --check /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/generate-weekly-report.mjs
node --test /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/test-generate-weekly-report.mjs
```

Then run the skill validator. It requires PyYAML in the selected Python environment:

```bash
python3 /Users/ReinoutBuwalda/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report
```

## Existing Aterra Artifacts

When working in `/Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app`, the useful discovery artifacts are:

- `docs/bol-retailer-api-discovery-2026-09-09.md`
- `docs/bol-retailer-api-w36-full-snapshot-2026-09-09.json`
- `docs/bol-retailer-api-w36-weekly-report-test-2026-09-10.md`
- `docs/bol-retailer-api-w36-weekly-report-test-2026-09-10.html`
- `scripts/test-bol-retailer-weekly-report.mjs`

Reuse these as examples and starting points, but do not assume W36 values apply to later weeks.
