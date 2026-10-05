# Bol data foundation roadmap

Updated: 2026-10-05.

## Overall goal

Build a trusted data foundation for Aterra's Bol.com business.

In simple terms: every week, the Bol Retailer API and later the Bol Advertising API
should produce structured database tables that are easy to use for reporting, trend
analysis, margin review, and P&L reconciliation. The system must keep the original
evidence, show where every number came from, and never turn missing data into fake
zeroes.

The first priority is Retailer data. Advertising data comes next and should use the
same operating principles, while keeping its own source contract and fact tables.

## Decisions already made

- The transform job should live in Supabase, close to the database and private source
  storage. Supabase Edge Functions run the extract and transform workers. Supabase
  Postgres stores the facts, lineage, quality checks, queues, and reporting views.
- EAN is the first product key. Other identifiers are useful, but EAN is the first
  stable join point between catalog, sales, returns, visits, advertising, and product
  economics.
- Weekly history matters. Each week should be stored as an immutable snapshot so
  trends can be compared week over week.
- Bol business IDs are not treated as sensitive. They should remain exact because they
  are needed for reconciliation. Personal customer data stays excluded.
- `manifest.json` and `operations.json` remain evidence. They are stored and verified,
  but only business-useful fields become structured database facts.
- A partial source run may still contain useful evidence, but it must be clearly marked.
  Missing visits, missing catalog data, or incomplete ranks must not be published as if
  they were complete.
- Human approval is still required for accounting policy, tax treatment, commitments,
  and any production behavior that changes official financial reporting.

## Current state

The Retailer foundation is mostly built and documented.

What is already in place:

- A weekly Retailer API extraction stores seven sanitized JSON files in private
  Supabase Storage.
- The manifest is written last and records file hashes, byte counts, date coverage,
  and dataset status.
- A Drive backup worker copies the same verified evidence to Google Drive and creates
  a human-readable review Sheet.
- A Supabase transform worker reads complete or partial source runs from a durable
  queue and publishes structured facts into private schemas.
- The private schemas are split by purpose:
  - `pipeline`: run logs, source artifacts, quality checks, exceptions, queue state,
    and source-to-fact lineage.
  - `bol_retailer`: reusable Retailer facts such as shipments, returns, offers,
    inventory, visits, keyword ranks, commission estimates, and invoices.
  - `reporting`: data-product revisions, weekly report revisions, current-state
    views, metric definitions, and exceptions.
- Weekly report revisions are immutable. A new run can create a new revision without
  overwriting the earlier one.
- Better active reports are protected. A weaker rerun cannot replace a stronger active
  report, and an automated provisional report cannot replace an accounting-approved one.
- The historical W36-W39 Retailer foundation has been backfilled and documented.
- The current PR branch contains `retailer-transform-v2`, which strengthens the source
  contract and publication rules.
- The focused test suite currently has 99 passing tests for the Retailer transform and
  report-generator behavior.

Known current limitations:

- `retailer-transform-v2` is prepared in code and migration files, but it has not been
  deployed or applied to the live Supabase project.
- Local standalone Deno type-checking for Edge Functions is not yet clean because the
  Edge runtime declarations and generated Supabase database types are not fully wired
  into the local developer setup.
- Advertising API data has not yet been transformed into the structured foundation.
- Accounting-grade P&L is not complete. Settlement, VAT, COGS, fulfilment cost, freight,
  import cost, payment timing, and accounting approvals still need explicit modeling.
- Operational alerting and owner-facing runbooks exist in pieces, but they should be
  completed before the pipeline is treated as unattended finance infrastructure.
- Supabase security and performance advisor findings still need an explicit review.
  Many findings are probably expected for private service-role-only schemas, but that
  intent should be documented and verified rather than assumed.

## Future state

The future system should feel boring in the best way: the Monday run completes, the
database updates, exceptions are visible, and reports can be trusted.

Target weekly flow:

```text
Bol APIs
  -> immutable raw evidence in private Supabase Storage
  -> source contract and checksum verification
  -> durable queue message
  -> Supabase transform worker
  -> structured business facts
  -> data-quality decisions per data product
  -> immutable weekly reporting revision
  -> dashboards, Sheets, exports, and P&L reconciliation
```

Target data layers:

- Evidence layer: original JSON files, manifests, hashes, byte counts, storage paths,
  source run logs, and backup status.
- Business fact layer: normalized rows for orders, shipments, returns, offers, visits,
  ranks, invoices, ads, campaign performance, settlements, and product economics.
- Reporting layer: weekly snapshots, current active revisions, readiness states,
  metric definitions, exceptions, trend views, and P&L-ready outputs.

Target business views:

- Weekly product performance by EAN and product family.
- Weekly Retailer sales, returns, visits, conversion-like trading rates, ranks, Buy Box,
  inventory, and commission.
- Weekly Advertising spend, impressions, clicks, attributed sales, ROAS, ACOS, campaign
  structure, keywords, targeting, and search terms where available.
