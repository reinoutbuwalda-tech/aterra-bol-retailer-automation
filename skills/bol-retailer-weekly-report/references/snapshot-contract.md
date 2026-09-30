# Weekly Snapshot Contract

Use this contract for sanitized weekly Retailer API snapshots that feed `scripts/generate-weekly-report.mjs`.

## Product Universe

The report product list is the union of:

- Current offers in `currentState.offers`.
- Weekly shipped trading rows in `operational.byEan`.
- Weekly `PRODUCT_VISITS` rows in `weekMetrics.offerInsights`.
- Return item EANs in `operational.returns`.
- Rank call or observation EANs.
- Configured keyword EANs in `references/product-keywords.json`.

This prevents a sold product from disappearing when the offer is removed or inactive before the Monday report.

## Required Minimum Shape

```json
{
  "week": {
    "label": "2026-W36",
    "start": "2026-08-31",
    "end": "2026-09-06"
  },
  "summary": {
    "apiCalls": 0,
    "apiErrors": 0
  },
  "apiCalls": [],
  "operational": {
    "byEan": {},
    "ordersFromShipmentDetails": [],
    "returns": []
  },
  "currentState": {
    "offers": []
  },
  "weekMetrics": {
    "offerInsights": []
  }
}
```

## Trading Rows

`operational.byEan[ean]` should contain shipment-derived weekly totals:

- `orders`
- `shipments`
- `lines`
- `units`
- `grossOrderValue`
- `commission`

These values should be built after all relevant shipment/order-detail pages have been fetched, not from the first page only.

## Product Visits

`weekMetrics.offerInsights` rows for product visits should use:

- `ean`
- `metric: "PRODUCT_VISITS"`
- `weekTotal` or `total`

Missing rows are treated as `not_observed`, not zero. True zero visits require an observed row with `weekTotal: 0`.

## Returns

Return items should include enough fields for line matching:

- `orderId`
- `orderItemId` when available
- `ean`
- `expectedQuantity` or `quantity`
- `handled`
- `returnReason.mainReason` when available

The renderer values returns only when it can link the return item to a single order line. Unlinked or ambiguous return units stay visible but are excluded from value adjustments.

## Rank Payload

Rank data may live in the snapshot or in a separate `--ranks` file. Preferred shape:

```json
{
  "calls": [
    {
      "ean": "8720892887504",
      "date": "2026-08-31",
      "locale": "nl-NL",
      "page": 1,
      "status": 200,
      "rows": 0,
      "paginationComplete": true
    }
  ],
  "dailyRankObservations": [
    {
      "date": "2026-08-31",
      "ean": "8720892887504",
      "locale": "nl-NL",
      "searchTermRaw": "waterkaraf",
      "searchTermNormalized": "waterkaraf",
      "placement": "ORGANIC",
      "rank": 12,
      "impressions": 44
    }
  ]
}
```

Successful empty calls are important evidence. They count toward coverage and mean Bol returned no rank observations for that EAN/date/locale, not that the product ranked zero.

## Provenance Checks

Keep the top-level `apiCalls` array and `summary.apiCalls` / `summary.apiErrors` in sync. If they disagree, the renderer warns because the snapshot is no longer fully auditable.

Each call row should avoid secrets and customer PII. Useful fields are endpoint, method, status, page, date, locale, EAN, row count, pagination status, and sanitized error class.
