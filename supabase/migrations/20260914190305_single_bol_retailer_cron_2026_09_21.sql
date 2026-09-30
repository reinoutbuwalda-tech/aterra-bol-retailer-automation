-- Replace the recurring Retailer cron set with one cloud test run for
-- Monday 2026-09-21 09:00 Europe/Amsterdam, which is 07:00 UTC.

do $$
declare
  target_job_name text;
begin
  foreach target_job_name in array array[
    'aterra-bol-retailer-weekly-json-ams-0900-summer',
    'aterra-bol-retailer-weekly-json-ams-0900-winter',
    'aterra-bol-retailer-weekly-retry-ams-1000-summer',
    'aterra-bol-retailer-weekly-retry-ams-1000-winter',
    'aterra-bol-retailer-weekly-json-2026-09-21-ams-0900'
  ] loop
    if exists (select 1 from cron.job j where j.jobname = target_job_name) then
      perform cron.unschedule(target_job_name);
    end if;
  end loop;
end $$;

select cron.schedule(
  'aterra-bol-retailer-weekly-json-2026-09-21-ams-0900',
  '0 7 21 9 *',
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
      'scheduleKey', 'weekly-primary-2026-09-21',
      'schedule', 'one-time-2026-09-21-ams-0900'
    ),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
