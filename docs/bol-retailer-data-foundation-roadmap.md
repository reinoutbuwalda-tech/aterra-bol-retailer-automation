# Bol Retailer data foundation roadmap

Updated: 2026-10-05.

## Overall goal

Build a dependable data foundation for Aterra's Bol Retailer operations.

The foundation should collect Bol Retailer API evidence every week, preserve the original sanitized JSON, transform it into traceable business facts, and publish weekly product metrics that Reinout, Thijs, an engineer, or an accountant can understand and audit.

The goal is not only to create a weekly report. The goal is to make every important number explainable:

- where it came from;
- which API run and file produced it;
- whether the source was complete;
- whether a business rule changed it;
- whether it is ready for operational use, limited use, or accounting review.

Advertising data should follow the same principles later, but it should stay separate from the Retailer source contract, tables, schedules, and reporting logic.

## Decisions already made

- Supabase is the operational data platform for source storage, run logs, facts, lineage, quality checks, queues, and reporting revisions.
- Weekly Retailer source extraction runs cloud-side and stores immutable sanitized JSON in private Storage.
- Source evidence, parsed facts, quality decisions, and published report revisions are separate layers.
- Retailer and Advertising automation must remain separate.
- Raw API evidence is never treated as complete just because an HTTP request succeeded.
- `operations.json` and `manifest.json` stay as evidence unless a field is needed for a business decision or audit.
- Source contract `3.0` is the active Retailer source contract because it preserves business identifiers while excluding personal data.
- EAN is the first product join key.
- Sales are based on outbound shipment items, not all order items.
- Returns reduce provisional value only when they match the same order ID and EAN.
- Weekly visits require seven aligned daily observations for every relevant offer; partial visits remain evidence but do not become complete weekly totals.
- Every mapped product should appear in the weekly product report, including products with zero sales, returns, or visits.
- Automated reporting revisions are provisional until accounting settlement and review are complete.
- Lower-quality reruns should not silently replace a better active weekly report.

## Current state

The repo currently contains a working Retailer-focused foundation with three main layers.

### Source extraction

The `bol-retailer-weekly-extract` Supabase Edge Function collects the previous complete ISO week from read-only Bol Retailer API endpoints. It writes a manifest and six sanitized JSON artifacts to the private `bol-retailer-api-json` bucket:

- `commercial.json`
- `catalog.json`
- `insights.json`
- `financial.json`
- `operations.json`
- `provenance.json`

The run log is stored in `public.bol_retailer_api_extract_runs`. It records status, completeness, warnings, API errors, dataset status, artifact metadata, and storage paths.

The weekly schedule is Monday 09:00 Europe/Amsterdam, with a retry around 10:00 when needed. DST is handled through paired UTC cron jobs plus local Amsterdam guards.

### Drive backup and review workbook

The `bol-retailer-drive-backup` function copies verified source JSON files to Google Drive and creates a native review workbook. It has its own run table, checksum verification, idempotency behavior, and private credential boundary.

The Drive layout is:

```text
02 Retailer/<year>/W<week>/source-json
02 Retailer/<year>/W<week>/report
```

### Transform and reporting foundation

The `bol-retailer-transform` Supabase Edge Function consumes terminal source runs through `pgmq`, verifies the manifest and every artifact checksum, then publishes data in one database transaction.

The database is organized into three private schemas:

- `pipeline`: transform runs, attempts, source artifacts, steps, checks, exceptions, and exact source sightings.
- `bol_retailer`: normalized source-faithful Retailer facts.
- `reporting`: data-product readiness, immutable weekly report revisions, weekly product metrics, metric definitions, current views, and operational health views.

The foundation has already backfilled W36-W39 2026 into reporting revisions. Current published weeks include ready, ready-with-limits, and not-ready states, depending on source completeness and business exceptions.

### Current validation

The repo has focused tests for:

- source extraction behavior;
- transform behavior;
- SQL foundation structure;
- rendered application checks.

The clean-checkout validation is not yet complete. The transform regression suite
expects `docs/bol-retailer-api-2026-W39-snapshot-2026-09-28.json`, but that sanitized
fixture is not versioned in this repository. The extraction and SQL foundation tests
run independently; the transform suite must become self-contained before it can be a
required CI check.

The operating notes dated 29 September 2026 report that extraction, Drive backup, and
transformation were active and that W36-W39 were backfilled. These are historical
operating records, not a current production-health check. No production job, live
migration, or deployment was executed while preparing this roadmap.

Useful commands include:

```bash
node --test tests/retailer-cloud-extract.test.mjs tests/retailer-transform.test.mjs
node --test tests/retailer-foundation-sql.test.mjs
npm run build
```

