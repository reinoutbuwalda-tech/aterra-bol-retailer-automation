-- Allow pg_net to receive the function result and retry only transient failures.

do $$
declare
  scheduled_job record;
  updated_command text;
begin
  for scheduled_job in
    select jobid, jobname, command
    from cron.job
    where jobname in (
      'aterra-bol-retailer-weekly-json-ams-0900-summer',
      'aterra-bol-retailer-weekly-json-ams-0900-winter',
      'aterra-bol-retailer-weekly-retry-ams-1000-summer',
      'aterra-bol-retailer-weekly-retry-ams-1000-winter'
    )
  loop
    updated_command := replace(
      scheduled_job.command,
      'timeout_milliseconds := 10000',
      'timeout_milliseconds := 120000'
    );
    if scheduled_job.jobname like '%-retry-%' and position('''retryOnly''' in updated_command) = 0 then
      updated_command := replace(
        updated_command,
        '''scheduleKey'', ''weekly-primary'',',
        '''scheduleKey'', ''weekly-primary'', ''retryOnly'', true,'
      );
    end if;
    perform cron.alter_job(job_id := scheduled_job.jobid, command := updated_command);
  end loop;
end $$;
