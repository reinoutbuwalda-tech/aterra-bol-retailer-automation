-- Traceable data foundation for Bol Retailer source contract 3.0.
-- Raw JSON remains immutable in Storage; these private schemas contain only
-- business facts, source lineage, quality evidence, and reporting revisions.

create extension if not exists pgmq;

create schema if not exists pipeline;
create schema if not exists bol_retailer;
create schema if not exists reporting;

revoke all on schema pipeline, bol_retailer, reporting from public, anon, authenticated;
grant usage on schema pipeline, bol_retailer, reporting to service_role;

alter default privileges in schema pipeline revoke all on tables from public, anon, authenticated;
alter default privileges in schema bol_retailer revoke all on tables from public, anon, authenticated;
alter default privileges in schema reporting revoke all on tables from public, anon, authenticated;
alter default privileges in schema pipeline revoke all on sequences from public, anon, authenticated;
alter default privileges in schema bol_retailer revoke all on sequences from public, anon, authenticated;
alter default privileges in schema reporting revoke all on sequences from public, anon, authenticated;

create table pipeline.transform_runs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'bol_retailer',
  source_run_id uuid not null references public.bol_retailer_api_extract_runs(id),
  source_contract_version text not null,
  transform_version text not null,
  iso_year integer not null,
  iso_week integer not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  published_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transform_runs_status_check check (status in ('queued', 'processing', 'retry_wait', 'published', 'rejected')),
  constraint transform_runs_week_check check (iso_year between 2020 and 2100 and iso_week between 1 and 53),
  constraint transform_runs_period_check check (period_start <= period_end),
  unique (source_system, source_run_id, transform_version)
);

create index transform_runs_status_idx on pipeline.transform_runs (status, lease_expires_at, queued_at);
create index transform_runs_week_idx on pipeline.transform_runs (iso_year desc, iso_week desc, created_at desc);
create index transform_runs_source_run_idx on pipeline.transform_runs (source_run_id);

create table pipeline.transform_attempts (
  id bigint generated always as identity primary key,
  transform_run_id uuid not null references pipeline.transform_runs(id) on delete cascade,
  attempt_number integer not null,
  queue_message_id bigint,
  worker_id text not null,
  lease_token uuid not null,
  status text not null default 'processing',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  constraint transform_attempts_status_check check (status in ('processing', 'published', 'retryable_failure', 'rejected', 'lease_lost')),
  unique (transform_run_id, attempt_number)
);

create index transform_attempts_run_idx on pipeline.transform_attempts (transform_run_id, attempt_number desc);

create table pipeline.source_artifacts (
  transform_run_id uuid not null references pipeline.transform_runs(id) on delete cascade,
  artifact_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  expected_sha256 text not null,
  actual_sha256 text,
  expected_bytes bigint not null,
  actual_bytes bigint,
  parse_status text not null default 'pending',
  row_count integer,
  error_detail text,
  checked_at timestamptz,
  primary key (transform_run_id, artifact_name),
  constraint source_artifacts_hash_check check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  constraint source_artifacts_parse_status_check check (parse_status in ('pending', 'verified', 'invalid', 'not_parsed'))
);

create table pipeline.transform_steps (
  id bigint generated always as identity primary key,
  transform_run_id uuid not null references pipeline.transform_runs(id) on delete cascade,
  step_code text not null,
  status text not null,
  input_count integer,
  output_count integer,
  output_sha256 text,
  started_at timestamptz,
  completed_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  constraint transform_steps_status_check check (status in ('pending', 'running', 'passed', 'warning', 'failed', 'not_applicable')),
  unique (transform_run_id, step_code)
);

create table pipeline.quality_checks (
  id bigint generated always as identity primary key,
  transform_run_id uuid not null references pipeline.transform_runs(id) on delete cascade,
  check_code text not null,
  data_product text not null,
  severity text not null,
  result text not null,
  expected jsonb,
  observed jsonb,
  message text not null,
  created_at timestamptz not null default now(),
  constraint quality_checks_severity_check check (severity in ('info', 'warning', 'error')),
  constraint quality_checks_result_check check (result in ('passed', 'warning', 'failed', 'not_applicable')),
  unique (transform_run_id, check_code)
);

create index quality_checks_run_result_idx on pipeline.quality_checks (transform_run_id, result, severity);