## Desired future state

The future foundation should behave like a small, dependable operating system for marketplace data.

For each completed week, Aterra should have:

- one immutable source evidence package in Supabase Storage;
- one verified Drive evidence package for human review;
- one transform run that either publishes or clearly explains why it did not;
- data-product readiness for shipments, returns, visits, ranks, Buy Box, invoices, country split, and derived trading metrics;
- an active weekly report revision only when it is at least as reliable as the current active revision;
- product-level rows for every mapped Aterra product, including zero-activity rows;
- clear exceptions for unmatched returns, missing visits, missing invoices, incomplete coverage, or source contract problems;
- a path from each published number back to the exact artifact and JSON pointer that produced it;
- operator-facing status that says what happened, what is missing, and what action is needed.

The dashboard should eventually read from the reporting layer instead of reinterpreting source data. Accounting outputs should use the same evidence and lineage, but only after settlement and accountant-reviewed policy gates are in place.

## Complete build plan by phase

### Phase 1: Stabilize the repository and documentation

Goal: make the current foundation easy to understand, review, and continue safely.

Work:

- Keep this roadmap linked from the README.
- Keep `docs/bol-retailer-data-foundation.md` as the source-of-truth architecture document.
- Keep `docs/bol-retailer-cloud-operations.md` as the operational runbook.
- Add a short "how to inspect a week" checklist for operators.
- Document which GitHub repo is authoritative for Retailer foundation work.
- Keep generated reports, large evidence files, local outputs, and temporary artifacts out of source control unless explicitly needed as fixtures.
- Add a small PR checklist for data-foundation changes: no production job, no live migration, test command, secret scan, docs update.
- Add a small sanitized W39 fixture, or generated equivalent, so all focused tests run
  from a clean checkout.
- Add required GitHub Actions checks for Retailer tests, migration and SQL validation,
  Markdown links, generated artifacts, and secret scanning.
- Separate Retailer validation commands from the inherited application build so this
  backend can be checked without unrelated UI state.
- Write one reproducible environment, deployment, rollback, and secret-rotation runbook
  for Supabase, Vercel, Vault, Google OAuth, and Drive.

Exit criteria:

- A new engineer can understand the current pipeline without reading every migration.
- The README points to the foundation docs and roadmap.
- Documentation-only PRs are easy to distinguish from production-affecting PRs.
- A clean clone passes all required checks without files from another local checkout.
- A second engineer can explain the deployment and rollback sequence without relying on
  chat history.

### Phase 2: Finish operational monitoring

Goal: detect failures without relying on manual inspection.

Work:

- Create a concise operational status view for the latest weekly extraction, Drive backup, transform, and report revision.
- Add one read-only API or admin surface that exposes weekly pipeline health to the app.
- Show whether a week is `complete`, `partial`, `published`, `rejected`, `retrying`, or waiting for accounting review.
- Surface unresolved exceptions and blocked data products.
- Add clear operator messages for common states: missing visits, unmatched returns, checksum mismatch, stale run, failed Drive backup, retry exhausted.
- Decide whether notification should happen through email, Slack, dashboard alerts, or a combination.
- Add a weekly monitor that reports only when action is needed.
- Add an independent watchdog for missed schedules and stale leases; recovery must not
  depend on the next normal invocation.
- Define a Monday service window, alert acknowledgement owner, and recovery target.

Exit criteria:

- Reinout can see the latest weekly state without querying SQL.
- A failed or partial week has one obvious next action.
- Silent failure is no longer possible for extraction, Drive backup, or transform.
- Missed schedules and stale runs are detected within the agreed service window.

### Phase 3: Harden reruns, backfills, and recovery

Goal: make manual reruns and historical backfills safe and boring.

Work:

- Write a runbook for approved manual reruns.
- Add clear rules for when `force` and `rerun` are allowed.
- Add stale-run recovery checks for source extraction, Drive backup, and transform.
- Add tests for rerun behavior where a new run has lower readiness than the active report.
- Add tests for preserving an accounting-approved report against automated replacement.
- Add a historical backfill checklist for weeks older than the current API window.
- Document which historical gaps cannot be repaired because Bol no longer exposes the data.
- Split extraction into resumable checkpoints by dataset and pagination cursor so API
  throttling or an Edge Function timeout does not restart the complete weekly pull.
- Persist enough rate-limit and continuation state to avoid repeating completed pages.
- Test year boundaries, daylight-saving changes, prolonged `429` responses, pagination
  limits, and interrupted continuations.

Exit criteria:

