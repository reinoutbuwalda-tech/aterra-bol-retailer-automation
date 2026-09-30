-- Reliability hardening for the cloud-native Bol Retailer JSON foundation.

alter table public.bol_retailer_api_extract_runs
  add column if not exists schedule_key text,
  add column if not exists source_schema_version text not null default '1.0',
  add column if not exists artifact_count integer not null default 0,
  add column if not exists dataset_status jsonb not null default '{}'::jsonb,
  add column if not exists last_heartbeat_at timestamptz;

alter table public.bol_retailer_api_extract_runs
  drop constraint if exists bol_retailer_extract_status_check;

alter table public.bol_retailer_api_extract_runs
  add constraint bol_retailer_extract_status_check
  check (status in ('running', 'complete', 'partial', 'failed', 'skipped'));

create index if not exists bol_retailer_extract_schedule_key_idx
  on public.bol_retailer_api_extract_runs (schedule_key, iso_year desc, iso_week desc, started_at desc)
  where schedule_key is not null;

do $$
declare
  target_job_name text;
begin
  foreach target_job_name in array array[
    'aterra-bol-retailer-weekly-json-ams-0900-summer',
    'aterra-bol-retailer-weekly-json-ams-0900-winter',
    'aterra-bol-retailer-weekly-retry-ams-1000-summer',
    'aterra-bol-retailer-weekly-retry-ams-1000-winter'
  ] loop
    if exists (select 1 from cron.job j where j.jobname = target_job_name) then
      perform cron.unschedule(target_job_name);
    end if;
  end loop;
end $$;

select cron.schedule(
  'aterra-bol-retailer-weekly-json-ams-0900-summer',
  '0 7 * * 1',
  $$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')
    ),
    body := jsonb_build_object(
      'trigger', 'cron',
      'expectedLocalHour', 9,
      'scheduleKey', 'weekly-primary',
      'schedule', 'ams-0900-summer'
    ),
    timeout_milliseconds := 120000
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
      'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')
    ),
    body := jsonb_build_object(
      'trigger', 'cron',
      'expectedLocalHour', 9,
      'scheduleKey', 'weekly-primary',
      'schedule', 'ams-0900-winter'
    ),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

select cron.schedule(
  'aterra-bol-retailer-weekly-retry-ams-1000-summer',
  '0 8 * * 1',
  $$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')
    ),
    body := jsonb_build_object(
      'trigger', 'cron',
      'expectedLocalHour', 10,
      'scheduleKey', 'weekly-primary',
      'retryOnly', true,
      'schedule', 'ams-1000-retry-summer'
    ),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

select cron.schedule(
  'aterra-bol-retailer-weekly-retry-ams-1000-winter',
  '0 9 * * 1',
  $$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')
    ),
    body := jsonb_build_object(
      'trigger', 'cron',
      'expectedLocalHour', 10,
      'scheduleKey', 'weekly-primary',
      'retryOnly', true,
      'schedule', 'ams-1000-retry-winter'
    ),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
