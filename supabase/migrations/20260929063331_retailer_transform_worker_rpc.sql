-- Service-role-only RPC boundary for the Retailer transform worker.
-- Claiming, publishing, and queue acknowledgement are all fenced by a lease token.

create or replace function pipeline.insert_fact_rows(
  p_fact_table text,
  p_rows jsonb,
  p_transform_run_id uuid,
  p_source_run_id uuid,
  p_default_observed_at timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_table regclass;
  fact jsonb;
  stored_fact_id uuid;
  inserted_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  target_table := case p_fact_table
    when 'orders' then 'bol_retailer.orders'::regclass
    when 'order_items' then 'bol_retailer.order_items'::regclass
    when 'outbound_shipments' then 'bol_retailer.outbound_shipments'::regclass
    when 'outbound_shipment_items' then 'bol_retailer.outbound_shipment_items'::regclass
    when 'return_cases' then 'bol_retailer.return_cases'::regclass
    when 'return_items' then 'bol_retailer.return_items'::regclass
    when 'return_status_observations' then 'bol_retailer.return_status_observations'::regclass
    when 'offer_observations' then 'bol_retailer.offer_observations'::regclass
    when 'offer_country_availability' then 'bol_retailer.offer_country_availability'::regclass
    when 'inventory_observations' then 'bol_retailer.inventory_observations'::regclass
    when 'offer_insight_daily' then 'bol_retailer.offer_insight_daily'::regclass
    when 'keyword_rank_daily' then 'bol_retailer.keyword_rank_daily'::regclass
    when 'commission_estimates' then 'bol_retailer.commission_estimates'::regclass
    when 'invoice_headers' then 'bol_retailer.invoice_headers'::regclass
    when 'invoice_transactions' then 'bol_retailer.invoice_transactions'::regclass
    else null
  end;

  if target_table is null then
    raise exception 'Unsupported fact table: %', p_fact_table using errcode = '22023';
  end if;

  execute format(
    'insert into %s select * from jsonb_populate_recordset(null::%s, $1)
     on conflict (business_key, semantic_hash) do nothing',
    target_table,
    target_table
  ) using p_rows;
  get diagnostics inserted_count = row_count;

  for fact in select value from jsonb_array_elements(p_rows)
  loop
    execute format(
      'select id from %s where business_key = $1 and semantic_hash = $2',
      target_table
    ) into strict stored_fact_id using fact->>'business_key', fact->>'semantic_hash';

    insert into pipeline.fact_sightings (
      transform_run_id,
      source_run_id,
      fact_table,
      fact_id,
      semantic_hash,
      artifact_name,
      source_pointer,
      observed_at
    ) values (
      p_transform_run_id,
      p_source_run_id,
      p_fact_table,
      stored_fact_id,
      fact->>'semantic_hash',
      fact->>'_artifact_name',
      fact->>'_source_pointer',
      coalesce(nullif(fact->>'_observed_at', '')::timestamptz, p_default_observed_at)
    )
    on conflict do nothing;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function pipeline.insert_fact_rows(text, jsonb, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function pipeline.insert_fact_rows(text, jsonb, uuid, uuid, timestamptz) to service_role;

create or replace function public.claim_bol_retailer_transform(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_message record;
  transform_id uuid;
  claimed pipeline.transform_runs%rowtype;
  source_run public.bol_retailer_api_extract_runs%rowtype;
  new_lease uuid := gen_random_uuid();
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required' using errcode = '22023';
  end if;

  select * into queue_message from pgmq.read('bol_retailer_transform', 900, 1) limit 1;
  if not found then
    return null;
  end if;

  begin
    transform_id := (queue_message.message->>'transformRunId')::uuid;
  exception when others then
    perform pgmq.archive('bol_retailer_transform', queue_message.msg_id);
    return jsonb_build_object('status', 'discarded', 'reason', 'invalid_transform_run_id', 'messageId', queue_message.msg_id);
  end;

  update pipeline.transform_runs
  set status = 'processing',
      attempt_count = attempt_count + 1,
      lease_token = new_lease,
      lease_expires_at = now() + interval '15 minutes',
      started_at = coalesce(started_at, now()),
      error_code = null,
      error_detail = null
  where id = transform_id
    and (
      status in ('queued', 'retry_wait')
      or (status = 'processing' and lease_expires_at < now())
    )
  returning * into claimed;

  if not found then
    if exists (select 1 from pipeline.transform_runs where id = transform_id and status in ('published', 'rejected')) then
      perform pgmq.archive('bol_retailer_transform', queue_message.msg_id);
      return jsonb_build_object('status', 'discarded', 'reason', 'already_terminal', 'messageId', queue_message.msg_id);
    end if;
    perform pgmq.set_vt('bol_retailer_transform', queue_message.msg_id, 60);
    return null;
  end if;

  select * into strict source_run
  from public.bol_retailer_api_extract_runs
  where id = claimed.source_run_id;

  insert into pipeline.transform_attempts (
    transform_run_id,
    attempt_number,
    queue_message_id,
    worker_id,
    lease_token
  ) values (
    claimed.id,
    claimed.attempt_count,
    queue_message.msg_id,
    p_worker_id,
    new_lease
  );

  return jsonb_build_object(
    'status', 'claimed',
    'messageId', queue_message.msg_id,
    'messageReadCount', queue_message.read_ct,
    'transformRunId', claimed.id,
    'sourceRunId', claimed.source_run_id,
    'sourceContractVersion', claimed.source_contract_version,
    'transformVersion', claimed.transform_version,
    'leaseToken', new_lease,
    'attemptNumber', claimed.attempt_count,
    'isoYear', claimed.iso_year,
    'isoWeek', claimed.iso_week,
    'periodStart', claimed.period_start,
    'periodEnd', claimed.period_end,
    'storageBucket', source_run.storage_bucket,
    'manifestPath', source_run.storage_path,
    'manifestSha256', source_run.snapshot_sha256,
    'sourceStatus', source_run.status,
    'sourceArtifactCount', source_run.artifact_count
  );
end;
$$;

revoke all on function public.claim_bol_retailer_transform(text) from public, anon, authenticated;
grant execute on function public.claim_bol_retailer_transform(text) to service_role;

create or replace function public.fail_bol_retailer_transform(
  p_transform_run_id uuid,
  p_lease_token uuid,
  p_message_id bigint,
  p_error_code text,
  p_error_detail text,
  p_retry_delay_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update pipeline.transform_runs
  set status = 'retry_wait',
      lease_token = null,
      lease_expires_at = null,
      error_code = left(p_error_code, 100),
      error_detail = left(p_error_detail, 4000)
  where id = p_transform_run_id
    and status = 'processing'
    and lease_token = p_lease_token;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update pipeline.transform_attempts
  set status = 'retryable_failure',
      completed_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer),
      error_code = left(p_error_code, 100),
      error_detail = left(p_error_detail, 4000)
  where transform_run_id = p_transform_run_id and lease_token = p_lease_token and status = 'processing';

  perform pgmq.set_vt('bol_retailer_transform', p_message_id, greatest(30, least(p_retry_delay_seconds, 86400)));
  return true;
end;
$$;

revoke all on function public.fail_bol_retailer_transform(uuid, uuid, bigint, text, text, integer) from public, anon, authenticated;
grant execute on function public.fail_bol_retailer_transform(uuid, uuid, bigint, text, text, integer) to service_role;

create or replace function public.reject_bol_retailer_transform(
  p_transform_run_id uuid,
  p_lease_token uuid,
  p_message_id bigint,
  p_error_code text,
  p_error_detail text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update pipeline.transform_runs
  set status = 'rejected',
      lease_token = null,
      lease_expires_at = null,
      error_code = left(p_error_code, 100),
      error_detail = left(p_error_detail, 4000),
      completed_at = now()
  where id = p_transform_run_id
    and status = 'processing'
    and lease_token = p_lease_token;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update pipeline.transform_attempts
  set status = 'rejected',
      completed_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer),
      error_code = left(p_error_code, 100),
      error_detail = left(p_error_detail, 4000)
  where transform_run_id = p_transform_run_id and lease_token = p_lease_token and status = 'processing';

  if not pgmq.archive('bol_retailer_transform', p_message_id) then
    raise exception 'Unable to archive rejected queue message %', p_message_id;
  end if;
  return true;
end;
$$;

revoke all on function public.reject_bol_retailer_transform(uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.reject_bol_retailer_transform(uuid, uuid, bigint, text, text) to service_role;

create or replace function public.publish_bol_retailer_transform(
  p_transform_run_id uuid,
  p_lease_token uuid,
  p_message_id bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row pipeline.transform_runs%rowtype;
  source_run public.bol_retailer_api_extract_runs%rowtype;
  item jsonb;
  fact_name text;
  inserted_facts integer := 0;
  revision_id uuid;
  revision_ids uuid[] := '{}';
  revision_number integer;
  report_id uuid;
  report_revision_number integer;
  report_payload jsonb;
  metric jsonb;
  mapped_product_id text;
begin
  select * into strict run_row
  from pipeline.transform_runs
  where id = p_transform_run_id
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > now()
  for update;

  select * into strict source_run
  from public.bol_retailer_api_extract_runs
  where id = run_row.source_run_id;

  if p_payload->>'sourceRunId' <> run_row.source_run_id::text
     or p_payload->>'transformVersion' <> run_row.transform_version
     or p_payload->>'sourceContractVersion' <> run_row.source_contract_version then
    raise exception 'Publication payload does not match the claimed transform run' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'artifacts', '[]'::jsonb))
  loop
    insert into pipeline.source_artifacts (
      transform_run_id, artifact_name, storage_bucket, storage_path,
      expected_sha256, actual_sha256, expected_bytes, actual_bytes,
      parse_status, row_count, error_detail, checked_at
    ) values (
      run_row.id,
      item->>'artifact_name',
      item->>'storage_bucket',
      item->>'storage_path',
      item->>'expected_sha256',
      item->>'actual_sha256',
      (item->>'expected_bytes')::bigint,
      (item->>'actual_bytes')::bigint,
      item->>'parse_status',
      nullif(item->>'row_count', '')::integer,
      nullif(item->>'error_detail', ''),
      coalesce(nullif(item->>'checked_at', '')::timestamptz, now())
    )
    on conflict (transform_run_id, artifact_name) do update set
      actual_sha256 = excluded.actual_sha256,
      actual_bytes = excluded.actual_bytes,
      parse_status = excluded.parse_status,
      row_count = excluded.row_count,
      error_detail = excluded.error_detail,
      checked_at = excluded.checked_at;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'steps', '[]'::jsonb))
  loop
    insert into pipeline.transform_steps (
      transform_run_id, step_code, status, input_count, output_count,
      output_sha256, started_at, completed_at, detail
    ) values (
      run_row.id,
      item->>'step_code',
      item->>'status',
      nullif(item->>'input_count', '')::integer,
      nullif(item->>'output_count', '')::integer,
      nullif(item->>'output_sha256', ''),
      nullif(item->>'started_at', '')::timestamptz,
      nullif(item->>'completed_at', '')::timestamptz,
      coalesce(item->'detail', '{}'::jsonb)
    )
    on conflict (transform_run_id, step_code) do update set
      status = excluded.status,
      input_count = excluded.input_count,
      output_count = excluded.output_count,
      output_sha256 = excluded.output_sha256,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      detail = excluded.detail;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'qualityChecks', '[]'::jsonb))
  loop
    insert into pipeline.quality_checks (
      transform_run_id, check_code, data_product, severity, result,
      expected, observed, message
    ) values (
      run_row.id,
      item->>'check_code',
      item->>'data_product',
      item->>'severity',
      item->>'result',
      item->'expected',
      item->'observed',
      item->>'message'
    )
    on conflict (transform_run_id, check_code) do update set
      data_product = excluded.data_product,
      severity = excluded.severity,
      result = excluded.result,
      expected = excluded.expected,
      observed = excluded.observed,
      message = excluded.message;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'exceptions', '[]'::jsonb))
  loop
    insert into pipeline.exceptions (
      id, transform_run_id, exception_code, data_product, severity,
      business_key, ean, title, detail, exposure_amount, evidence
    ) values (
      coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()),
      run_row.id,
      item->>'exception_code',
      item->>'data_product',
      item->>'severity',
      nullif(item->>'business_key', ''),
      nullif(item->>'ean', ''),
      item->>'title',
      item->>'detail',
      nullif(item->>'exposure_amount', '')::numeric,
      coalesce(item->'evidence', '{}'::jsonb)
    );
  end loop;

  foreach fact_name in array array[
    'orders', 'order_items', 'outbound_shipments', 'outbound_shipment_items',
    'return_cases', 'return_items', 'return_status_observations',
    'offer_observations', 'offer_country_availability', 'inventory_observations',
    'offer_insight_daily', 'keyword_rank_daily', 'commission_estimates',
    'invoice_headers', 'invoice_transactions'
  ]
  loop
    inserted_facts := inserted_facts + pipeline.insert_fact_rows(
      fact_name,
      coalesce(p_payload->'facts'->fact_name, '[]'::jsonb),
      run_row.id,
      run_row.source_run_id,
      coalesce(nullif(p_payload->>'generatedAt', '')::timestamptz, now())
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'dataProductRevisions', '[]'::jsonb))
  loop
    revision_id := coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid());
    select coalesce(max(r.revision_number), 0) + 1 into revision_number
    from reporting.data_product_revisions r
    where r.data_product = item->>'data_product'
      and r.iso_year = run_row.iso_year
      and r.iso_week = run_row.iso_week;

    if coalesce((item->>'is_active')::boolean, false) then
      update reporting.data_product_revisions
      set is_active = false
      where data_product = item->>'data_product'
        and iso_year = run_row.iso_year
        and iso_week = run_row.iso_week
        and is_active;
    end if;

    insert into reporting.data_product_revisions (
      id, data_product, iso_year, iso_week, revision_number, status,
      source_run_id, transform_run_id, formula_version, is_active,
      limitations, source_detail, activated_at
    ) values (
      revision_id,
      item->>'data_product',
      run_row.iso_year,
      run_row.iso_week,
      revision_number,
      item->>'status',
      run_row.source_run_id,
      run_row.id,
      item->>'formula_version',
      coalesce((item->>'is_active')::boolean, false),
      array(select jsonb_array_elements_text(coalesce(item->'limitations', '[]'::jsonb))),
      coalesce(item->'source_detail', '{}'::jsonb),
      case when coalesce((item->>'is_active')::boolean, false) then now() else null end
    );
    revision_ids := array_append(revision_ids, revision_id);
  end loop;

  report_payload := p_payload->'weeklyReport';
  if report_payload is not null and jsonb_typeof(report_payload) = 'object' then
    report_id := coalesce(nullif(report_payload->>'id', '')::uuid, gen_random_uuid());
    select coalesce(max(r.revision_number), 0) + 1 into report_revision_number
    from reporting.weekly_report_revisions r
    where r.iso_year = run_row.iso_year and r.iso_week = run_row.iso_week;

    update reporting.weekly_report_revisions
    set is_active = false
    where iso_year = run_row.iso_year and iso_week = run_row.iso_week and is_active;

    insert into reporting.weekly_report_revisions (
      id, iso_year, iso_week, revision_number, status, accounting_status, is_active
    ) values (
      report_id,
      run_row.iso_year,
      run_row.iso_week,
      report_revision_number,
      report_payload->>'status',
      'provisional',
      true
    );

    insert into reporting.weekly_revision_sources (weekly_report_revision_id, data_product_revision_id)
    select report_id, unnest(revision_ids);

    for metric in select value from jsonb_array_elements(coalesce(report_payload->'metrics', '[]'::jsonb))
    loop
      select a.product_id into mapped_product_id
      from bol_retailer.ean_product_assignments a
      where a.ean = metric->>'ean'
        and a.valid_from <= run_row.period_start
        and (a.valid_to is null or a.valid_to >= run_row.period_start)
      order by a.valid_from desc
      limit 1;

      insert into reporting.weekly_product_metrics (
        weekly_report_revision_id, product_id, ean,
        gross_shipped_units, gross_shipped_gms, gross_commission,
        registered_return_units, linked_return_units, unlinked_return_units,
        linked_return_gms, linked_return_commission,
        provisional_net_gms, provisional_revenue_after_commission,
        gross_shipped_asp, product_visits, trading_units_per_visit,
        commercial_status, visits_status, returns_status,
        limitations, calculation_trace
      ) values (
        report_id,
        mapped_product_id,
        metric->>'ean',
        coalesce((metric->>'gross_shipped_units')::integer, 0),
        coalesce((metric->>'gross_shipped_gms')::numeric, 0),
        coalesce((metric->>'gross_commission')::numeric, 0),
        coalesce((metric->>'registered_return_units')::integer, 0),
        coalesce((metric->>'linked_return_units')::integer, 0),
        coalesce((metric->>'unlinked_return_units')::integer, 0),
        coalesce((metric->>'linked_return_gms')::numeric, 0),
        coalesce((metric->>'linked_return_commission')::numeric, 0),
        coalesce((metric->>'provisional_net_gms')::numeric, 0),
        coalesce((metric->>'provisional_revenue_after_commission')::numeric, 0),
        nullif(metric->>'gross_shipped_asp', '')::numeric,
        nullif(metric->>'product_visits', '')::integer,
        nullif(metric->>'trading_units_per_visit', '')::numeric,
        metric->>'commercial_status',
        metric->>'visits_status',
        metric->>'returns_status',
        array(select jsonb_array_elements_text(coalesce(metric->'limitations', '[]'::jsonb))),
        coalesce(metric->'calculation_trace', '{}'::jsonb)
      );
    end loop;
  end if;

  update pipeline.transform_runs
  set status = 'published',
      lease_token = null,
      lease_expires_at = null,
      published_at = now(),
      completed_at = now(),
      error_code = null,
      error_detail = null
  where id = run_row.id and status = 'processing' and lease_token = p_lease_token;
  if not found then
    raise exception 'Transform lease was lost before publication';
  end if;

  update pipeline.transform_attempts
  set status = 'published',
      completed_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer)
  where transform_run_id = run_row.id and lease_token = p_lease_token and status = 'processing';

  if not pgmq.archive('bol_retailer_transform', p_message_id) then
    raise exception 'Unable to archive published queue message %', p_message_id;
  end if;

  return jsonb_build_object(
    'status', 'published',
    'transformRunId', run_row.id,
    'sourceRunId', run_row.source_run_id,
    'insertedFacts', inserted_facts,
    'dataProductRevisions', cardinality(revision_ids),
    'weeklyReportRevisionId', report_id
  );
end;
$$;

revoke all on function public.publish_bol_retailer_transform(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.publish_bol_retailer_transform(uuid, uuid, bigint, jsonb) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'aterra-bol-retailer-transform-worker') then
    perform cron.unschedule('aterra-bol-retailer-transform-worker');
  end if;
end $$;

select cron.schedule(
  'aterra-bol-retailer-transform-worker',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://kirawypbjqlabznjdbyh.supabase.co/functions/v1/bol-retailer-transform',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-aterra-cron-token', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'aterra_bol_retailer_cron_token'
      )
    ),
    body := jsonb_build_object('trigger', 'cron'),
    timeout_milliseconds := 120000
  ) as request_id;
  $job$
);

comment on function public.claim_bol_retailer_transform(text) is 'Service-role-only lease claim for one durable Retailer transform queue message.';
comment on function public.publish_bol_retailer_transform(uuid, uuid, bigint, jsonb) is 'Atomically publishes verified Retailer facts, lineage, quality checks, and report revisions, then archives the queue message.';
