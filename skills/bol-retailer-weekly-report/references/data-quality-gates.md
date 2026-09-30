# Data Quality Gates

Use these gates before treating a weekly Bol Retailer report as reliable.

## Hard Fail

Stop and report the run as blocked when:

- The source snapshot is missing or cannot be parsed.
- The snapshot contains no `week.start` or `week.end`.
- The snapshot contains no product universe from current offers, shipped trading rows, returns, product visits, ranks, or configured keyword products.
- Shipment-derived order data is missing for a week where shipped sales are expected and there is no explicit API limitation explaining why.
- Any generated output appears to contain `BOL_RETAILER_CLIENT_ID`, `BOL_RETAILER_CLIENT_SECRET`, `access_token`, `client_secret`, `authorization`, or obvious token-like secrets.

## Warning

Generate the report, but make the caveat visible, when:

- Rank coverage is fewer than 7 report dates.
- Rank calls contain non-200 statuses.
- Returns are unresolved or the return window is immature.
- Conversion is calculated as weekly trading conversion, so it should not be described as a pure order-placement cohort.
- Offer insight/product visit rows are missing for an active offer.
- The order-list endpoint disagrees with shipment-derived orders.
- Top-level API-call provenance disagrees with `summary.apiCalls` or `summary.apiErrors`.
- Return items cannot be linked to a single order line for value and commission adjustment.

## Completeness Checks

The final summary should include:

- Report week and date range.
- Product count and active/inactive coverage where known.
- Unique shipped orders, units, gross shipped GMS, commission, returns, and product visits when present.
- Rank dates represented and whether pagination was followed.
- Whether conversion is available as trading conversion or unavailable due to missing product visits.
- Product-visit state, distinguishing observed zero from missing/not observed rows.
- Rank EAN-date-locale coverage, including successful empty calls.
- Output file paths.
- Run manifest path and whether input hashes were recorded.

## Privacy Check

Before sharing output, inspect generated HTML, Markdown, and JSON for:

- API credentials or bearer tokens.
- Customer names, addresses, phone numbers, or email addresses.
- Full order IDs when not needed for the report.

The visual report should remain product-level and privacy-safe.

## Operational Guarantees

The renderer should:

- Write output files atomically so a partial write is not mistaken for a finished report.
- Create a run manifest containing input hashes and output paths.
- Use a lock file to prevent overlapping renders for the same report slug.
- Return structured JSON on success, blocked runs, and runner errors.
