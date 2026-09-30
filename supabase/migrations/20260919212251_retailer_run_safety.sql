-- Enforce one active extraction per reporting week, including manual invocations.
create unique index if not exists bol_retailer_one_running_week_idx
  on public.bol_retailer_api_extract_runs (iso_year, iso_week)
  where status = 'running';

-- The date guard includes the year. Disable after enqueueing, in the same transaction.
select cron.schedule(
  'aterra-bol-retailer-weekly-json-2026-09-21-ams-0900',
  '0 7 21 9 *',
  $job$
  do $run$
  declare
    cron_token text;
  begin
    if (now() at time zone 'Europe/Amsterdam')::date = date '2026-09-21' then
      select decrypted_secret into strict cron_token from vault.decrypted_secrets
        where name = 'aterra_bol_retailer_cron_token';
      if nullif(cron_token, '') is null then
        raise exception 'Retailer cron token is missing';
      end if;
      perform net.http_post(
        url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', cron_token),
        body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 9,
          'scheduleKey', 'weekly-primary-2026-09-21', 'start', '2026-09-14', 'end', '2026-09-20'),
        timeout_milliseconds := 120000
      );
    end if;
    perform cron.alter_job(jobid, active := false) from cron.job
      where jobname = 'aterra-bol-retailer-weekly-json-2026-09-21-ams-0900';
  end $run$;
  $job$
);
