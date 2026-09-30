comment on schema pipeline is
  'Operational control plane: transform runs, attempts, verified artifacts, quality decisions, exceptions, and fact lineage.';
comment on schema bol_retailer is
  'Normalized Bol Retailer business facts keyed primarily by EAN and immutable business identifiers.';
comment on schema reporting is
  'Versioned, business-readable data products and weekly reports. Active views never rewrite earlier revisions.';

comment on table pipeline.transform_runs is
  'One versioned transform of one immutable Retailer source run.';
comment on table pipeline.transform_attempts is
  'Every leased worker attempt, including retries and terminal outcome.';
comment on table pipeline.source_artifacts is
  'Manifest-declared and observed hash, byte count, parsing scope, and verification result for each source artifact.';
comment on table pipeline.transform_steps is
  'Step-by-step execution record for source validation, domain transforms, quality, and publication.';
comment on table pipeline.quality_checks is
  'Machine-readable pass, warning, failure, or not-applicable decisions by data product.';
comment on table pipeline.exceptions is
  'Business exceptions that require interpretation or follow-up, such as an unmatched return.';
comment on table pipeline.fact_sightings is
  'Lineage from a normalized fact to the transform, source run, artifact, and exact JSON pointer where it was observed.';

comment on table bol_retailer.ean_product_assignments is
  'Controlled, date-effective bridge from marketplace EAN to Aterra product.';
comment on table bol_retailer.orders is
  'Order-level context retrieved for shipped orders; not the source of weekly sales.';
comment on table bol_retailer.order_items is
  'Order-line demand context, including ordered, shipped, and cancelled quantities.';
comment on table bol_retailer.outbound_shipments is
  'Outbound shipment headers. Shipment date determines the weekly sales period.';
comment on table bol_retailer.outbound_shipment_items is
  'Shipment lines used as the authoritative source for weekly shipped units, value, and commission.';
comment on table bol_retailer.return_cases is
  'Return-case headers registered during the reporting period.';
comment on table bol_retailer.return_items is
  'Return items preserved independently from any financial match to a shipment.';
comment on table bol_retailer.return_status_observations is
  'Point-in-time handled or unhandled status observations for an RMA.';
comment on table bol_retailer.offer_observations is
  'Point-in-time catalog offer state for each full offer ID and EAN.';
comment on table bol_retailer.offer_country_availability is
  'Whether an offer was for sale in a country at the observation time.';
comment on table bol_retailer.inventory_observations is
  'Point-in-time inventory observations. The stock JSON is a technical evidence cache; reporting uses modeled fields.';
comment on table bol_retailer.offer_insight_daily is
  'Daily product visits or country-level Buy Box percentage; totals and country values are explicitly distinguished.';
comment on table bol_retailer.keyword_rank_daily is
  'Daily search-rank observations by EAN, locale, search term, and sponsored flag.';
comment on table bol_retailer.commission_estimates is
  'Commission estimate returned for an EAN and price. Raw result is retained as private technical evidence.';
comment on table bol_retailer.invoice_headers is
  'Invoice-list headers and monetary totals. Raw header is private evidence for future finance-field modeling.';
comment on table bol_retailer.invoice_transactions is
  'Parsed invoice specification lines with source sign and Aterra settlement effect. Raw line is private evidence.';

comment on table reporting.data_product_revisions is
  'Independent immutable readiness revisions for shipments, returns, visits, ranks, invoices, and derived products.';
comment on table reporting.weekly_report_revisions is
  'Immutable weekly report versions; exactly one revision per ISO week is active.';
comment on table reporting.weekly_revision_sources is
  'Exact data-product revisions used to assemble a weekly report revision.';
comment on table reporting.weekly_product_metrics is
  'One product row per valid mapped offer in a weekly report revision, including zero-activity products.';
comment on table reporting.metric_definitions is
  'Plain-English formula, unit, aggregation, readiness, source, and accounting interpretation for every published measure.';
