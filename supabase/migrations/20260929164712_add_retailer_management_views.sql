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
  count(distinct qc.id) filter (where qc.result = 'failed') as failed_checks,
  count(distinct qc.id) filter (where qc.result = 'warning') as warning_checks,
  count(distinct ex.id) filter (where ex.status = 'open') as open_exceptions
from pipeline.transform_runs tr
left join pipeline.quality_checks qc on qc.transform_run_id = tr.id
left join pipeline.exceptions ex on ex.transform_run_id = tr.id
group by tr.id;

create or replace view reporting.current_weekly_summary
with (security_invoker = true)
as
select
  report.id as weekly_report_revision_id,
  report.iso_year,
  report.iso_week,
  report.revision_number,
  report.status as report_status,
  report.accounting_status,
  count(*) as product_count,
  sum(metric.gross_shipped_units) as gross_shipped_units,
  sum(metric.gross_shipped_gms) as gross_shipped_gms,
  sum(metric.gross_commission) as gross_commission,
  sum(metric.registered_return_units) as registered_return_units,
  sum(metric.linked_return_units) as linked_return_units,
  sum(metric.unlinked_return_units) as unlinked_return_units,
  sum(metric.linked_return_gms) as linked_return_gms,
  sum(metric.linked_return_commission) as linked_return_commission,
  sum(metric.provisional_net_gms) as provisional_net_gms,
  sum(metric.provisional_revenue_after_commission) as provisional_revenue_after_commission,
  case
    when bool_and(metric.visits_status = 'ready') then sum(metric.product_visits)
    else null
  end as product_visits,
  case
    when bool_and(metric.visits_status = 'ready') then 'ready'
    when bool_or(metric.visits_status = 'ready_with_limits') then 'ready_with_limits'
    else 'not_ready'
  end as visits_status,
  report.generated_at
from reporting.weekly_report_revisions report
join reporting.weekly_product_metrics metric
  on metric.weekly_report_revision_id = report.id
where report.is_active
group by report.id;

create or replace view reporting.current_data_product_status
with (security_invoker = true)
as
select
  report.id as weekly_report_revision_id,
  report.iso_year,
  report.iso_week,
  report.revision_number as report_revision_number,
  report.status as report_status,
  revision.data_product,
  revision.revision_number as data_product_revision_number,
  revision.status as data_product_status,
  revision.formula_version,
  revision.limitations,
  revision.source_run_id,
  source.source_schema_version as source_contract_version,
  source.status as source_run_status,
  source.storage_bucket,
  source.storage_path as source_manifest_path,
  revision.transform_run_id,
  transform.transform_version,
  transform.status as transform_status,
  artifacts.artifact_count,
  artifacts.verified_artifact_count,
  coalesce(artifacts.all_artifacts_verified, false) as all_artifacts_verified,
  checks.failed_checks,
  checks.warning_checks,
  revision.source_detail,
  revision.activated_at
from reporting.weekly_report_revisions report
join reporting.weekly_revision_sources report_source
  on report_source.weekly_report_revision_id = report.id
join reporting.data_product_revisions revision
  on revision.id = report_source.data_product_revision_id
join public.bol_retailer_api_extract_runs source
  on source.id = revision.source_run_id
join pipeline.transform_runs transform
  on transform.id = revision.transform_run_id
left join lateral (
  select
    count(*) as artifact_count,
    count(*) filter (
      where artifact.parse_status = 'verified'
        and artifact.expected_sha256 = artifact.actual_sha256
        and artifact.expected_bytes = artifact.actual_bytes
    ) as verified_artifact_count,
    bool_and(
      artifact.parse_status = 'verified'
      and artifact.expected_sha256 = artifact.actual_sha256
      and artifact.expected_bytes = artifact.actual_bytes
    ) as all_artifacts_verified
  from pipeline.source_artifacts artifact
  where artifact.transform_run_id = revision.transform_run_id
) artifacts on true
left join lateral (
  select
    count(*) filter (where quality.result = 'failed') as failed_checks,
    count(*) filter (where quality.result = 'warning') as warning_checks
  from pipeline.quality_checks quality
  where quality.transform_run_id = revision.transform_run_id
    and quality.data_product = revision.data_product
) checks on true
where report.is_active;

create or replace view reporting.current_weekly_exceptions
with (security_invoker = true)
as
select distinct
  report.id as weekly_report_revision_id,
  report.iso_year,
  report.iso_week,
  report.revision_number,
  report.status as report_status,
  exception.id,
  exception.transform_run_id,
  exception.exception_code,
  exception.data_product,
  exception.severity,
  exception.business_key,
  exception.ean,
  exception.title,
  exception.detail,
  exception.exposure_amount,
  exception.evidence,
  exception.opened_at
from reporting.weekly_report_revisions report
join reporting.weekly_revision_sources report_source
  on report_source.weekly_report_revision_id = report.id
join reporting.data_product_revisions revision
  on revision.id = report_source.data_product_revision_id
join pipeline.exceptions exception
  on exception.transform_run_id = revision.transform_run_id
 and exception.status = 'open'
where report.is_active;

comment on view reporting.current_weekly_summary is
  'One understandable total row per active weekly report revision. Visits are null unless every product row is ready.';
comment on view reporting.current_data_product_status is
  'Readiness, limitations, source run, transform, and artifact verification for every data product used by the active weekly report.';
comment on view reporting.current_weekly_exceptions is
  'Open exceptions that belong to transforms used by the active weekly report revision.';

grant select on
  reporting.current_weekly_summary,
  reporting.current_data_product_status,
  reporting.current_weekly_exceptions
to service_role;