create table pipeline.exceptions (
  id uuid primary key default gen_random_uuid(),
  transform_run_id uuid references pipeline.transform_runs(id) on delete set null,
  exception_code text not null,
  data_product text not null,
  severity text not null,
  status text not null default 'open',
  business_key text,
  ean text,
  title text not null,
  detail text not null,
  exposure_amount numeric(14, 2),
  evidence jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text,
  constraint exceptions_severity_check check (severity in ('info', 'warning', 'error')),
  constraint exceptions_status_check check (status in ('open', 'resolved', 'accepted'))
);

create index exceptions_open_idx on pipeline.exceptions (status, severity, opened_at desc) where status = 'open';
create index exceptions_transform_run_idx on pipeline.exceptions (transform_run_id);

create table pipeline.fact_sightings (
  id bigint generated always as identity primary key,
  transform_run_id uuid not null references pipeline.transform_runs(id) on delete cascade,
  source_run_id uuid not null references public.bol_retailer_api_extract_runs(id),
  fact_table text not null,
  fact_id uuid not null,
  semantic_hash text not null,
  artifact_name text not null,
  source_pointer text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint fact_sightings_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  unique (transform_run_id, fact_table, fact_id, artifact_name, source_pointer)
);

create index fact_sightings_source_idx on pipeline.fact_sightings (source_run_id, fact_table);
create index fact_sightings_fact_idx on pipeline.fact_sightings (fact_table, fact_id);

create table bol_retailer.ean_product_assignments (
  ean text not null,
  product_id text not null references public.products(id),
  valid_from date not null,
  valid_to date,
  mapping_status text not null default 'confirmed',
  evidence_note text not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (ean, valid_from),
  constraint ean_product_assignments_ean_check check (ean ~ '^[0-9]{13}$'),
  constraint ean_product_assignments_dates_check check (valid_to is null or valid_to >= valid_from),
  constraint ean_product_assignments_status_check check (mapping_status in ('confirmed', 'provisional', 'retired'))
);

create unique index ean_product_assignments_one_current_idx
  on bol_retailer.ean_product_assignments (ean) where valid_to is null;
create index ean_product_assignments_product_idx on bol_retailer.ean_product_assignments (product_id, valid_from);

create table bol_retailer.orders (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  order_id text not null,
  order_placed_at timestamptz,
  pickup_point boolean,
  country_code text,
  created_at timestamptz not null default now(),
  constraint orders_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint orders_country_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  unique (business_key, semantic_hash)
);

create index orders_order_id_idx on bol_retailer.orders (order_id);

create table bol_retailer.order_items (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  order_item_id text not null,
  order_id text not null,
  ean text not null,
  offer_id text,
  product_title text,
  quantity integer not null,
  quantity_shipped integer not null,
  quantity_cancelled integer not null,
  unit_price numeric(14, 2) not null,
  total_price numeric(14, 2) not null,
  commission numeric(14, 2),
  fulfilment_method text,
  distribution_party text,
  latest_delivery_date date,
  latest_changed_at timestamptz,
  cancellation_requested boolean,
  created_at timestamptz not null default now(),
  constraint order_items_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint order_items_ean_check check (ean ~ '^[0-9]{13}$'),
  constraint order_items_quantities_check check (quantity >= 0 and quantity_shipped >= 0 and quantity_cancelled >= 0),
  unique (business_key, semantic_hash)
);

create index order_items_order_idx on bol_retailer.order_items (order_id);
create index order_items_ean_idx on bol_retailer.order_items (ean);
create index order_items_order_item_idx on bol_retailer.order_items (order_item_id);

create table bol_retailer.outbound_shipments (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  shipment_id text not null,
  order_id text,
  shipment_at timestamptz not null,
  pickup_point boolean,
  country_code text,
  transport_id text,
  transporter_code text,
  track_and_trace text,
  shipping_label_id text,
  created_at timestamptz not null default now(),
  constraint outbound_shipments_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint outbound_shipments_country_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  unique (business_key, semantic_hash)
);

create index outbound_shipments_shipment_idx on bol_retailer.outbound_shipments (shipment_id);
create index outbound_shipments_order_idx on bol_retailer.outbound_shipments (order_id);
create index outbound_shipments_date_idx on bol_retailer.outbound_shipments (shipment_at);