- Combined commercial view by week and EAN: gross sales, returns, net sales,
  commission, ad spend, fulfilment costs, landed product cost, VAT handling, and
  contribution margin.
- Exception view: what is missing, what is provisional, what needs human approval, and
  what changed since the previous revision.

## Complete build plan

### Phase 1: Finish Retailer v2 safely

Purpose: make the Retailer foundation stricter before relying on it for trend and
finance work.

Build:

- Complete local Edge Function type-check setup with Deno runtime declarations and
  generated Supabase database types.
- Rehearse the v2 migration on a non-production Supabase environment or database branch.
- Compare v1 and v2 outputs for W36-W39 before live promotion.
- Deploy the compatible v2 transform worker while the queue is empty.
- Apply the v2 migration only after confirming there are no queued, processing, or
  retry-wait transform jobs.
- Process the queued historical v2 candidates and compare totals, readiness states,
  source-artifact verification, quality checks, and exceptions.
- Keep older revisions for audit, even when v2 becomes current.

Done when:

- v2 is live.
- Historical Retailer weeks are reprocessed under v2 rules.
- No weaker revision replaces a stronger active report.
- The queue is empty after processing.
- The documented W36-W39 totals and readiness states still reconcile.

### Phase 2: Add operating controls

Purpose: make the weekly process understandable and recoverable.

Build:

- A simple operational status view for extraction, Drive backup, transform queue,
  transform attempts, current reports, and open exceptions.
- Alerts for failed extraction, missing manifest, checksum mismatch, queue backlog,
  failed transform, lower-readiness rerun, missing Drive backup, and stale weekly data.
- A replay and backfill procedure that explains how to rerun one week without damaging
  existing revisions.
- A weekly owner checklist for reviewing the Monday result.
- A security decision note for private schemas, RLS policy posture, exposed schemas,
  service-role-only access, and advisor findings.
- A retention and backup policy for source JSON, generated Sheets, and database facts.

Done when:

- Reinout can answer "did the weekly run work?" from one status surface.
- Every failure mode has a clear owner action.
- The system can rerun a week without hiding the earlier result.
- Security posture is intentional and documented.

### Phase 3: Make Retailer finance-grade

Purpose: move from trading reports to finance-ready reconciliation.

Build:

- Settlement and invoice matching between Bol evidence and structured Retailer facts.
- A fee taxonomy for commission, fulfilment, service, advertising, returns, corrections,
  and other Bol settlement lines.
- VAT treatment rules, with human approval before they become accounting policy.
- Product cost history by EAN, including landed cost changes over time.
- Freight, import, fulfilment, storage, and other cost allocation rules.
- Return timing logic that separates sale week, return registration week, refund week,
  and settlement week.
- Month-close and week-close states: provisional, reviewed, approved, and locked.
- Accountant-facing exception lists for unmatched settlements, missing costs, odd fees,
  and manual adjustments.

Done when:

- Weekly Retailer sales and fees reconcile to Bol settlement evidence.
- Product-level margin can be calculated without manual spreadsheet stitching.
- Approved periods are protected from automated overwrite.
- Accounting policy decisions are visible and approved by a human.

### Phase 4: Build the Advertising foundation

Purpose: make Bol Advertising data usable in the same weekly foundation.

Build:

- Define the Advertising source contract: expected files, date coverage, identifiers,
  pagination rules, and completeness rules.
- Store raw Advertising JSON files with manifests, checksums, byte counts, and source
  run logs.
- Create Advertising schemas or tables for campaigns, ad groups, ads, keywords,
  targets, search terms, placements, budgets, spend, clicks, impressions, attributed
  sales, attributed units, ACOS, ROAS, and campaign status.
- Preserve Bol ad IDs exactly. Map advertising entities to EANs where the API supports
  it, and keep unmapped spend visible as an exception.
- Add Advertising data-product revisions, quality checks, metric definitions, and
  current-state views.
- Create a canonical Advertising fixture and tests, similar to the Retailer fixture.
- Reconcile the structured Advertising output against the existing manual Advertising
  Google Sheet.

Done when:

- Advertising can be transformed from raw evidence into structured weekly facts.
- Spend and sales attribution are traceable to source files.
- Unmapped or ambiguous campaign spend is visible rather than hidden.
- Retailer and Advertising can be joined by week and EAN where the data allows it.

### Phase 5: Build unified commercial reporting

Purpose: combine Retailer and Advertising into one decision layer.

Build:

- Shared calendar/week dimension.
- Shared product/EAN dimension with product family, lifecycle status, launch date,
  product owner, and cost history.
- Unified weekly product view combining shipments, returns, visits, rank, Buy Box,
  commission, ad spend, attributed ad sales, and product costs.
