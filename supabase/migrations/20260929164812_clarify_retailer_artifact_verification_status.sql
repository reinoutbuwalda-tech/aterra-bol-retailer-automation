drop view reporting.current_data_product_status;

create view reporting.current_data_product_status
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
  artifacts.integrity_verified_artifact_count,
  artifacts.parsed_artifact_count,
  artifacts.intentionally_unparsed_artifact_count,
  coalesce(artifacts.all_artifact_integrity_verified, false) as all_artifact_integrity_verified,
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
      where artifact.expected_sha256 = artifact.actual_sha256
        and artifact.expected_bytes = artifact.actual_bytes
    ) as integrity_verified_artifact_count,
    count(*) filter (where artifact.parse_status = 'verified') as parsed_artifact_count,
    count(*) filter (where artifact.parse_status = 'not_parsed') as intentionally_unparsed_artifact_count,
    bool_and(
      artifact.expected_sha256 = artifact.actual_sha256
      and artifact.expected_bytes = artifact.actual_bytes
    ) as all_artifact_integrity_verified
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

comment on view reporting.current_data_product_status is
  'Readiness, limitations, source run, transform, artifact integrity, and parsing scope for every data product used by the active weekly report.';

grant select on reporting.current_data_product_status to service_role;