create table bol_retailer.outbound_shipment_items (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  shipment_id text not null,
  order_id text,
  order_item_id text not null,
  ean text not null,
  offer_id text,
  product_title text,
  quantity_shipped integer not null,
  unit_price numeric(14, 2) not null,
  commission numeric(14, 2) not null,
  fulfilment_method text,
  distribution_party text,
  latest_delivery_date date,
  created_at timestamptz not null default now(),
  constraint outbound_shipment_items_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint outbound_shipment_items_ean_check check (ean ~ '^[0-9]{13}$'),
  constraint outbound_shipment_items_quantity_check check (quantity_shipped > 0),
  unique (business_key, semantic_hash)
);

create index outbound_shipment_items_shipment_idx on bol_retailer.outbound_shipment_items (shipment_id);
create index outbound_shipment_items_order_idx on bol_retailer.outbound_shipment_items (order_id);
create index outbound_shipment_items_order_item_idx on bol_retailer.outbound_shipment_items (order_item_id);
create index outbound_shipment_items_ean_idx on bol_retailer.outbound_shipment_items (ean);

create table bol_retailer.return_cases (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  return_id text not null,
  registered_at timestamptz not null,
  fulfilment_method text,
  created_at timestamptz not null default now(),
  constraint return_cases_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  unique (business_key, semantic_hash)
);

create index return_cases_return_idx on bol_retailer.return_cases (return_id);
create index return_cases_date_idx on bol_retailer.return_cases (registered_at);

create table bol_retailer.return_items (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  return_id text not null,
  rma_id text not null,
  order_id text,
  ean text not null,
  expected_quantity integer not null,
  main_reason text,
  detailed_reason text,
  handled boolean not null,
  created_at timestamptz not null default now(),
  constraint return_items_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint return_items_ean_check check (ean ~ '^[0-9]{13}$'),
  constraint return_items_quantity_check check (expected_quantity > 0),
  unique (business_key, semantic_hash)
);

create index return_items_return_idx on bol_retailer.return_items (return_id);
create index return_items_rma_idx on bol_retailer.return_items (rma_id);
create index return_items_order_idx on bol_retailer.return_items (order_id);
create index return_items_ean_idx on bol_retailer.return_items (ean);

create table bol_retailer.return_status_observations (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  rma_id text not null,
  handled boolean not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint return_status_observations_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  unique (business_key, semantic_hash)
);

create index return_status_observations_rma_idx on bol_retailer.return_status_observations (rma_id, observed_at desc);

create table bol_retailer.offer_observations (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  offer_id text not null,
  ean text not null,
  observed_at timestamptz not null,
  source_last_modified_at timestamptz,
  on_hold_by_retailer boolean,
  economic_operator_id text,
  stock_amount integer,
  corrected_stock integer,
  stock_managed_by_retailer boolean,
  condition_category text,
  bol_product_id text,
  unit_price numeric(14, 2),
  fulfilment_method text,
  fulfilment_schedule text,
  created_at timestamptz not null default now(),
  constraint offer_observations_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint offer_observations_ean_check check (ean ~ '^[0-9]{13}$'),
  unique (business_key, semantic_hash)
);

create index offer_observations_offer_idx on bol_retailer.offer_observations (offer_id, observed_at desc);
create index offer_observations_ean_idx on bol_retailer.offer_observations (ean, observed_at desc);

create table bol_retailer.offer_country_availability (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  offer_id text not null,
  ean text not null,
  observed_at timestamptz not null,
  country_code text not null,
  for_sale boolean not null,
  created_at timestamptz not null default now(),
  constraint offer_country_availability_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint offer_country_availability_country_check check (country_code ~ '^[A-Z]{2}$'),
  unique (business_key, semantic_hash)
);

create index offer_country_availability_offer_idx on bol_retailer.offer_country_availability (offer_id, observed_at desc);
create index offer_country_availability_ean_idx on bol_retailer.offer_country_availability (ean, country_code, observed_at desc);

create table bol_retailer.inventory_observations (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  ean text not null,
  observed_at timestamptz not null,
  quantity integer,
  stock jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint inventory_observations_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint inventory_observations_ean_check check (ean ~ '^[0-9]{13}$'),
  unique (business_key, semantic_hash)
);

create index inventory_observations_ean_idx on bol_retailer.inventory_observations (ean, observed_at desc);

