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

select cron.schedule(
  'aterra-retailer-drive-ams-0910-summer',
  '10 7 * * 1',
  $job$
  select net.http_post(
    url := 'https://aterra-retailer-drive-broker.vercel.app/api/cron/retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 9, 'encryptedRefreshToken', (select encrypted_refresh_token from public.google_connections where id = 'aterra-google')),
    timeout_milliseconds := 300000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-drive-ams-0910-winter',
  '10 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://aterra-retailer-drive-broker.vercel.app/api/cron/retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 9, 'encryptedRefreshToken', (select encrypted_refresh_token from public.google_connections where id = 'aterra-google')),
    timeout_milliseconds := 300000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-drive-retry-ams-1010-summer',
  '10 8 * * 1',
  $job$
  select net.http_post(
    url := 'https://aterra-retailer-drive-broker.vercel.app/api/cron/retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 10, 'retryOnly', true, 'encryptedRefreshToken', (select encrypted_refresh_token from public.google_connections where id = 'aterra-google')),
    timeout_milliseconds := 300000
  );
  $job$
);

select cron.schedule(
  'aterra-retailer-drive-retry-ams-1010-winter',
  '10 9 * * 1',
  $job$
  select net.http_post(
    url := 'https://aterra-retailer-drive-broker.vercel.app/api/cron/retailer-drive-backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aterra-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aterra_bol_retailer_cron_token')),
    body := jsonb_build_object('trigger', 'cron', 'expectedLocalHour', 10, 'retryOnly', true, 'encryptedRefreshToken', (select encrypted_refresh_token from public.google_connections where id = 'aterra-google')),
    timeout_milliseconds := 300000
  );
  $job$
);
