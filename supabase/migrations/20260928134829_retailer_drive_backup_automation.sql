create table if not exists public.bol_retailer_drive_backup_runs (
  id uuid primary key default gen_random_uuid(),
  source_run_id uuid not null references public.bol_retailer_api_extract_runs(id),
  status text not null check (status in ('running', 'complete', 'failed', 'skipped')),
  trigger_source text not null,
  iso_year integer not null,
  iso_week integer not null check (iso_week between 1 and 53),
  period_start date not null,
  period_end date not null,
  drive_year_folder_id text,
  drive_week_folder_id text,
  drive_week_folder_url text,
  drive_source_folder_id text,
  drive_report_folder_id text,
  google_sheet_id text,
  google_sheet_url text,
  artifact_count integer not null default 0,
  total_bytes bigint not null default 0,
  checksums_verified boolean not null default false,
  error_stage text,
  error_detail text,
  duration_ms integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_run_id),
  check (drive_week_folder_url is null or drive_week_folder_url ~ '^https://drive[.]google[.]com/'),
  check (google_sheet_url is null or google_sheet_url ~ '^https://docs[.]google[.]com/spreadsheets/')
);

create index if not exists bol_retailer_drive_backup_week_idx
  on public.bol_retailer_drive_backup_runs (iso_year desc, iso_week desc, started_at desc);

alter table public.bol_retailer_drive_backup_runs enable row level security;
revoke all on public.bol_retailer_drive_backup_runs from anon, authenticated;
grant all on public.bol_retailer_drive_backup_runs to service_role;

comment on table public.bol_retailer_drive_backup_runs is
  'Operational log for verified Supabase-to-Google-Drive Retailer source backups and human review Sheets.';

do $$
declare
  job_name text;
begin
  foreach job_name in array array[
    'aterra-retailer-extract-ams-0900-summer',
    'aterra-retailer-extract-ams-0900-winter',
    'aterra-retailer-extract-retry-ams-1000-summer',
    'aterra-retailer-extract-retry-ams-1000-winter',
    'aterra-retailer-drive-ams-0910-summer',
    'aterra-retailer-drive-ams-0910-winter',
    'aterra-retailer-drive-retry-ams-1010-summer',
    'aterra-retailer-drive-retry-ams-1010-winter'
  ]
  loop
    if exists (select 1 from cron.job where jobname = job_name) then
      perform cron.unschedule(job_name);
    end if;
  end loop;
end $$;

select cron.schedule(
  'aterra-retailer-extract-ams-0900-summer',
  '0 7 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 9, 'scheduleKey', 'weekly-primary'),
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-extract-ams-0900-winter',
  '0 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 9, 'scheduleKey', 'weekly-primary'),
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-extract-retry-ams-1000-summer',
  '0 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 10, 'scheduleKey', 'weekly-primary', 'retryOnly', true),
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-extract-retry-ams-1000-winter',
  '0 9 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 10, 'scheduleKey', 'weekly-primary', 'retryOnly', true),
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-drive-ams-0910-summer',
  '10 7 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 9),
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-drive-ams-0910-winter',
  '10 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 9),
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-drive-retry-ams-1010-summer',
  '10 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 10, 'retryOnly', true),
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-drive-retry-ams-1010-winter',
  '10 9 * * 1',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 10, 'retryOnly', true),
    timeout_milliseconds := 120000
  );
  $job$
);