create table bol_retailer.offer_insight_daily (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  offer_id text not null,
  ean text not null,
  metric_date date not null,
  metric text not null,
  country_code text,
  is_total boolean not null default false,
  value numeric(14, 4) not null,
  created_at timestamptz not null default now(),
  constraint offer_insight_daily_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint offer_insight_daily_ean_check check (ean ~ '^[0-9]{13}$'),
  constraint offer_insight_daily_metric_check check (metric in ('PRODUCT_VISITS', 'BUY_BOX_PERCENTAGE')),
  constraint offer_insight_daily_country_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint offer_insight_daily_total_check check ((is_total and country_code is null) or (not is_total and country_code is not null)),
  constraint offer_insight_daily_value_check check (value >= 0 and (metric <> 'BUY_BOX_PERCENTAGE' or value <= 100)),
  unique (business_key, semantic_hash)
);

create index offer_insight_daily_ean_idx on bol_retailer.offer_insight_daily (ean, metric_date, metric);
create index offer_insight_daily_offer_idx on bol_retailer.offer_insight_daily (offer_id, metric_date, metric);

create table bol_retailer.keyword_rank_daily (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  ean text not null,
  rank_date date not null,
  locale text not null,
  rank_type text not null,
  search_term text not null,
  was_sponsored boolean not null,
  rank integer not null,
  impressions integer not null,
  created_at timestamptz not null default now(),
  constraint keyword_rank_daily_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint keyword_rank_daily_ean_check check (ean ~ '^[0-9]{13}$'),
  constraint keyword_rank_daily_values_check check (rank > 0 and impressions >= 0),
  unique (business_key, semantic_hash)
);

create index keyword_rank_daily_ean_idx on bol_retailer.keyword_rank_daily (ean, rank_date, locale);
create index keyword_rank_daily_term_idx on bol_retailer.keyword_rank_daily (search_term, rank_date);

create table bol_retailer.commission_estimates (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  ean text not null,
  observed_at timestamptz not null,
  unit_price numeric(14, 2) not null,
  fixed_amount numeric(14, 4),
  percentage numeric(14, 6),
  total_cost numeric(14, 4),
  total_cost_without_reduction numeric(14, 4),
  raw_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commission_estimates_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint commission_estimates_ean_check check (ean ~ '^[0-9]{13}$'),
  unique (business_key, semantic_hash)
);

create index commission_estimates_ean_idx on bol_retailer.commission_estimates (ean, observed_at desc);

create table bol_retailer.invoice_headers (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  invoice_id text not null,
  issue_date date,
  invoice_type text,
  period_start date,
  period_end date,
  payable_amount numeric(14, 2),
  tax_exclusive_amount numeric(14, 2),
  tax_inclusive_amount numeric(14, 2),
  currency text,
  raw_header jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint invoice_headers_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint invoice_headers_period_check check (period_end is null or period_start is null or period_end >= period_start),
  unique (business_key, semantic_hash)
);

create index invoice_headers_invoice_idx on bol_retailer.invoice_headers (invoice_id);
create index invoice_headers_period_idx on bol_retailer.invoice_headers (period_start, period_end);

create table bol_retailer.invoice_transactions (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  semantic_hash text not null,
  invoice_id text not null,
  invoice_line_ref text not null,
  transaction_type text,
  order_id text,
  ean text,
  track_and_trace text,
  item_name text,
  item_description text,
  quantity numeric(14, 4),
  line_extension_amount numeric(14, 4),
  price_amount numeric(14, 4),
  tax_amount numeric(14, 4),
  tax_percentage numeric(10, 4),
  currency text,
  source_sign numeric(14, 4),
  settlement_effect numeric(14, 4),
  raw_line jsonb not null,
  created_at timestamptz not null default now(),
  constraint invoice_transactions_hash_check check (semantic_hash ~ '^[0-9a-f]{64}$'),
  constraint invoice_transactions_ean_check check (ean is null or ean ~ '^[0-9]{13}$'),
  unique (business_key, semantic_hash)
);

create index invoice_transactions_invoice_idx on bol_retailer.invoice_transactions (invoice_id, invoice_line_ref);
create index invoice_transactions_order_idx on bol_retailer.invoice_transactions (order_id) where order_id is not null;
create index invoice_transactions_ean_idx on bol_retailer.invoice_transactions (ean) where ean is not null;
create index invoice_transactions_type_idx on bol_retailer.invoice_transactions (transaction_type);

