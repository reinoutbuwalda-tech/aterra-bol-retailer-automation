# Bol Retailer transform worker

Transforms verified Retailer API source contract `3.0` snapshots into Aterra's private Supabase data foundation. Transform `v2` adds strict manifest-envelope validation and complete-catalog readiness rules without rewriting historical `v1` lineage.

## Processing contract

1. A terminal source run is queued in `bol_retailer_transform`.
2. The worker claims one message and leases its transform run.
3. It downloads the manifest and six artifacts from private Storage.
4. The claimed run, exact storage paths, ISO week, source status, dataset-status shape,
   and parsed artifact envelopes must agree.
5. Every stored byte length and SHA-256 hash is verified before parsing.
6. Facts, lineage sightings, checks, exceptions, and reporting revisions publish in one database transaction.
7. The queue message is archived only after successful publication.

Transient failures use bounded backoff and stop after five attempts with
`RETRY_EXHAUSTED`. Permanent source-contract failures reject immediately. Rejected
runs remain visible for investigation and their queue message is archived.

The function uses a custom `x-aterra-cron-token` check, so Supabase gateway JWT verification is disabled in `config.toml`. The token value stays in Edge Function secrets and Vault.

## Business rules

- EAN is the first product key.
- Every valid catalog offer receives a weekly row, even when activity is zero.
- An incomplete catalog blocks catalog-dependent products rather than shrinking the
  product universe and accidentally passing coverage.
- Sales come from outbound shipment items.
- Returns remain registered events and reduce provisional value only after an exact order-ID and EAN match.
- Gross ASP is calculated before returns.
- Buy Box percentages retain country and date and are never summed into a fabricated total.
- Weekly visits require seven aligned dates for every EAN in the weekly report,
  including sold or returned products absent from the current offer list. Partial
  daily evidence does not become a weekly metric.
- Same-week units divided by visits is labeled as a trading proxy, not cohort conversion.
- Reporting revisions are provisional until settlement and accounting reconciliation are complete.

Historical rolling traffic is not reconstructed from a later API response. The one-time
W37-W39 promotion migration accepts an older insights artifact only after checksum,
byte-count, EAN, and seven-date alignment checks. W36 remains unavailable because its
legacy insight dates belong to W37.

Run the focused regression suite with:

```bash
node --test tests/retailer-cloud-extract.test.mjs tests/retailer-transform.test.mjs
```
