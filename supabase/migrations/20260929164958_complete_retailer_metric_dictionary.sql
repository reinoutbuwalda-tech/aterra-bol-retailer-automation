alter table reporting.metric_definitions
  add column unit text,
  add column aggregation_method text,
  add column readiness_rule text;

insert into reporting.metric_definitions (
  metric_code, plain_english_name, definition, formula,
  source_data_product, accounting_use, formula_version,
  unit, aggregation_method, readiness_rule
)
values
  (
    'gross_shipped_units',
    'Gross shipped units',
    'Number of product units actually included in outbound shipments dated in the ISO week.',
    'sum(quantity_shipped) from outbound shipment items',
    'shipment_facts',
    'Trading volume; not an invoice or order-intake measure',
    'retailer-weekly-v1',
    'count',
    'Additive across products and weeks',
    'Ready only when commercial shipment details are complete and valid'
  ),
  (
    'gross_shipped_gms',
    'Gross shipped marketplace sales',
    'Value of items actually shipped during the ISO week, before returns and commission.',
    'sum(quantity_shipped * unit_price) from outbound shipment items',
    'shipment_facts',
    'Trading only until reconciled to invoices',
    'retailer-weekly-v1',
    'EUR',
    'Additive across products and weeks',
    'Ready only when commercial shipment details are complete and valid'
  ),
  (
    'gross_commission',
    'Gross shipment commission',
    'Commission attached to the product units shipped during the ISO week, before linked-return reversal.',
    'sum(quantity_shipped * shipment_line_commission)',
    'shipment_facts',
    'Provisional until reconciled to invoice transactions',
    'retailer-weekly-v1',
    'EUR',
    'Additive across products and weeks',
    'Ready only when commercial shipment details are complete and valid'
  ),
  (
    'registered_return_units',
    'Registered return units',
    'Quantity in return events registered during the ISO week, whether or not the sale occurred in the same week.',
    'sum(expected_quantity) from registered return items',
    'registered_return_events',
    'Operational return measure; not automatically a revenue deduction',
    'retailer-weekly-v1',
    'count',
    'Additive as return events, but not a sales-cohort return rate',
    'Ready when the commercial return source is complete'
  ),
  (
    'linked_return_units',
    'Exactly linked return units',
    'Registered return quantity matched exactly to one weekly shipment line by order ID and EAN.',
    'sum(matched return quantity)',
    'return_adjusted_trading',
    'Provisional basis for weekly return-value adjustment',
    'retailer-weekly-v1',
    'count',
    'Additive across products and weeks',
    'Ready with limits when unmatched or ambiguous return units remain'
  ),
  (
    'unlinked_return_units',
    'Unlinked return units',
    'Registered return quantity that could not be matched exactly to one shipment line in the same reporting week.',
    'registered_return_units - linked_return_units',
    'return_adjusted_trading',
    'Exception measure; excluded from provisional revenue adjustment',
    'retailer-weekly-v1',
    'count',
    'Additive exception count',
    'Zero is ready; a positive value makes return-adjusted trading ready with limits'
  ),
  (
    'linked_return_gms',
    'Linked return value adjustment',
    'Shipment value of registered returns that can be matched exactly to a shipped order item.',
    'sum(linked_return_units * matched shipment unit_price)',
    'return_adjusted_trading',
    'Provisional adjustment only',
    'retailer-weekly-v1',
    'EUR',
    'Additive across products and weeks',
    'Ready with limits when unmatched or ambiguous returns remain'
  ),
  (
    'linked_return_commission',
    'Linked return commission adjustment',
    'Shipment commission associated with exactly linked returned units.',
    'sum(linked_return_units * matched shipment commission)',
    'return_adjusted_trading',
    'Provisional commission reversal until invoice reconciliation',
    'retailer-weekly-v1',
    'EUR',
    'Additive across products and weeks',
    'Ready with limits when unmatched or ambiguous returns remain'
  ),
  (
    'provisional_net_gms',
    'Provisional net marketplace sales',
    'Gross shipped marketplace sales less exactly linked return value.',
    'gross_shipped_gms - linked_return_gms',
    'return_adjusted_trading',
    'Not approved P&L revenue',
    'retailer-weekly-v1',
    'EUR',
    'Additive across products and weeks',
    'Ready with limits when unmatched or ambiguous returns remain'
  ),
  (
    'provisional_revenue_after_commission',
    'Provisional revenue after commission',
    'Provisional net marketplace sales less gross commission after the linked-return commission adjustment.',
    'provisional_net_gms - (gross_commission - linked_return_commission)',
    'return_adjusted_trading',
    'Trading contribution before COGS, fulfilment, advertising, tax, and other P&L costs',
    'retailer-weekly-v1',
    'EUR',
    'Additive across products and weeks',
    'Ready with limits when unmatched or ambiguous returns remain; still provisional until invoice reconciliation'
  ),
  (
    'gross_shipped_asp',
    'Gross shipped average selling price',
    'Average price of shipped units before returns.',
    'gross_shipped_gms / gross_shipped_units',
    'shipment_facts',
    'Trading price metric',
    'retailer-weekly-v1',
    'EUR per unit',
    'Recalculate from summed GMS divided by summed units; do not sum product ASPs',
    'Null when gross shipped units are zero'
  ),
  (
    'product_visits',
    'Product visits',
    'Sum of daily Bol product visits for the EAN across exactly seven dates aligned to the ISO week.',
    'sum(seven aligned PRODUCT_VISITS daily totals)',
    'product_visits',
    'Traffic measure only',
    'retailer-weekly-v1',
    'count',
    'Additive across products only after every product has complete date coverage',
    'Null and not ready unless every valid offer has all seven reporting dates'
  ),
  (
    'trading_units_per_visit',
    'Trading units per visit',
    'Shipped units divided by product visits in the same ISO week. This is a trading proxy, not order-cohort conversion.',
    'gross_shipped_units / product_visits',
    'trading_units_per_visit',
    'Trading metric only; never describe it as conversion rate',
    'retailer-weekly-v1',
    'ratio',
    'Recalculate from summed units divided by summed visits; do not average product ratios',
    'Null unless shipment facts and seven-date product visits are ready'
  )
on conflict (metric_code) do update set
  plain_english_name = excluded.plain_english_name,
  definition = excluded.definition,
  formula = excluded.formula,
  source_data_product = excluded.source_data_product,
  accounting_use = excluded.accounting_use,
  formula_version = excluded.formula_version,
  unit = excluded.unit,
  aggregation_method = excluded.aggregation_method,
  readiness_rule = excluded.readiness_rule,
  updated_at = now();

alter table reporting.metric_definitions
  alter column unit set not null,
  alter column aggregation_method set not null,
  alter column readiness_rule set not null;
