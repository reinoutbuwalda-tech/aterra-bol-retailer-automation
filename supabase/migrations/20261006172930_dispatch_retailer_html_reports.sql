do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'dispatch-bol-retailer-html-report';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'dispatch-bol-retailer-html-report',
  '*/5 * * * *',
  $job$
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
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) as request_id;
  $job$
);

comment on table public.bol_retailer_html_report_runs is
  'Cloud HTML generation, private hosting, email delivery, retries, and terminal status per Retailer report revision.';
