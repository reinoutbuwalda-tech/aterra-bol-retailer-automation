# Aterra Bol Retailer Weekly Report Spec

## Purpose

Create a weekly ecommerce trading report for Aterra's Bol.com Retailer API data. The report should be visually clear enough for Reinout and Thijs to review commercially, while remaining honest about API gaps and provisional metrics.

## Preferred Deliverables

For an approved report test, create:

- A self-contained visual HTML file suitable for opening locally and sharing by email.
- A privacy-safe JSON or Markdown support file when useful for auditability.
- A short final explanation covering what is verified, provisional, unavailable, and next recommended work.

Do not deploy or publish the report unless the user explicitly asks for hosting.

For the approved Monday cloud automation, the primary human-review deliverable is a native Google Sheet named `Aterra Bol Retailer <YYYY-Www> data review`. It must use the canonical nine-tab W39 structure, not the superseded simplified automated workbook.

Canonical tab order:

1. `Overview`
2. `Products`
3. `Weekly ranks`
4. `Daily ranks`
5. `Shipments`
6. `Returns`
7. `Offers`
8. `API quality`
9. `Source index`

Preserve Dutch currency/percentage presentation, Amsterdam reporting context, styled headings, guidance and quality blocks, filters, stable widths, hidden gridlines, frozen headers/identifier columns, conversion-status fields, and reviewer-note columns. Operational and financial datasets remain available in source JSON and are not separate workbook tabs.

When a sanitized weekly snapshot is available, prefer the skill runner:

```bash
node /Users/ReinoutBuwalda/.codex/skills/bol-retailer-weekly-report/scripts/generate-weekly-report.mjs \
  --snapshot <snapshot.json> \
  --out-dir /Users/ReinoutBuwalda/Desktop/Aterra/financial-system-app/docs \
  --report-slug bol-retailer-<YYYY-Www>-weekly-report
```

Use `--allow-partial-rank` only for explicitly labelled test or partial reports.

## HTML Report Layout

Use a quiet operational dashboard style, not a marketing landing page. The first screen should immediately show the report title, period, coverage caveat, and weekly KPIs.

Recommended sections:

1. Header: Aterra Commerce, Bol Retailer API, report period, test/final status.
2. Coverage notice: e.g. full W36 commercial metrics plus one-day rank snapshot, if applicable.
3. KPI row: net shipped GMS, units sold, ASP, product visits, revenue after commission, conversion.
4. Product scorecard: one row per product.
5. Net GMS mix: contribution by product.
6. Management attention: return issues, rank gaps, product concentration, data caveats.
7. Keyword positions: filterable table with product, keyword, placement, rank, impressions, days observed, raw variants.
8. Confidence notes: verified, provisional, unavailable.
9. Footer: state that no dashboard, database, schedule, or production workflow changed.

Use stable dimensions, responsive tables, clear status tags, and a restrained palette with at least neutral, teal/green, blue, amber, and red. Avoid decorative hero sections, gradients as the main design, and card-inside-card layouts.

## Product Scorecard Columns

Include these columns per product:

- Product name
- EAN
- Net shipped GMS
- Units sold
- ASP
- Conversion rate
- Product visits / glance views
- Revenue after commission
- Returns
- Primary keyword
- Sponsored rank
- Organic rank

Show `N/A` for unavailable metrics instead of inventing proxies. For rankings, show `Not observed` when the API returned no observation.

## Metric Definitions

Net shipped GMS:
Gross shipped order value minus registered return value linked to the shipment cohort. Mark provisional when returns are unresolved or the return window is immature.

Units sold:
Shipped quantity from the weekly shipment/order cohort.

ASP:
Gross shipped GMS divided by units sold unless the user requests net ASP. State which basis is used.

Conversion:
Weekly trading conversion is shipped units divided by product visits. Label it clearly as a commercial trading rate, not a perfectly cohort-matched order-placement conversion.

Product visits:
Bol Retailer API `PRODUCT_VISITS`; this is not the same as rank impressions.

Revenue after commission:
Gross shipped value minus order-line commission, adjusted for registered returns when possible. This is a commercial indicator, not accounting profit or settled revenue.

Returns:
Units and status. Highlight unresolved returns and product-quality reasons.

Sponsored and organic rank:
Impression-weighted rank for the chosen primary keyword when full weekly data exists. With partial rank data, label the coverage explicitly.

## Keyword Rank Matrix

Group rank observations by:

- EAN
- Locale
- Normalized keyword
- Placement: sponsored or organic

Preserve raw keyword variants. For each group show:

- Product
- Locale
- Keyword
- Placement
- Weekly rank
- Best rank
- Worst rank
- Impressions
- Days observed
- Raw variants

Normalize keywords using Unicode normalization, trimmed whitespace, collapsed spaces, and lowercase for Dutch locale. Keep raw variants visible because Bol can return casing and spelling variants.

## Completeness Checks

Before trusting totals:

- Confirm date range and timezone.
- Follow pagination until completion.
- Count unique orders, shipment lines, units, returns, offer rows, product-visit rows, rank calls, and rank observations.
- Distinguish observed zero values from missing/not-observed rows.
- Count rank coverage by successful EAN-date-locale calls, including successful empty calls.
- Compare API counts against expected business reality where available.
- State whether each important endpoint was live, offline, partial, or unavailable.
- Scan outputs for credentials before sharing.

The renderer performs baseline quality gates, but still review the generated warnings. Hard failures should block the report until the missing data or unsafe output is fixed.

## Known W36 Baseline

For the original W36 test, commercial metrics covered 2026-08-31 to 2026-09-06. Rank data was only a one-day snapshot for 2026-09-06.

Verified W36 totals:

- 31 unique shipped orders
- 32 units
- EUR 1,003.68 gross shipped value
- EUR 177.50 commission
- EUR 975.69 provisional net shipped GMS after one registered return
- EUR 803.54 provisional revenue after commission
- 334 product visits across active offers

Use these only as regression examples for the report shape. Do not reuse them for future weeks.
