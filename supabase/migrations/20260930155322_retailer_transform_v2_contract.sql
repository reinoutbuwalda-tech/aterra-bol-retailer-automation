-- Switch future Retailer snapshots to transform v2 and enqueue one auditable v2
-- candidate from the latest contract-3.0 source for each historical week.
-- Deploy the v2 Edge worker first, and only while the transform queue is empty.
-- Supabase applies each migration in one transaction. SHARE ROW EXCLUSIVE conflicts
-- with the ROW EXCLUSIVE lock taken by source-run completion updates and transform
-- claims/inserts, and both locks remain held until that migration transaction commits.
lock table public.bol_retailer_api_extract_runs in share row exclusive mode;
lock table pipeline.transform_runs in share row exclusive mode;

-- Recheck every cutover precondition only after concurrent producers/workers are blocked.

do $$
begin
  if exists (
    select 1
    from pipeline.transform_runs
    where status in ('queued', 'processing', 'retry_wait')
  ) then
    raise exception 'Cannot switch to retailer-transform-v2 while transform runs are nonterminal';
  end if;

  if (select queue_length from pgmq.metrics('bol_retailer_transform')) <> 0 then
    raise exception 'Cannot switch to retailer-transform-v2 while the transform queue is nonempty';
  end if;
end;
$$;

create or replace function reporting.keep_best_active_data_product_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  better_revision_id uuid;
  new_readiness integer;
begin
  if not new.is_active then
    return new;
  end if;

  new_readiness := case new.status
    when 'ready' then 3
    when 'ready_with_limits' then 2
    when 'not_applicable' then 1
    else 0
  end;

  select revision.id
  into better_revision_id
  from reporting.data_product_revisions revision
  where revision.data_product = new.data_product
    and revision.iso_year = new.iso_year
    and revision.iso_week = new.iso_week
    and revision.id <> new.id
    and case revision.status
      when 'ready' then 3
      when 'ready_with_limits' then 2
      when 'not_applicable' then 1
      else 0
    end > new_readiness
  order by
    case revision.status
      when 'ready' then 3
      when 'ready_with_limits' then 2
      when 'not_applicable' then 1
      else 0
    end desc,
    revision.revision_number desc
  limit 1
  for update;

  if better_revision_id is not null then
    update reporting.data_product_revisions
    set is_active = false,
        activated_at = null
    where id = new.id;

    update reporting.data_product_revisions
    set is_active = true,
        activated_at = coalesce(activated_at, now())
    where id = better_revision_id;
  end if;

  return new;
end;
$$;

revoke all on function reporting.keep_best_active_data_product_revision()
from public, anon, authenticated;

drop trigger if exists keep_best_active_data_product_revision
on reporting.data_product_revisions;

create trigger keep_best_active_data_product_revision
after insert on reporting.data_product_revisions
for each row execute function reporting.keep_best_active_data_product_revision();

comment on function reporting.keep_best_active_data_product_revision() is
  'Keeps a strictly higher-readiness data-product revision active when a later automated revision is weaker.';

create or replace function pipeline.enqueue_bol_retailer_transform()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transform_id uuid;
begin
  if old.status = 'running'
     and new.status in ('complete', 'partial')
     and new.source_schema_version = '3.0'
     and new.storage_path is not null
     and new.snapshot_sha256 is not null
     and new.artifact_count = 7 then
    insert into pipeline.transform_runs (
      source_run_id,
      source_contract_version,
      transform_version,
      iso_year,
      iso_week,
      period_start,
      period_end
    ) values (
      new.id,
      new.source_schema_version,
      'retailer-transform-v2',
      new.iso_year,
      new.iso_week,
      new.period_start,
      new.period_end
    )
    on conflict (source_system, source_run_id, transform_version) do nothing
    returning id into transform_id;

    if transform_id is not null then
      perform pgmq.send(
        'bol_retailer_transform',
        jsonb_build_object(
          'transformRunId', transform_id,
          'sourceRunId', new.id,
          'sourceContractVersion', new.source_schema_version,
          'transformVersion', 'retailer-transform-v2'
        )
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function pipeline.enqueue_bol_retailer_transform()
from public, anon, authenticated;

comment on function pipeline.enqueue_bol_retailer_transform() is
  'Queues terminal Retailer source contract 3.0 runs for the immutable retailer-transform-v2 logic.';

do $$
declare
  source_run record;
  transform_id uuid;
begin
  for source_run in
    select distinct on (run.iso_year, run.iso_week)
      run.id,
      run.source_schema_version,
      run.iso_year,
      run.iso_week,
      run.period_start,
      run.period_end
    from public.bol_retailer_api_extract_runs run
    where run.status in ('complete', 'partial')
      and run.source_schema_version = '3.0'
      and run.storage_path is not null
      and run.snapshot_sha256 is not null
      and run.artifact_count = 7
    order by run.iso_year, run.iso_week, run.completed_at desc nulls last, run.started_at desc, run.id desc
  loop
    transform_id := null;
    insert into pipeline.transform_runs (
      source_run_id,
      source_contract_version,
      transform_version,
      iso_year,
      iso_week,
      period_start,
      period_end
    ) values (
      source_run.id,
      source_run.source_schema_version,
      'retailer-transform-v2',
      source_run.iso_year,
      source_run.iso_week,
      source_run.period_start,
      source_run.period_end
    )
    on conflict (source_system, source_run_id, transform_version) do nothing
    returning id into transform_id;

    if transform_id is not null then
      perform pgmq.send(
        'bol_retailer_transform',
        jsonb_build_object(
          'transformRunId', transform_id,
          'sourceRunId', source_run.id,
          'sourceContractVersion', source_run.source_schema_version,
          'transformVersion', 'retailer-transform-v2'
        )
      );
    end if;
  end loop;
end;
$$;
