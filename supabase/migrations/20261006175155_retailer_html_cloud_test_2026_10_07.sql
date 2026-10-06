do $$
begin
  if exists (
    select 1 from cron.job
    where jobname = 'test-bol-retailer-html-cloud-2026-10-07-0900-ams'
  ) then
    perform cron.unschedule('test-bol-retailer-html-cloud-2026-10-07-0900-ams');
  end if;
end;
$$;

select cron.schedule(
  'test-bol-retailer-html-cloud-2026-10-07-0900-ams',
  '0 7 7 10 *',
  $job$
    update public.bol_retailer_html_report_runs
    set status = 'queued',
        attempts = 0,
        next_attempt_at = now(),
        storage_path = null,
        hosted_url = null,
        email_message_id = null,
        error_stage = null,
        error_detail = null,
        started_at = null,
        completed_at = null,
        updated_at = now()
    where iso_year = 2026
      and iso_week = 40
      and status = 'complete'
      and (now() at time zone 'Europe/Amsterdam')::date = date '2026-10-07';

    select net.http_post(
      url := 'https://aterra-retailer-reports.vercel.app/api/internal/generate',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-aterra-report-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'aterra_bol_retailer_cron_token'
        )
      ),
      body := jsonb_build_object('trigger', 'one_off_cloud_test', 'isoYear', 2026, 'isoWeek', 40),
      timeout_milliseconds := 300000
    );

    select cron.unschedule('test-bol-retailer-html-cloud-2026-10-07-0900-ams');
  $job$
);