- A rerun cannot accidentally erase better evidence.
- An operator can backfill or retry a week with a written checklist.
- Historical limitations are explicit instead of hidden in code.
- An interrupted extraction resumes without duplicate artifacts or facts.

### Phase 4: Connect the foundation to the application

Goal: make the dashboard use the reporting layer instead of parallel calculations.

Work:

- Identify dashboard sections that should read from `reporting.current_weekly_summary`, `reporting.current_weekly_product_metrics`, `reporting.current_data_product_status`, and exception views.
- Add read-only server APIs for current weekly metrics and exceptions.
- Keep private schemas protected; expose only approved read models through server-side code.
- Add UI states for ready, ready-with-limits, not-ready, and provisional accounting status.
- Link dashboard numbers to their source week, report revision, and limitations.
- Avoid mixing Retailer trading metrics with accounting-approved P&L until settlement reconciliation is complete.

Exit criteria:

- The dashboard uses the same numbers as the weekly foundation.
- A visible metric can show whether it is operational, provisional, or accounting-approved.
- No dashboard section silently recalculates a conflicting version of the weekly report.

### Phase 5: Add settlement and accounting reconciliation

Goal: move from operational trading metrics toward accountant-ready reporting.

Work:

- Map Bol invoice transactions to weekly shipment, return, commission, fee, and settlement evidence.
- Separate shipment-week trading performance from settlement-period accounting results.
- Define accountant-approved policies for timing, VAT, fees, returns, corrections, and inventory movements.
- Add reconciliation checks between provisional weekly metrics and invoice/settlement evidence.
- Add review states for accountant approval, rejection, and requested correction.
- Preserve policy version and approval evidence with each accounting-ready output.
- Validate at least four closed weeks, including one with returns and one that crosses a
  settlement or accounting-period boundary.

Exit criteria:

- Operators can use weekly trading reports quickly.
- Accountants can separately review settlement-backed figures.
- The system never labels provisional operational metrics as closed accounting.
- Four closed weeks reconcile within an accountant-approved tolerance and retain review
  evidence.

### Phase 6: Expand product, inventory, and traffic coverage

Goal: make product-level performance complete enough for business decisions.

Work:

- Maintain controlled EAN-to-product assignments for every active Aterra offer.
- Add governance for new products, bundles, replacement EANs, and country-specific offers.
- Improve inventory interpretation while keeping offer stock, warehouse stock, and accounting inventory separate.
- Keep Buy Box and traffic metrics by country and date.
- Add keyword-rank trend outputs only where the source window and query terms are verified.
- Define how unavailable metrics should display: null, not-ready, not-applicable, or ready-with-limits.

Exit criteria:

- Every active product appears every week.
- Product changes have evidence and effective dates.
- Operators can distinguish missing activity from missing data.

### Phase 7: Apply the pattern to Advertising without merging workflows

Goal: reuse proven foundation principles for Bol Advertising while preserving separation.

Work:

- Keep Advertising source contracts, storage paths, run logs, schemas, and schedules separate.
- Define Advertising data products: campaigns, ad groups, keywords, targets, search terms, placements, spend, conversions, sales, ACoS, and ROAS.
- Preserve raw/sanitized Advertising API responses and report IDs.
- Add campaign-type-aware completeness rules for manual and automatic campaigns.
- Reconcile campaign, ad-group, targeting, and search-term reports where the API supports it.
- Publish Advertising readiness separately from Retailer readiness.
- Only join Retailer and Advertising in a later reporting layer after both sources are independently reliable.

Exit criteria:

- Advertising has the same traceability standard as Retailer.
- Retailer and Advertising failures cannot block or overwrite each other.
- Combined marketplace performance is built from two verified foundations, not from ad hoc joins.

### Phase 8: Prepare for ongoing operations

Goal: make the system maintainable when Aterra grows.

Work:

- Add a weekly operational checklist.
- Add a monthly data-quality review.
- Add a quarterly source-contract review.
- Keep metric definitions current when business rules change.
- Add backup/restore checks for critical Storage objects and reporting tables.
- Test a restore and each managed-secret rotation with a second operator.
- Add cost and capacity monitoring for Edge Functions, Storage, database growth, Drive,
  and Retailer API calls.
- Decide which tasks belong in GitHub issues, Notion, Slack, or the dashboard.
- Add ownership notes for who approves operational changes, accounting changes, and source-contract changes.

Exit criteria:

- The foundation can be operated without relying on memory from one chat thread.
- New data problems become tracked work, not hidden manual fixes.
- There is a clear owner for every production-affecting change.
- Restore and credential rotation no longer depend on the original implementer.