create table reporting.data_product_revisions (
  id uuid primary key default gen_random_uuid(),
  data_product text not null,
  iso_year integer not null,
  iso_week integer not null,
  revision_number integer not null,
  status text not null,
  source_run_id uuid not null references public.bol_retailer_api_extract_runs(id),
  transform_run_id uuid not null references pipeline.transform_runs(id),
  formula_version text not null,
  is_active boolean not null default false,
  limitations text[] not null default '{}',
  source_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  constraint data_product_revisions_status_check check (status in ('ready', 'ready_with_limits', 'not_ready', 'not_applicable')),
  constraint data_product_revisions_week_check check (iso_year between 2020 and 2100 and iso_week between 1 and 53),
  unique (data_product, iso_year, iso_week, revision_number)
);

create unique index data_product_revisions_one_active_idx
  on reporting.data_product_revisions (data_product, iso_year, iso_week) where is_active;
create index data_product_revisions_transform_idx on reporting.data_product_revisions (transform_run_id);
create index data_product_revisions_source_idx on reporting.data_product_revisions (source_run_id);

create table reporting.weekly_report_revisions (
  id uuid primary key default gen_random_uuid(),
  iso_year integer not null,
  iso_week integer not null,
  revision_number integer not null,
  status text not null,
  accounting_status text not null default 'provisional',
  is_active boolean not null default false,
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  approval_note text,
  constraint weekly_report_revisions_status_check check (status in ('ready', 'ready_with_limits', 'not_ready')),
  constraint weekly_report_revisions_accounting_check check (accounting_status in ('provisional', 'approved')),
  constraint weekly_report_revisions_week_check check (iso_year between 2020 and 2100 and iso_week between 1 and 53),
  unique (iso_year, iso_week, revision_number)
);

create unique index weekly_report_revisions_one_active_idx
  on reporting.weekly_report_revisions (iso_year, iso_week) where is_active;

create table reporting.weekly_revision_sources (
  weekly_report_revision_id uuid not null references reporting.weekly_report_revisions(id) on delete cascade,
  data_product_revision_id uuid not null references reporting.data_product_revisions(id),
  primary key (weekly_report_revision_id, data_product_revision_id)
);

create index weekly_revision_sources_product_idx on reporting.weekly_revision_sources (data_product_revision_id);

create table reporting.weekly_product_metrics (
  id uuid primary key default gen_random_uuid(),
  weekly_report_revision_id uuid not null references reporting.weekly_report_revisions(id) on delete cascade,
  product_id text references public.products(id),
  ean text not null,
  gross_shipped_units integer not null default 0,
  gross_shipped_gms numeric(14, 2) not null default 0,
  gross_commission numeric(14, 2) not null default 0,
  registered_return_units integer not null default 0,
  linked_return_units integer not null default 0,
  unlinked_return_units integer not null default 0,
  linked_return_gms numeric(14, 2) not null default 0,
  linked_return_commission numeric(14, 2) not null default 0,
  provisional_net_gms numeric(14, 2) not null default 0,
  provisional_revenue_after_commission numeric(14, 2) not null default 0,
  gross_shipped_asp numeric(14, 4),
  product_visits integer,
  trading_units_per_visit numeric(14, 6),
  commercial_status text not null,
  visits_status text not null,
  returns_status text not null,
  limitations text[] not null default '{}',
  calculation_trace jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint weekly_product_metrics_ean_check check (ean ~ '^[0-9]{13}$'),
  constraint weekly_product_metrics_status_check check (
    commercial_status in ('ready', 'ready_with_limits', 'not_ready', 'not_applicable')
    and visits_status in ('ready', 'ready_with_limits', 'not_ready', 'not_applicable')
    and returns_status in ('ready', 'ready_with_limits', 'not_ready', 'not_applicable')
  ),
  constraint weekly_product_metrics_nonnegative_check check (
    gross_shipped_units >= 0 and registered_return_units >= 0 and linked_return_units >= 0 and unlinked_return_units >= 0
    and gross_shipped_gms >= 0 and gross_commission >= 0 and linked_return_gms >= 0 and linked_return_commission >= 0
  ),
  unique (weekly_report_revision_id, ean)
);

create index weekly_product_metrics_product_idx on reporting.weekly_product_metrics (product_id);
create index weekly_product_metrics_ean_idx on reporting.weekly_product_metrics (ean);

