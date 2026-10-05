# Bol Retailer data foundation

Updated: 2026-09-30.

## Purpose

This foundation turns the seven weekly Retailer API JSON files into structured,
traceable data. It keeps source evidence, business facts, quality decisions, and
reports separate. A report can therefore change without rewriting the original source
or hiding an earlier interpretation.

The foundation is for Retailer data first. Advertising data should later use the same
pipeline principles, but keep its own source contract and fact tables.

## The flow

```text
Bol Retailer API
  -> seven immutable JSON files in private Storage
  -> source run reaches complete or partial
  -> durable pgmq message
  -> transform verifies the claimed run, manifest contract, artifact envelopes, bytes, and SHA-256 hashes
  -> normalized facts plus exact source pointers
  -> independent data-product readiness decisions
  -> immutable weekly report revision
```

The transform never treats HTTP success as proof that a dataset is complete. It checks
the expected response shape, pagination, date coverage, and required business fields.
Publication and queue acknowledgement happen in one database transaction.

## The three schemas

### `pipeline`: what happened and why

- `transform_runs`: one attempt to transform one source snapshot.
- `transform_attempts`: worker attempts, leases, and terminal result.
- `source_artifacts`: expected and actual hash, bytes, and parse status per file.
- `transform_steps`: source validation, commercial, catalog, insights, financial,
  quality, and publication steps.
- `quality_checks`: explicit pass, warning, failure, or not-applicable decisions.
- `exceptions`: unresolved business issues such as an unmatched return.
- `fact_sightings`: connects a structured fact to its source run, artifact, and exact
  JSON pointer.

### `bol_retailer`: reusable business facts

- Orders and order items preserve demand context.
- Outbound shipments and shipment items are the source for weekly sales.
- Return cases, items, and statuses preserve return events independently from sales.
- Offer, country availability, and inventory tables preserve catalog state.
- Daily offer insights preserve visits and country-level Buy Box percentages.
- Daily keyword ranks preserve EAN, date, locale, term, rank, and impressions.
- Commission estimates preserve the commission expected for an EAN and price.
- Invoice headers and transactions preserve settlement evidence.
- `ean_product_assignments` is the controlled bridge from marketplace EAN to Aterra
  product.

`operations.json` and `manifest.json` stay as source evidence. They are not expanded
into business tables unless a field is useful for a business decision or audit.

### `reporting`: what is currently usable

- `data_product_revisions`: independent readiness for catalog offers, shipments,
  returns, visits, ranks, Buy Box, invoices, country split, and derived trading metrics.
- `weekly_report_revisions`: immutable versions of a weekly report.
- `weekly_revision_sources`: the exact data-product revisions used by a report.
- `weekly_product_metrics`: one row for every valid mapped offer, including zero-
  activity products.
- `metric_definitions`: plain-English definition, formula, unit, aggregation method,
  readiness rule, source, and accounting use for all thirteen published measures.
- `current_weekly_summary`: one safe total row per active week; visits remain null
  unless every product row is ready.
- `current_weekly_product_metrics`: only the active report revision per week.
- `current_data_product_status`: readiness, limitations, source contract, transform,
  artifact-integrity coverage, and parsing scope for every active data product.
- `current_weekly_exceptions`: exceptions belonging only to transforms used by the
  active weekly report.
- `open_exceptions`: unresolved issues that can affect interpretation.
- `pipeline_health`: recent operational state.

The schemas are private. Anonymous and authenticated clients do not receive direct
table access; the service role performs controlled pipeline writes.

## Weekly metric logic

| Metric | Plain-English rule |
| --- | --- |
| Gross shipped units | Quantity in outbound shipment lines dated in the week. |
| Gross shipped GMS | Shipped quantity multiplied by shipment-line unit price. |
| Gross commission | Sum of the commission amount already reported for each shipment line. |
| Registered returns | Return events registered in the week. |
| Linked returns | All RMAs matched by exact order ID and EAN to one unique weekly shipment item, but only when aggregate group quantity does not exceed shipped quantity. Conflicting groups remain wholly unallocated. |
| Linked return GMS | Exact shipment-line gross allocated by the accepted group quantity ratio, so a full return reverses the original gross exactly and overflow remains an explicit exception. |
| Provisional net GMS | Gross shipped GMS minus linked return GMS. |
| Provisional revenue after commission | Provisional net GMS minus net commission after linked returns. |
| Gross shipped ASP | Gross shipped GMS divided by gross shipped units, before returns. |
| Product visits | Sum of seven aligned daily visit totals for the EAN. |
| Trading units per visit | Gross shipped units divided by same-week visits. This is not cohort conversion. |