## Work backlog

### Documentation

- Add a concise operator checklist for inspecting one ISO week.
- Add a schema map with the most important tables and views.
- Add a glossary for source run, transform run, data product, weekly report revision, active revision, readiness, and exception.
- Add a PR checklist for data-foundation changes.

### Engineering

- Add a self-contained sanitized fixture for the transform regression suite.
- Add required CI for tests, migrations, links, generated files, and secret scanning.
- Refactor the extractor into resumable, checkpointed work units.
- Add an independent stale-run and missed-schedule watchdog.
- Add an app read model for latest Retailer pipeline health.
- Add tests for lower-readiness reruns and accounting-approved report protection.
- Add tests for zero-activity rows across every active mapped product.
- Add a read-only endpoint for current weekly product metrics.
- Add a read-only endpoint for current exceptions and data-product status.
- Add secret-scan and generated-artifact checks to the normal PR workflow.

### Operations

- Name the operational owner and technical owner for the Retailer service.
- Record deployed function hashes and migration state against the repository.
- Decide notification channel for failed or partial weekly runs.
- Decide who reviews weekly exceptions.
- Decide how long source artifacts and Drive backups must be retained.
- Confirm the owner for OAuth token rotation and cron token rotation.
- Confirm whether Drive backup is required before transform publication, or only before human review.

### Accounting

- Define the point where a weekly report moves from provisional to accounting-reviewed.
- Confirm how Bol settlement corrections should affect prior weeks.
- Confirm how VAT, fees, commissions, returns, and inventory movements should be reflected in closed reporting.
- Record accountant approval against policy versions.

## Definition of full completion

The Retailer data foundation is fully complete when all of the following are true:

- Weekly extraction, Drive backup, transform, and report publication run cloud-side without laptop dependency.
- Four consecutive Monday runs finish within the agreed service window without manual
  data repair.
- Every weekly run has a terminal state and cannot remain silently stuck.
- Interrupted extraction resumes from a durable checkpoint without duplicating source
  artifacts or normalized facts.
- Every source artifact has stored byte size and SHA-256 verification.
- Every published metric has a source pointer and calculation rule.
- Every active product appears in weekly product metrics, even with zero activity.
- Missing data is represented as not-ready or ready-with-limits, not as zero.
- Reruns are idempotent and cannot silently replace better or approved evidence.
- Operators can see current pipeline health without SQL.
- Accountants can distinguish operational trading metrics from settlement-backed accounting numbers.
- Secrets are stored only in managed secret stores, never in source, logs, artifacts, or PRs.
- The README, architecture doc, operations runbook, and roadmap are all current.
- CI passes in a clean clone and blocks incompatible migrations, broken documentation
  links, generated evidence, and detected secrets.
- Deployment, rollback, restore, and secret rotation have each been exercised by someone
  other than the original implementer.

## Main risks

- Bol API windows may not allow old traffic or ranking data to be recovered later.
- Source response shapes can change without warning.
- A single long Edge Function invocation may eventually hit duration or rate-limit constraints.
- The current transform test depends on a non-versioned local W39 fixture, so test success
  can differ between machines.
- Drive and Google credential handling adds a second cloud dependency.
- Unmatched returns can distort operational interpretation if not reviewed.
- Product mapping mistakes can make a valid source fact appear under the wrong product.
- Dashboard users may mistake provisional trading metrics for closed accounting results.
- Multiple GitHub repos or local branches can confuse where changes should land.
- Large generated reports or local outputs can accidentally enter source control.
- Credentials previously pasted into local files or chat require rotation even if they are not committed.

## Open decisions

- Which GitHub repo is the long-term source of truth for the combined financial system?
- Should the Retailer foundation stay in its own repo or merge into the broader financial control room repo?
- What is the official notification channel for weekly failures?
- Who is the operational owner, who is the technical owner, and what Monday service and
  recovery targets do they accept?
- Who approves a lower-readiness rerun becoming active?
- What exact status allows dashboard publication?
- What exact status allows accounting use?
- How long should source JSON, Drive backups, and weekly report revisions be retained?
- When should Advertising be added as a separate foundation using the same pattern?

## Next recommended action

Make repository ownership explicit before adding more production behavior.

Recommended next step:

1. Decide which GitHub repo is authoritative for the Retailer data foundation.
2. Name the operational and technical owners.
3. Compare deployed Supabase and Vercel state with the repository using read-only checks.
4. Make the transform fixture self-contained and add required CI.
5. Add the independent watchdog and operator checklist.
6. Only after those controls are in place, connect reporting views to the app dashboard.