- Contribution-margin logic by EAN and week.
- P&L-ready rollups by product, product family, marketplace, country, and period.
- Trend views for week-over-week movement and launch tracking.
- Export-ready views for Google Sheets, dashboards, accountant review, and owner review.

Done when:

- Reinout can review weekly performance from one trusted data model.
- Retailer and Advertising no longer need to be manually reconciled in separate Sheets.
- P&L rollups can explain their source, readiness, and exceptions.

### Phase 6: Harden for scale and handover

Purpose: make the system durable enough for more products, more weeks, and later Amazon
or other marketplaces.

Build:

- Schema versioning and source-contract versioning for every API family.
- Automated backfill tooling for old weeks.
- Performance indexes for the most-used reporting and lineage queries.
- Data dictionary coverage for every published metric.
- Disaster recovery notes for Storage, database, Drive backup, and queue state.
- Cost monitoring for Supabase, Vercel broker calls, Drive backups, and future API
  volume growth.
- Role and access review for owners, accountants, and technical maintainers.
- A handover runbook that explains normal weekly operation, failure recovery, release
  steps, and approval boundaries.

Done when:

- A new technical maintainer can operate the pipeline from documentation.
- Adding a new data family follows a known pattern.
- Alerts, runbooks, tests, and migration rules are part of the normal release process.

## Work backlog

| ID | Work item | Why it matters | Deliverable | Dependency |
| --- | --- | --- | --- | --- |
| R1 | Finish Edge Function type-check setup | Prevent runtime-only Supabase worker errors | Deno check config and generated DB types | Current v2 branch |
| R2 | Rehearse v2 on non-production data | Prove migration safety before live use | Rehearsal log and comparison notes | R1 |
| R3 | Deploy Retailer v2 | Use stricter source and readiness rules | Live v2 worker and migration | R2 |
| R4 | Owner status view | Make weekly health obvious | One current status view or page | R3 |
| R5 | Alerting | Avoid silent failures | Alert rules and owners | R4 |
| R6 | Security advisor review | Confirm private-schema posture | Written security decision note | R3 |
| F1 | Settlement matching | Reconcile sales and fees to money | Settlement fact tables and matching rules | R3 |
| F2 | Product cost history | Calculate margin by week and EAN | Cost history table and approvals | F1 |
| F3 | VAT and accounting policy | Avoid accidental accounting assumptions | Approved policy notes and locked periods | F1 |
| A1 | Advertising source contract | Avoid ad data ambiguity | Contract spec and manifest rules | R3 |
| A2 | Advertising raw evidence storage | Keep ad source files auditable | Storage layout and run logs | A1 |
| A3 | Advertising structured facts | Make ad data queryable | Campaign, target, keyword, spend, and attribution tables | A2 |
| A4 | Advertising report views | Connect ads to weekly reporting | Data-product revisions and views | A3 |
| U1 | Unified product dimension | Join Retailer, Ads, and costs | Product/EAN dimension and mapping rules | R3, A3, F2 |
| U2 | Contribution margin model | Show real product economics | Weekly margin views | U1, F3 |
| U3 | P&L reconciliation | Make reporting accountant-ready | Period close views and exception lists | U2 |

## Definition of full completion

The full foundation is complete when all of the following are true:

- The Monday Retailer and Advertising runs complete without manual work in normal weeks.
- Every published number can be traced back to a source file, hash, and JSON pointer or
  other exact source reference.
- Weekly historical snapshots are immutable and trendable.
- Missing or partial data is visible and never becomes fake zero.
- Retailer sales, returns, commission, invoices, settlements, Advertising spend, and
  product costs can be reconciled into product-level margin.
- Human approval is required and recorded for accounting policy, tax treatment, manual
  adjustments, and locked reporting periods.
- Reports can be exported to Sheets or dashboards without changing the source of truth.
- Runbooks, tests, alerts, and security notes are good enough for another maintainer to
  operate the system.

## Main risks

- Bol API changes can break extraction or change field meaning. Mitigation: source
  contracts, manifest validation, and fixture tests.
- Rolling insights can expire before old weeks are recovered. Mitigation: immutable
  weekly source backups and clear `not_ready` states for missing traffic.
- Catalog changes can hide products that still had sales or returns in a week.
  Mitigation: weekly report rows must include every EAN involved in the weekly facts.
- Returns can arrive in a different week from the sale. Mitigation: keep sale week,
  return registration week, refund week, and settlement week separate.
- Advertising attribution can be hard to map to EAN. Mitigation: keep unmapped spend
  visible as an exception and avoid forced joins.
- Finance rules can become accidental software behavior. Mitigation: require human
  approval for accounting policy and locked-period changes.
- Private schemas can still be misconfigured. Mitigation: document RLS/access posture
  and run Supabase advisors before production changes.

## Next recommended action

Finish Phase 1 first. The best next step is not to start Advertising immediately, but
to make the Retailer v2 foundation live and boring. After v2 is deployed and reviewed,
Advertising can reuse the same proven pattern with less risk.