An unmatched return stays visible as an exception and does not silently reduce revenue.
Settlement remains provisional until invoice and accounting reconciliation is approved.

## Readiness states

- `ready`: complete enough for its defined use.
- `ready_with_limits`: usable, but an explicit exception affects interpretation.
- `not_ready`: do not use this data product as a complete weekly result.
- `not_applicable`: the concept does not apply, such as FBB inventory when every offer
  uses FBR.

A partial source run does not make every output unusable. For example, shipment facts
can be ready while visits are not ready. Incomplete visits remain daily evidence; the
weekly visit total and units-per-visit are `null`, never zero or a partial sum.

Catalog completeness is checked separately. The catalog defines the current offer
universe, so an incomplete catalog makes catalog offers, visits, ranks, Buy Box, and
FBB inventory `not_ready`. Visit coverage is checked against every EAN that appears in
the weekly report, including a product that shipped or returned during the week but is
no longer in the current-offer list. One missing product therefore cannot hide behind
otherwise complete current offers.

These stricter rules are labeled `retailer-transform-v2`. Existing `v1` revisions stay
immutable and traceable. A v2 rollout first deploys the compatible worker while the
queue is empty, then changes the enqueue trigger, and finally queues only the latest
contract-3.0 source for each historical week. Existing report-promotion guards keep a
better active report when a v2 historical candidate has lower readiness.

The same protection applies independently to each data product. A later revision only
becomes current when it is at least as usable as the current one; for example,
`ready_with_limits` cannot replace `ready`. The weaker revision is still retained and
linked to its report for audit.

A later rerun can create a new revision without automatically becoming current. The
database keeps the existing active report when the new revision has lower readiness.
It also prevents any provisional automated revision from replacing an accounting-
approved report. The inactive candidate remains available for investigation.

## Current historical foundation

| ISO week | Units | Gross GMS | Commission | Visits | Report state | Main limitation |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| 2026-W36 | 32 | EUR 1,003.68 | EUR 177.50 | unavailable | `not_ready` | No aligned seven-day visit source exists. |
| 2026-W37 | 17 | EUR 587.83 | EUR 101.69 | 290 | `ready_with_limits` | Two registered returns are not linked to weekly shipments. |
| 2026-W38 | 18 | EUR 614.82 | EUR 108.05 | 268 | `ready` | Accounting settlement is still provisional. |
| 2026-W39 | 23 | EUR 769.77 | EUR 134.13 | 338 | `ready_with_limits` | One DIY-fort return is not linked to a weekly shipment. |

W37-W39 visits come from older immutable insights artifacts whose hashes and byte
counts match their manifests and whose dates exactly match the target week. The old
offer IDs were redacted, so they were restored only through exact EAN matches to the
contract 3.0 catalog. W36 was rejected because its apparent source contains W37 dates.

## How to trace a weekly number

1. Find the row in `reporting.current_weekly_product_metrics` by ISO week and EAN.
2. Use `weekly_report_revision_id` to inspect `weekly_revision_sources`.
3. Inspect each linked `data_product_revisions` row for status, formula version,
   limitations, source run, and transform run.
4. Inspect `pipeline.quality_checks` and `pipeline.exceptions` for the transform.
5. Join the relevant fact through `pipeline.fact_sightings` to see the artifact name
   and exact JSON pointer.
6. Compare `pipeline.source_artifacts.expected_sha256` with `actual_sha256` before
   trusting the parsed fact.

Example: current weekly totals

```sql
select iso_week, product_count, gross_shipped_units, gross_shipped_gms,
       gross_commission, product_visits, visits_status, report_status
from reporting.current_weekly_summary
where iso_year = 2026
order by iso_week;
```

Example: open business exceptions

```sql
select iso_week, exception_code, data_product, severity, ean, title, detail
from reporting.current_weekly_exceptions
order by opened_at desc;
```

Example: why a data product is or is not usable

```sql
select iso_week, data_product, data_product_status, limitations,
       source_contract_version, transform_version,
       artifact_count, integrity_verified_artifact_count,
       parsed_artifact_count, intentionally_unparsed_artifact_count,
       all_artifact_integrity_verified
from reporting.current_data_product_status
order by iso_week, data_product;
```

Integrity verification and parsing are deliberately separate. `operations.json` is
hash- and byte-verified but intentionally not parsed into business facts.

Example: artifact verification

```sql
select transform_run_id, artifact_name, storage_path,
       expected_sha256 = actual_sha256 as hash_verified,
       expected_bytes = actual_bytes as bytes_verified,
       parse_status
from pipeline.source_artifacts
order by checked_at desc;
```

See `docs/bol-retailer-cloud-operations.md` for scheduling, failure handling, and
operational checks.
