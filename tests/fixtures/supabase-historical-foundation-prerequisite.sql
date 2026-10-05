-- Test-only production-state prerequisite for the data-dependent W37-W39 promotion.
-- It supplies only source pointers, current offer IDs, and prior active report shells.
insert into public.bol_retailer_api_extract_runs (
  id, run_kind, trigger_source, status, iso_year, iso_week, period_start, period_end,
  storage_path, snapshot_sha256, artifact_count, schedule_key, source_schema_version,
  started_at, completed_at
)
values
  ('51000000-0000-4000-8000-000000000037', 'weekly', 'cloud-test', 'complete', 2026, 37, '2026-09-07', '2026-09-13', 'retailer-api/test/w37/manifest.json', repeat('1', 64), 7, 'cloud-test-20260914-1700', '2.0', now(), now()),
  ('51000000-0000-4000-8000-000000000038', 'weekly', 'cron', 'complete', 2026, 38, '2026-09-14', '2026-09-20', 'retailer-api/test/w38/manifest.json', repeat('2', 64), 7, 'weekly-primary-2026-09-21', '2.1', now(), now()),
  ('51000000-0000-4000-8000-000000000039', 'weekly', 'cron', 'complete', 2026, 39, '2026-09-21', '2026-09-27', 'retailer-api/test/w39/manifest.json', repeat('3', 64), 7, 'weekly-primary-2026-09-28', '2.1', now(), now());

insert into bol_retailer.offer_observations (
  business_key, semantic_hash, offer_id, ean, observed_at
)
values
  ('test-offer-fruit|2026-09-28', repeat('a', 64), 'test-offer-fruit', '8720892887504', now()),
  ('test-offer-rvs|2026-09-28', repeat('b', 64), 'test-offer-rvs', '8720892887511', now()),
  ('test-offer-sportsbag|2026-09-28', repeat('c', 64), 'test-offer-sportsbag', '8720892887528', now()),
  ('test-offer-fort|2026-09-28', repeat('d', 64), 'test-offer-fort', '6970452112658', now());

do $$
declare
  week_number integer;
  report_id uuid;
begin
  foreach week_number in array array[37, 38, 39]
  loop
    insert into reporting.weekly_report_revisions (
      iso_year, iso_week, revision_number, status, accounting_status, is_active
    ) values (2026, week_number, 1, 'not_ready', 'provisional', true)
    returning id into report_id;

    insert into reporting.weekly_product_metrics (
      weekly_report_revision_id, product_id, ean,
      gross_shipped_units, gross_shipped_gms, gross_commission,
      registered_return_units, linked_return_units, unlinked_return_units,
      linked_return_gms, linked_return_commission,
      provisional_net_gms, provisional_revenue_after_commission,
      gross_shipped_asp, product_visits, trading_units_per_visit,
      commercial_status, visits_status, returns_status,
      limitations, calculation_trace
    )
    select
      report_id,
      product.id,
      product.ean,
      0, 0, 0,
      0, 0, 0,
      0, 0,
      0, 0,
      null, null, null,
      'ready', 'not_ready', 'ready',
      array['Product visits are unavailable because the source does not cover all seven reporting dates.'],
      '{}'::jsonb
    from public.products product
    where product.ean is not null;
  end loop;
end $$;
