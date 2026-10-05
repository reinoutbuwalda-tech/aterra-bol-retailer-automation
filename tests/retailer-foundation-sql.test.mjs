import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const managementViews = readFileSync(
  new URL('../supabase/migrations/20260929164712_add_retailer_management_views.sql', import.meta.url),
  'utf8',
);
const artifactStatus = readFileSync(
  new URL('../supabase/migrations/20260929164812_clarify_retailer_artifact_verification_status.sql', import.meta.url),
  'utf8',
);
const metricDictionary = readFileSync(
  new URL('../supabase/migrations/20260929164958_complete_retailer_metric_dictionary.sql', import.meta.url),
  'utf8',
);
const reportPromotionGuard = readFileSync(
  new URL('../supabase/migrations/20260929165345_protect_approved_weekly_reports.sql', import.meta.url),
  'utf8',
);
const commissionDictionaryFix = readFileSync(
  new URL('../supabase/migrations/20260929165852_correct_retailer_commission_definitions.sql', import.meta.url),
  'utf8',
);
const transformV2 = readFileSync(
  new URL('../supabase/migrations/20260930155322_retailer_transform_v2_contract.sql', import.meta.url),
  'utf8',
);
const transformWorker = readFileSync(
  new URL('../supabase/functions/bol-retailer-transform/index.ts', import.meta.url),
  'utf8',
);

test('pipeline health counts checks and exceptions without join multiplication', () => {
  assert.match(managementViews, /count\(distinct qc\.id\).*qc\.result = 'failed'/s);
  assert.match(managementViews, /count\(distinct qc\.id\).*qc\.result = 'warning'/s);
  assert.match(managementViews, /count\(distinct ex\.id\).*ex\.status = 'open'/s);
});

test('weekly summary never publishes a partial visit sum', () => {
  assert.match(
    managementViews,
    /when bool_and\(metric\.visits_status = 'ready'\) then sum\(metric\.product_visits\)/,
  );
});

test('current exceptions are limited to transforms used by the active report', () => {
  assert.match(managementViews, /create or replace view reporting\.current_weekly_exceptions/);
  assert.match(managementViews, /join reporting\.weekly_revision_sources report_source/);
  assert.match(managementViews, /where report\.is_active/);
});

test('artifact integrity is independent from intentional parsing scope', () => {
  assert.match(artifactStatus, /integrity_verified_artifact_count/);
  assert.match(artifactStatus, /parsed_artifact_count/);
  assert.match(artifactStatus, /intentionally_unparsed_artifact_count/);
  assert.match(
    artifactStatus,
    /bool_and\(\s*artifact\.expected_sha256 = artifact\.actual_sha256\s*and artifact\.expected_bytes = artifact\.actual_bytes\s*\)/s,
  );
});

test('every published weekly measure has interpretation metadata', () => {
  const metricCodes = [...metricDictionary.matchAll(/^\s{2}\(\r?\n\s{4}'([a-z_]+)',/gm)].map(match => match[1]);
  const expected = [
    'gross_shipped_units',
    'gross_shipped_gms',
    'gross_commission',
    'registered_return_units',
    'linked_return_units',
    'unlinked_return_units',
    'linked_return_gms',
    'linked_return_commission',
    'provisional_net_gms',
    'provisional_revenue_after_commission',
    'gross_shipped_asp',
    'product_visits',
    'trading_units_per_visit',
  ];
  assert.deepEqual(metricCodes, expected);
  assert.match(metricDictionary, /alter column unit set not null/);
  assert.match(metricDictionary, /alter column aggregation_method set not null/);
  assert.match(metricDictionary, /alter column readiness_rule set not null/);
});

test('an automated rerun cannot regress readiness or replace accounting approval', () => {
  assert.match(reportPromotionGuard, /existing\.accounting_status = 'approved'/);
  assert.match(reportPromotionGuard, /new\.accounting_status <> 'approved'/);
  assert.match(reportPromotionGuard, /end > new_readiness/);
  assert.match(reportPromotionGuard, /set is_active = true\s+where id = protected_report_id/s);
});

test('commission definitions treat shipment-line commission as a total amount', () => {
  assert.match(commissionDictionaryFix, /sum\(shipment_line_commission_amount\)/);
  assert.match(commissionDictionaryFix, /shipment line commission \/ matched shipment quantity/);
  assert.doesNotMatch(commissionDictionaryFix, /quantity_shipped \* shipment_line_commission/);
});

test('transform v2 is versioned consistently and backfills only the latest source per week', () => {
  assert.match(transformWorker, /const TRANSFORM_VERSION = "retailer-transform-v2"/);
  assert.doesNotMatch(transformWorker, /const TRANSFORM_VERSION = "retailer-transform-v1"/);
  assert.match(transformV2, /'retailer-transform-v2'/);
  assert.doesNotMatch(transformV2, /'retailer-transform-v1'/);
  assert.match(transformV2, /select distinct on \(run\.iso_year, run\.iso_week\)/);
  assert.match(transformV2, /run\.completed_at desc nulls last/);
  assert.match(transformV2, /run\.id desc/);
  assert.match(transformV2, /on conflict \(source_system, source_run_id, transform_version\) do nothing/);
  assert.match(transformV2, /status in \('queued', 'processing', 'retry_wait'\)/);
  assert.match(transformV2, /queue_length from pgmq\.metrics\('bol_retailer_transform'\)/);
});

test('a later data-product revision cannot replace a strictly better active revision', () => {
  assert.match(transformV2, /create trigger keep_best_active_data_product_revision/);
  assert.match(transformV2, /when 'ready' then 3/);
  assert.match(transformV2, /when 'ready_with_limits' then 2/);
  assert.match(transformV2, /when 'not_applicable' then 1/);
  assert.match(transformV2, /end > new_readiness/);
  assert.match(transformV2, /set is_active = false,\s+activated_at = null\s+where id = new\.id/s);
  assert.match(transformV2, /set is_active = true,\s+activated_at = coalesce\(activated_at, now\(\)\)\s+where id = better_revision_id/s);
});