create table reporting.metric_definitions (
  metric_code text primary key,
  plain_english_name text not null,
  definition text not null,
  formula text not null,
  source_data_product text not null,
  accounting_use text not null,
  formula_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into reporting.metric_definitions
  (metric_code, plain_english_name, definition, formula, source_data_product, accounting_use, formula_version)
values
  ('gross_shipped_gms', 'Gross shipped revenue', 'Value of items actually shipped during the ISO week, before returns and commission.', 'sum(quantity_shipped * unit_price) from outbound shipment items', 'shipment_facts', 'Trading only until reconciled to invoices', 'retailer-weekly-v1'),
  ('linked_return_gms', 'Linked return adjustment', 'Value of registered returns that can be matched exactly to a shipped order item.', 'sum(matched_return_quantity * matched_unit_price)', 'registered_return_events', 'Provisional adjustment only', 'retailer-weekly-v1'),
  ('provisional_net_gms', 'Provisional net revenue', 'Gross shipped revenue less exactly linked return value.', 'gross_shipped_gms - linked_return_gms', 'return_adjusted_trading', 'Not approved P&L revenue', 'retailer-weekly-v1'),
  ('gross_shipped_asp', 'Gross average selling price', 'Average price of shipped units before returns.', 'gross_shipped_gms / gross_shipped_units', 'shipment_facts', 'Trading metric', 'retailer-weekly-v1'),
  ('trading_units_per_visit', 'Trading units per visit', 'Shipped units divided by product visits in the same ISO week. This is a trading proxy, not order-cohort conversion.', 'gross_shipped_units / product_visits', 'trading_units_per_visit', 'Trading metric only', 'retailer-weekly-v1')
on conflict (metric_code) do update set
  plain_english_name = excluded.plain_english_name,
  definition = excluded.definition,
  formula = excluded.formula,
  source_data_product = excluded.source_data_product,
  accounting_use = excluded.accounting_use,
  formula_version = excluded.formula_version,
  updated_at = now();

create or replace view reporting.current_weekly_product_metrics
with (security_invoker = true)
as
select
  r.iso_year,
  r.iso_week,
  r.revision_number,
  r.status as report_status,
  r.accounting_status,
  m.*
from reporting.weekly_report_revisions r
join reporting.weekly_product_metrics m on m.weekly_report_revision_id = r.id
where r.is_active;

create or replace view reporting.pipeline_health
with (security_invoker = true)
as
select
  tr.id as transform_run_id,
  tr.source_run_id,
  tr.iso_year,
  tr.iso_week,
  tr.source_contract_version,
  tr.transform_version,
  tr.status,
  tr.attempt_count,
  tr.queued_at,
  tr.started_at,
  tr.published_at,
  tr.error_code,
  count(qc.id) filter (where qc.result = 'failed') as failed_checks,
  count(qc.id) filter (where qc.result = 'warning') as warning_checks,
  count(ex.id) filter (where ex.status = 'open') as open_exceptions
from pipeline.transform_runs tr
left join pipeline.quality_checks qc on qc.transform_run_id = tr.id
left join pipeline.exceptions ex on ex.transform_run_id = tr.id
group by tr.id;

create or replace view reporting.open_exceptions
with (security_invoker = true)
as
select id, transform_run_id, exception_code, data_product, severity, business_key, ean,
  title, detail, exposure_amount, evidence, opened_at
from pipeline.exceptions
where status = 'open';

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'bol_retailer_transform') then
    perform pgmq.create('bol_retailer_transform');
  end if;
end $$;

create or replace function pipeline.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function pipeline.set_updated_at() from public, anon, authenticated;

create trigger transform_runs_updated_at
before update on pipeline.transform_runs
for each row execute function pipeline.set_updated_at();

