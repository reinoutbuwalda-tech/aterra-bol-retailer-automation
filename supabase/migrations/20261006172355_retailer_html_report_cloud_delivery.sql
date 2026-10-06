create table public.bol_retailer_html_report_runs (
  id uuid primary key default gen_random_uuid(),
  weekly_report_revision_id uuid not null unique references reporting.weekly_report_revisions(id) on delete cascade,
  iso_year integer not null,
  iso_week integer not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'failed')),
  report_status text check (report_status in ('ready', 'ready_with_limits', 'not_ready')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  storage_path text,
  hosted_url text,
  email_message_id text,
  error_stage text,
  error_detail text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bol_retailer_html_report_runs_week_check check (iso_year between 2020 and 2100 and iso_week between 1 and 53)
);

create unique index bol_retailer_html_report_runs_week_complete_idx
  on public.bol_retailer_html_report_runs (iso_year, iso_week)
  where status = 'complete';

alter table public.bol_retailer_html_report_runs enable row level security;
revoke all on public.bol_retailer_html_report_runs from public, anon, authenticated;
grant all on public.bol_retailer_html_report_runs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bol-retailer-html-reports', 'bol-retailer-html-reports', false, 5242880, array['text/html'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.queue_bol_retailer_html_report()
returns trigger
language plpgsql
security definer
set search_path = public, reporting, pg_temp
as $$
begin
  if new.is_active and new.status in ('ready', 'ready_with_limits', 'not_ready') then
    insert into public.bol_retailer_html_report_runs (weekly_report_revision_id, iso_year, iso_week, status, report_status)
    values (new.id, new.iso_year, new.iso_week, 'queued', new.status)
    on conflict (weekly_report_revision_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_bol_retailer_html_report() from public, anon, authenticated;

create trigger queue_bol_retailer_html_report_after_revision
after insert or update of is_active, status on reporting.weekly_report_revisions
for each row execute function public.queue_bol_retailer_html_report();

create or replace function public.claim_bol_retailer_html_report_job()
returns public.bol_retailer_html_report_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.bol_retailer_html_report_runs;
begin
  select * into claimed
  from public.bol_retailer_html_report_runs
  where status = 'queued' and attempts < 3 and next_attempt_at <= now()
  order by created_at
  for update skip locked
  limit 1;
  if claimed.id is null then return null; end if;
  update public.bol_retailer_html_report_runs
  set status = 'running', attempts = attempts + 1, started_at = now(), updated_at = now(), error_stage = null, error_detail = null
  where id = claimed.id
  returning * into claimed;
  return claimed;
end;
$$;

create or replace function public.fail_bol_retailer_html_report_job(p_run_id uuid, p_error_detail text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  update public.bol_retailer_html_report_runs
  set status = case when attempts < 3 then 'queued' else 'failed' end,
      next_attempt_at = case when attempts < 3 then now() + interval '15 minutes' else next_attempt_at end,
      error_stage = 'generation', error_detail = left(p_error_detail, 1000),
      completed_at = case when attempts < 3 then null else now() end,
      updated_at = now()
  where id = p_run_id and status = 'running';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.claim_bol_retailer_html_report_job() from public, anon, authenticated;
revoke all on function public.fail_bol_retailer_html_report_job(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_bol_retailer_html_report_job() to service_role;
grant execute on function public.fail_bol_retailer_html_report_job(uuid, text) to service_role;

create or replace function public.get_bol_retailer_html_report_payload(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, reporting, bol_retailer, pipeline, pg_temp
as $$
with report as (
  select * from reporting.weekly_report_revisions where id = p_revision_id
), period as (
  select source.period_start, source.period_end
  from reporting.weekly_revision_sources link
  join reporting.data_product_revisions product on product.id = link.data_product_revision_id
  join public.bol_retailer_api_extract_runs source on source.id = product.source_run_id
  where link.weekly_report_revision_id = p_revision_id
  limit 1
), ranks as (
  select rank.ean, rank.locale, rank.search_term, rank.was_sponsored,
         round(sum(rank.rank * greatest(rank.impressions, 0))::numeric / nullif(sum(greatest(rank.impressions, 0)), 0), 1) as weighted_rank,
         round(avg(rank.rank)::numeric, 1) as average_rank,
         min(rank.rank) as best_rank, max(rank.rank) as worst_rank,
         sum(rank.impressions) as impressions, count(*) as observations,
         count(distinct rank.rank_date) as days_observed
  from bol_retailer.keyword_rank_daily rank cross join period
  where rank.rank_date between period.period_start and period.period_end
  group by rank.ean, rank.locale, rank.search_term, rank.was_sponsored
)
select jsonb_build_object(
  'revision', to_jsonb(report),
  'summary', coalesce((select to_jsonb(summary) from reporting.current_weekly_summary summary where summary.weekly_report_revision_id = p_revision_id), '{}'::jsonb),
  'products', coalesce((select jsonb_agg(to_jsonb(metric) order by metric.ean) from reporting.current_weekly_product_metrics metric where metric.weekly_report_revision_id = p_revision_id), '[]'::jsonb),
  'dataProducts', coalesce((select jsonb_agg(to_jsonb(status) order by status.data_product) from reporting.current_data_product_status status where status.weekly_report_revision_id = p_revision_id), '[]'::jsonb),
  'exceptions', coalesce((select jsonb_agg(to_jsonb(exception) order by exception.opened_at) from reporting.current_weekly_exceptions exception where exception.weekly_report_revision_id = p_revision_id), '[]'::jsonb),
  'ranks', coalesce((select jsonb_agg(jsonb_build_object('ean', ean, 'locale', locale, 'search_term', search_term, 'was_sponsored', was_sponsored, 'weekly_rank', coalesce(weighted_rank, average_rank), 'best_rank', best_rank, 'worst_rank', worst_rank, 'impressions', impressions, 'observations', observations, 'days_observed', days_observed) order by ean, search_term, was_sponsored) from ranks), '[]'::jsonb)
)
from report;
$$;

revoke all on function public.get_bol_retailer_html_report_payload(uuid) from public, anon, authenticated;
grant execute on function public.get_bol_retailer_html_report_payload(uuid) to service_role;

insert into public.bol_retailer_html_report_runs (weekly_report_revision_id, iso_year, iso_week, status, report_status)
select revision.id, revision.iso_year, revision.iso_week, 'queued', revision.status
from (
  select id, iso_year, iso_week, status
  from reporting.weekly_report_revisions
  where is_active and status in ('ready', 'ready_with_limits')
  order by iso_year desc, iso_week desc, revision_number desc
  limit 1
) revision
on conflict (weekly_report_revision_id) do nothing;

comment on table public.bol_retailer_html_report_runs is 'Cloud HTML generation, hosting, email delivery, retry, and terminal status per Retailer report revision.';
