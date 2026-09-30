-- One-off Retailer JSON extraction for Monday 2026-09-28 09:00 Europe/Amsterdam.
-- Amsterdam is UTC+2 on this date, so the pg_cron schedule runs at 07:00 UTC.
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'aterra-bol-retailer-weekly-json-2026-09-28-ams-0900'
  ) then
    perform cron.unschedule('aterra-bol-retailer-weekly-json-2026-09-28-ams-0900');
  end if;
end $$;

select cron.schedule(
  'aterra-bol-retailer-weekly-json-2026-09-28-ams-0900',
  '0 7 28 9 *',
  $job$
  do $run$
  declare
    cron_token text;
  begin
    if (now() at time zone 'Europe/Amsterdam')::date = date '2026-09-28' then
      select decrypted_secret into strict cron_token
      from vault.decrypted_secrets
      where name = 'aterra_bol_retailer_cron_token';

      if nullif(cron_token, '') is null then
        raise exception 'Retailer cron token is missing';
      end if;

      perform net.http_post(
        url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-weekly-extract',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-aterra-cron-token', cron_token
        ),
        body := jsonb_build_object(
          'trigger', 'cron',
          'expectedLocalHour', 9,
          'scheduleKey', 'weekly-primary-2026-09-28',
          'start', '2026-09-21',
          'end', '2026-09-27'
        ),
        timeout_milliseconds := 120000
      );
    end if;

    perform cron.alter_job(jobid, active := false)
    from cron.job
    where jobname = 'aterra-bol-retailer-weekly-json-2026-09-28-ams-0900';
  end $run$;
  $job$
);
