-- Cloud-native foundation for weekly Bol Retailer API JSON extraction.
-- This migration creates durable storage/logging and schedules the extractor.

create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bol-retailer-api-json',
  'bol-retailer-api-json',
  false,
  52428800,
  array['application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.bol_retailer_api_extract_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null default 'weekly',
  trigger_source text not null default 'cron',
  status text not null default 'running',
  iso_year integer not null,
  iso_week integer not null,
  period_start date not null,
  period_end date not null,
  timezone text not null default 'Europe/Amsterdam',
  storage_bucket text not null default 'bol-retailer-api-json',
  storage_path text,
  snapshot_sha256 text,
  api_call_count integer not null default 0,
  api_error_count integer not null default 0,
  product_count integer not null default 0,
  warning_count integer not null default 0,
  warnings text[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  completeness jsonb not null default '{}'::jsonb,
  error_stage text,
  error_code text,
  error_detail text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  invocation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bol_retailer_extract_status_check
    check (status in ('running', 'complete', 'failed', 'skipped')),
  constraint bol_retailer_extract_period_check
    check (period_start <= period_end),
  constraint bol_retailer_extract_week_check
    check (iso_year between 2020 and 2100 and iso_week between 1 and 53)
);

create index if not exists bol_retailer_extract_week_idx
  on public.bol_retailer_api_extract_runs (iso_year desc, iso_week desc, started_at desc);

create index if not exists bol_retailer_extract_status_idx
  on public.bol_retailer_api_extract_runs (status, started_at desc);

create unique index if not exists bol_retailer_extract_one_running_week_idx
  on public.bol_retailer_api_extract_runs (run_kind, iso_year, iso_week)
  where status = 'running';

alter table public.bol_retailer_api_extract_runs enable row level security;
revoke all on public.bol_retailer_api_extract_runs from anon, authenticated;
grant all on public.bol_retailer_api_extract_runs to service_role;

create or replace function public.set_bol_retailer_extract_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_bol_retailer_extract_updated_at() from public, anon, authenticated;
grant execute on function public.set_bol_retailer_extract_updated_at() to service_role;

drop trigger if exists bol_retailer_extract_runs_updated_at on public.bol_retailer_api_extract_runs;
create trigger bol_retailer_extract_runs_updated_at
before update on public.bol_retailer_api_extract_runs
for each row execute function public.set_bol_retailer_extract_updated_at();

comment on table public.bol_retailer_api_extract_runs is
  'Run log for cloud-native weekly Bol Retailer API JSON extraction. Stores status and Storage object pointers only; raw JSON lives in Supabase Storage.';

comment on column public.bol_retailer_api_extract_runs.storage_path is
  'Path in private Storage bucket bol-retailer-api-json for the sanitized full JSON snapshot.';

-- Supabase Cron runs in UTC. Amsterdam 09:00 is 07:00 UTC during CEST and
-- 08:00 UTC during CET. Schedule both and let the Edge Function no-op unless
-- Amsterdam local time is Monday 09:00. This avoids DST drift.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'aterra-bol-retailer-weekly-json-ams-0900-summer') then
    perform cron.unschedule('aterra-bol-retailer-weekly-json-ams-0900-summer');
  end if;
  if exists (select 1 from cron.job where jobname = 'aterra-bol-retailer-weekly-json-ams-0900-winter') then
    perform cron.unschedule('aterra-bol-retailer-weekly-json-ams-0900-winter');
  end if;
end $$;

select cron.schedule(
  'aterra-bol-retailer-weekly-json-ams-0900-summer',
  '0 7 * * 1',
  $$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-aterra-cron-token', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'aterra_bol_retailer_cron_token'
      )
    ),
    body := jsonb_build_object(
      'trigger', 'cron',
      'schedule', 'ams-0900-summer'
    )
  ) as request_id;
  $$
);

select cron.schedule(
  'aterra-bol-retailer-weekly-json-ams-0900-winter',
  '0 8 * * 1',
  $$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-aterra-cron-token', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'aterra_bol_retailer_cron_token'
      )
    ),
    body := jsonb_build_object(
      'trigger', 'cron',
      'schedule', 'ams-0900-winter'
    )
  ) as request_id;
  $$
);