create or replace function pipeline.enqueue_bol_retailer_transform()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transform_id uuid;
begin
  if old.status = 'running'
     and new.status in ('complete', 'partial')
     and new.source_schema_version = '3.0'
     and new.storage_path is not null
     and new.snapshot_sha256 is not null
     and new.artifact_count = 7 then
    insert into pipeline.transform_runs (
      source_run_id,
      source_contract_version,
      transform_version,
      iso_year,
      iso_week,
      period_start,
      period_end
    ) values (
      new.id,
      new.source_schema_version,
      'retailer-transform-v1',
      new.iso_year,
      new.iso_week,
      new.period_start,
      new.period_end
    )
    on conflict (source_system, source_run_id, transform_version) do nothing
    returning id into transform_id;

    if transform_id is not null then
      perform pgmq.send(
        'bol_retailer_transform',
        jsonb_build_object(
          'transformRunId', transform_id,
          'sourceRunId', new.id,
          'sourceContractVersion', new.source_schema_version,
          'transformVersion', 'retailer-transform-v1'
        )
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function pipeline.enqueue_bol_retailer_transform() from public, anon, authenticated;

create trigger enqueue_bol_retailer_transform
after update of status on public.bol_retailer_api_extract_runs
for each row execute function pipeline.enqueue_bol_retailer_transform();

-- User-confirmed product truth for the source-contract 3.0 backfill.
update public.products
set ean = '6970452112658', updated_at = now()
where id = 'diy-fort' and ean is distinct from '6970452112658';

insert into bol_retailer.ean_product_assignments (ean, product_id, valid_from, evidence_note)
values
  ('8720892887504', 'carafe-fruit', date '2020-01-01', 'Existing Aterra product master mapping.'),
  ('8720892887511', 'carafe-rvs', date '2020-01-01', 'Existing Aterra product master mapping.'),
  ('8720892887528', 'sportsbag', date '2020-01-01', 'User confirmed the product is the 54 L sports bag.'),
  ('6970452112658', 'diy-fort', date '2020-01-01', 'User confirmed this EAN belongs to the Besrey DIY fort.')
on conflict (ean, valid_from) do update set
  product_id = excluded.product_id,
  evidence_note = excluded.evidence_note,
  mapping_status = 'confirmed',
  valid_to = null,
  confirmed_at = now();

do $$
declare
  target regclass;
begin
  foreach target in array array[
    'pipeline.transform_runs'::regclass,
    'pipeline.transform_attempts'::regclass,
    'pipeline.source_artifacts'::regclass,
    'pipeline.transform_steps'::regclass,
    'pipeline.quality_checks'::regclass,
    'pipeline.exceptions'::regclass,
    'pipeline.fact_sightings'::regclass,
    'bol_retailer.ean_product_assignments'::regclass,
    'bol_retailer.orders'::regclass,
    'bol_retailer.order_items'::regclass,
    'bol_retailer.outbound_shipments'::regclass,
    'bol_retailer.outbound_shipment_items'::regclass,
    'bol_retailer.return_cases'::regclass,
    'bol_retailer.return_items'::regclass,
    'bol_retailer.return_status_observations'::regclass,
    'bol_retailer.offer_observations'::regclass,
    'bol_retailer.offer_country_availability'::regclass,
    'bol_retailer.inventory_observations'::regclass,
    'bol_retailer.offer_insight_daily'::regclass,
    'bol_retailer.keyword_rank_daily'::regclass,
    'bol_retailer.commission_estimates'::regclass,
    'bol_retailer.invoice_headers'::regclass,
    'bol_retailer.invoice_transactions'::regclass,
    'reporting.data_product_revisions'::regclass,
    'reporting.weekly_report_revisions'::regclass,
    'reporting.weekly_revision_sources'::regclass,
    'reporting.weekly_product_metrics'::regclass,
    'reporting.metric_definitions'::regclass
  ] loop
    execute format('alter table %s enable row level security', target);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema pipeline, bol_retailer, reporting to service_role;
grant usage, select on all sequences in schema pipeline, bol_retailer, reporting to service_role;
grant select on reporting.current_weekly_product_metrics, reporting.pipeline_health, reporting.open_exceptions to service_role;

comment on schema pipeline is 'Private ETL control plane: runs, attempts, artifact verification, checks, exceptions, and source lineage.';
comment on schema bol_retailer is 'Private source-faithful Bol Retailer facts. Every row version is linked to raw Storage evidence through pipeline.fact_sightings.';
comment on schema reporting is 'Private, revisioned weekly reporting layer. Trading metrics remain separate from approved accounting results.';
comment on table bol_retailer.outbound_shipment_items is 'Authoritative source for shipped units and gross shipped value; order items are not treated as sales facts.';
comment on table bol_retailer.offer_observations is 'Point-in-time offer and offered-stock observations. These rows are not physical warehouse inventory.';
comment on table reporting.weekly_product_metrics is 'Understandable weekly product measures with explicit gross, return, provisional net, readiness, and calculation trace fields.';
