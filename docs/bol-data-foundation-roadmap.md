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

- This GitHub repository is the authoritative source for the Bol data foundation. Local exports and development folders are supporting evidence or workspaces, not competing sources of truth.

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

- A weekly Retailer API extraction stores six sanitized dataset artifacts plus one manifest in private Supabase Storage.
- The manifest is written last and records file hashes, byte counts, date coverage, and dataset status.
- A Drive backup worker copies the same verified evidence to Google Drive and creates a human-readable review Sheet.
- A Supabase transform worker reads complete or partial source runs from a durable queue and publishes structured facts into private schemas.
- The private schemas are split by purpose:
  - `pipeline`: run logs, source artifacts, quality checks, exceptions, queue state, and source-to-fact lineage.
  - `bol_retailer`: reusable Retailer facts such as shipments, returns, offers, inventory, visits, keyword ranks, commission estimates, and invoices.
  - `reporting`: data-product revisions, weekly report revisions, current-state views, metric definitions, and exceptions.
- Weekly report revisions are immutable. A new run can create a new revision without overwriting the earlier one.
- Better eligible reports are protected. A weaker rerun cannot replace a stronger active report, an automated provisional report cannot replace an accounting-approved one, and explicitly invalidated revisions cannot be reactivated.
- The historical W36-W39 Retailer foundation has been backfilled and documented.
- The repository contains the prepared `retailer-transform-v2` worker and migration.
- Self-contained fixture, transform, SQL-contract, and migration suites run from a clean checkout without an external W39 evidence file.
- Linux, Windows, PostgreSQL migration, full Supabase/pgmq migration-chain, dependency-audit, and Deno CI gates are defined.

### Completed repository work

- A generated W39-equivalent fixture replaced the missing machine-local snapshot dependency.
- The Retailer v2 worker and migration validate manifest/envelope contracts, catalog and insight identities, return allocation, exact financial valuation, and final rounding.
- Shipment facts persist exact source valuation evidence so reports and return allocations can reconcile to stored facts.
- Weekly-report and data-product promotion guards protect stronger and accounting-approved revisions, with durable audited invalidation for withdrawn evidence.
- Fast disposable-database migration tests and a real pgmq full-chain rehearsal are defined in CI.
- The README, architecture, operations, and this roadmap form one canonical documentation set.

Known current limitations:

- The v2 repository changes are prepared and tested, but the live Supabase worker, migration, queue, and historical promotion state must be verified separately; repository history alone is not deployment evidence.
- Advertising API data has not yet been transformed into the structured foundation.
- Accounting-grade P&L is not complete. Settlement, VAT, COGS, fulfilment cost, freight,
  import cost, payment timing, and accounting approvals still need explicit modeling.
- Operational alerting and owner-facing runbooks exist in pieces, but they should be
  completed before the pipeline is treated as unattended finance infrastructure.
- Repository CI still needs dedicated Markdown-link validation, generated-artifact controls, and secret scanning; dependency audit does not scan repository content for secrets.
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

Purpose: prove the prepared Retailer v2 foundation in a non-production environment before promoting it live.

Completed in the repository:

- Self-contained fixture and clean-checkout test execution.
- Exact persisted shipment valuation and fact-to-report reconciliation.
- Durable data-product revision invalidation and stronger-revision protection.
- Disposable PostgreSQL migration harness, full Supabase/pgmq migration-chain test, and Linux, Windows, and Deno CI gates.
- A rollout and rollback runbook that freezes producers, drains v1, pauses the worker, migrates, deploys v2, validates, and only then resumes schedules.

Remaining build and release work:

- Rehearse the v2 migration on a non-production Supabase environment or database branch.
- Capture explicit W36-W39 v1/v2 comparison evidence for totals, readiness states, exact persisted financial facts, quality checks, and exceptions.
- Exercise the v1/v2 handoff test with extraction/retry producers frozen and all v1 work drained before migration.
- Verify live schedule identities, queue state, worker deployment, migration state, and rollback controls before cutover.
- Deploy and process the historical v2 candidates only after the rehearsal evidence passes review.
- Keep older eligible and invalidated revisions for audit when v2 becomes current.

Done when:

- Non-production rehearsal and W36-W39 comparison evidence pass review.
- v2 is live and the live worker/migration versions are independently verified.
- Historical Retailer weeks are reprocessed under v2 rules.
- No invalidated, weaker, or unapproved revision replaces an eligible stronger report.
- Persisted facts reproduce the published financial totals.
- The queue is empty and schedules are restored after processing.

### Phase 2: Add operating controls

Purpose: make the weekly process understandable and recoverable.

Build:

- Build an owner-facing API/page on top of the existing `reporting.pipeline_health` and related operational SQL views, covering extraction, Drive backup, transform queue, transform attempts, current reports, and open exceptions.
- Add alerts for failed extraction, missing manifest, checksum mismatch, queue backlog, failed transform, lower-readiness rerun, missing Drive backup, and stale weekly data.
- Add an independent missed-schedule and stale-run watchdog rather than relying only on the next pipeline invocation.
- Define the Monday service window, alert acknowledgement owner, and recovery target.
- Add resumable extraction checkpoints by dataset and pagination cursor, including persisted continuation and rate-limit state.
- Add a data-foundation PR checklist covering production-job impact, migrations, test commands, secrets, generated evidence, documentation, and rollback.
- Complete the environment, deployment, rollback, managed-secret rotation, backup, and tested-restore runbook.
- A replay and backfill procedure that explains how to rerun one week without damaging existing revisions.
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

- Weekly Retailer sales and fees reconcile to Bol settlement evidence for at least four closed weeks, including one week with returns and one crossing a settlement boundary.
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
- Disaster recovery notes for Storage, database, Drive backup, and queue state, backed by a tested restore.
- Managed-secret rotation procedures exercised with a second operator before handover.
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
| R2A | Run non-production v2 rehearsal | Prove environment and migration compatibility | Rehearsal log from a non-production Supabase environment | Repository migration/full-chain harness |
| R2B | Compare W36-W39 v1/v2 outputs | Prove reporting and financial equivalence | Reviewed comparison evidence and exception notes | R2A |
| R3 | Deploy Retailer v2 | Use stricter source, valuation, invalidation, and readiness rules | Verified live v2 worker and migration | R2B |
| C1 | Complete repository CI checks | Prevent documentation, generated-artifact, and secret regressions | Markdown-link, generated-artifact, and dedicated secret-scanning gates | Current CI |
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
