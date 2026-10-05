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
- Returns remain registered events. All RMAs that map to one unique shipment item are evaluated as one deterministic group. When aggregate return quantity exceeds shipped quantity, the whole group remains financially unallocated with an explicit exception; otherwise valuation uses the exact shipment-line gross and commission totals, proportionally for partial returns.
- Shipment-line gross and commission use exact integer minor units. Grouped partial returns use deterministic half-up allocation; full returns reverse the exact line totals, and negative provisional revenue after commission remains negative rather than being clamped.
- Malformed insight rows and any insight date outside the claimed week fail closed. Date-only insight and rank fields must be canonical calendar-valid `YYYY-MM-DD` values; timestamp suffixes are not truncated.
- Insight EAN/offer identities are validated before facts are created. Catalog EANs require their exact current offer ID. Commercial-only EANs require one unique exact shipment offer identity; unknown, reused, conflicting, and return-only identities fail closed.
- Buy Box percentages retain country and date and are never summed into a fabricated total.
- Weekly visits require the exact seven claimed dates for every EAN in the weekly report,
  including sold or returned products absent from the current offer list. Partial
  daily evidence does not become a weekly metric.
- Same-week units divided by visits is labeled as a trading proxy, not cohort conversion.
- Reporting revisions are provisional until settlement and accounting reconciliation are complete.

Historical rolling traffic is not reconstructed from a later API response. The one-time
W37-W39 promotion migration accepts an older insights artifact only after checksum,
byte-count, EAN, and seven-date alignment checks. W36 remains unavailable because its
legacy insight dates belong to W37.

Run the Edge type check and focused regression suite with:

```bash
deno check --frozen --lock=deno.lock --node-modules-dir=none supabase/functions/bol-retailer-transform/index.ts
node --test tests/retailer-cloud-extract.test.mjs tests/retailer-transform.test.mjs
```
