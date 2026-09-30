-- Keep source extraction live, but do not schedule a known-failing Drive upload.
-- A follow-up migration may reactivate these jobs after Google secrets are verified.
do $$
declare
  job_name text;
begin
  foreach job_name in array array[
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
