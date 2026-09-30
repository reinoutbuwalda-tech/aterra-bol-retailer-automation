update reporting.metric_definitions
set
  definition = 'Total commission amount reported on outbound shipment lines in the ISO week, before linked-return reversal.',
  formula = 'sum(shipment_line_commission_amount)',
  accounting_use = 'Provisional until reconciled to invoice transactions',
  aggregation_method = 'Additive across shipment lines, products, and weeks',
  readiness_rule = 'Ready only when commercial shipment details are complete and valid',
  updated_at = now()
where metric_code = 'gross_commission';

update reporting.metric_definitions
set
  definition = 'Commission amount associated with exactly linked returned units, prorated from the matched shipment-line commission when its quantity is greater than one.',
  formula = 'sum(linked_return_units * matched shipment line commission / matched shipment quantity)',
  updated_at = now()
where metric_code = 'linked_return_commission';
