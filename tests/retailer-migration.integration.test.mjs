import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.RETAILER_MIGRATION_DATABASE_URL;
const migration = readFileSync(
  new URL('../supabase/migrations/20260930155322_retailer_transform_v2_contract.sql', import.meta.url),
  'utf8',
);

function psql(sql, { expectFailure = false } = {}) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (expectFailure) {
    assert.notEqual(result.status, 0, `Expected SQL failure, but command succeeded:\n${result.stdout}`);
  } else {
    assert.equal(result.status, 0, `SQL failed:\n${result.stderr}\n${result.stdout}`);
  }
  return result;
}

function assertDedicatedDatabase() {
  const result = psql('select current_database();');
  assert.equal(
    result.stdout.trim(),
    'retailer_migration_ci',
    'Migration integration tests refuse to modify any database except retailer_migration_ci.',
  );
}

const setupSql = String.raw`
drop schema if exists reporting cascade;
drop schema if exists pipeline cascade;
drop schema if exists pgmq cascade;
drop table if exists public.bol_retailer_api_extract_runs cascade;
create schema reporting;
create schema pipeline;
create schema pgmq;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create table public.bol_retailer_api_extract_runs (
  id uuid primary key,
  status text not null,
  source_schema_version text,
  storage_path text,
  snapshot_sha256 text,
  artifact_count integer,
  iso_year integer not null,
  iso_week integer not null,
  period_start date not null,
  period_end date not null,
  started_at timestamptz not null,
  completed_at timestamptz
);

create table pipeline.transform_runs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'bol_retailer',
  source_run_id uuid not null,
  source_contract_version text not null,
  transform_version text not null,
  iso_year integer not null,
  iso_week integer not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'queued',
  unique (source_system, source_run_id, transform_version)
);

create table reporting.data_product_revisions (
  id uuid primary key,
  data_product text not null,
  iso_year integer not null,
  iso_week integer not null,
  revision_number integer not null,
  status text not null,
  is_active boolean not null default false,
  activated_at timestamptz
);
create unique index data_product_revisions_one_active_idx
  on reporting.data_product_revisions (data_product, iso_year, iso_week) where is_active;

create table pgmq.test_queue (
  msg_id bigint generated always as identity primary key,
  queue_name text not null,
  message jsonb not null
);
create function pgmq.metrics(p_queue_name text)
returns table(queue_length bigint)
language sql
as $$ select count(*)::bigint from pgmq.test_queue where queue_name = p_queue_name $$;
create function pgmq.send(p_queue_name text, p_message jsonb)
returns bigint
language plpgsql
as $$
declare sent_id bigint;
begin
  insert into pgmq.test_queue(queue_name, message) values (p_queue_name, p_message)
  returning msg_id into sent_id;
  return sent_id;
end;
$$;

create function pipeline.enqueue_bol_retailer_transform()
returns trigger
language plpgsql
as $$ begin perform 'retailer-transform-v1'; return new; end $$;
create trigger enqueue_bol_retailer_transform
  after update on public.bol_retailer_api_extract_runs
  for each row execute function pipeline.enqueue_bol_retailer_transform();
`;

function applyMigration() {
  psql(`begin;\n${migration}\ncommit;`);
}

const integrationTest = (name, fn) => test(name, {
  skip: databaseUrl ? false : 'requires psql and RETAILER_MIGRATION_DATABASE_URL; CI supplies PostgreSQL 16',
}, fn);

integrationTest('v2 migration cuts over queueing and preserves stronger active revisions', () => {
  assertDedicatedDatabase();
  psql(`${setupSql}
    insert into public.bol_retailer_api_extract_runs values
      ('00000000-0000-4000-8000-000000000001', 'complete', '3.0', 'old/manifest.json', repeat('a', 64), 7, 2026, 39, '2026-09-21', '2026-09-27', '2026-09-28T08:00:00Z', '2026-09-28T09:00:00Z'),
      ('00000000-0000-4000-8000-000000000002', 'complete', '3.0', 'new/manifest.json', repeat('b', 64), 7, 2026, 39, '2026-09-21', '2026-09-27', '2026-09-28T10:00:00Z', '2026-09-28T11:00:00Z');
  `);
  applyMigration();

  psql(String.raw`
    do $$ begin
      if (select count(*) from pipeline.transform_runs) <> 1 then
        raise exception 'expected exactly one latest historical transform';
      end if;
      if not exists (
        select 1 from pipeline.transform_runs
        where source_run_id = '00000000-0000-4000-8000-000000000002'
          and transform_version = 'retailer-transform-v2'
      ) then raise exception 'latest source was not queued as v2'; end if;
      if (select count(*) from pgmq.test_queue where message->>'transformVersion' = 'retailer-transform-v2') <> 1 then
        raise exception 'expected one v2 queue message';
      end if;
    end $$;

    delete from pgmq.test_queue;
    insert into public.bol_retailer_api_extract_runs values
      ('00000000-0000-4000-8000-000000000003', 'running', '3.0', null, null, null, 2026, 40, '2026-09-28', '2026-10-04', now(), null);
    update public.bol_retailer_api_extract_runs
      set status = 'complete', storage_path = 'future/manifest.json', snapshot_sha256 = repeat('c', 64), artifact_count = 7, completed_at = now()
      where id = '00000000-0000-4000-8000-000000000003';
    do $$ begin
      if not exists (
        select 1 from pipeline.transform_runs
        where source_run_id = '00000000-0000-4000-8000-000000000003'
          and transform_version = 'retailer-transform-v2'
      ) then raise exception 'future terminal source did not queue as v2'; end if;
    end $$;

    insert into reporting.data_product_revisions values
      ('10000000-0000-4000-8000-000000000001', 'product_visits', 2026, 39, 1, 'ready', true, now());
    update reporting.data_product_revisions set is_active = false where is_active;
    insert into reporting.data_product_revisions values
      ('10000000-0000-4000-8000-000000000002', 'product_visits', 2026, 39, 2, 'ready_with_limits', true, now());
    do $$ begin
      if (select id from reporting.data_product_revisions where is_active) <> '10000000-0000-4000-8000-000000000001'::uuid then
        raise exception 'weaker revision displaced stronger revision';
      end if;
    end $$;

    update reporting.data_product_revisions set is_active = false where is_active;
    insert into reporting.data_product_revisions values
      ('10000000-0000-4000-8000-000000000003', 'product_visits', 2026, 39, 3, 'ready', true, now());
    do $$ begin
      if (select id from reporting.data_product_revisions where is_active) <> '10000000-0000-4000-8000-000000000003'::uuid then
        raise exception 'equally ready newer revision did not become active';
      end if;
    end $$;

    update reporting.data_product_revisions set is_active = false where is_active;
    insert into reporting.data_product_revisions values
      ('10000000-0000-4000-8000-000000000004', 'product_visits', 2026, 39, 4, 'not_applicable', true, now());
    do $$ begin
      if (select id from reporting.data_product_revisions where is_active) <> '10000000-0000-4000-8000-000000000003'::uuid then
        raise exception 'weaker not-applicable revision displaced ready revision';
      end if;
    end $$;
  `);
});

integrationTest('migration guard leaves v1 intact when rollback preconditions are not met', () => {
  assertDedicatedDatabase();
  psql(`${setupSql}
    insert into public.bol_retailer_api_extract_runs values
      ('20000000-0000-4000-8000-000000000001', 'running', '3.0', null, null, null, 2026, 40, '2026-09-28', '2026-10-04', now(), null);
    insert into pipeline.transform_runs(source_run_id, source_contract_version, transform_version, iso_year, iso_week, period_start, period_end, status)
    values ('20000000-0000-4000-8000-000000000001', '3.0', 'retailer-transform-v1', 2026, 40, '2026-09-28', '2026-10-04', 'queued');
  `);
  psql(`begin;\n${migration}\ncommit;`, { expectFailure: true });
  psql(String.raw`
    do $$ begin
      if position('retailer-transform-v1' in pg_get_functiondef('pipeline.enqueue_bol_retailer_transform()'::regprocedure)) = 0 then
        raise exception 'guard failure changed the enqueue function';
      end if;
      if to_regprocedure('reporting.keep_best_active_data_product_revision()') is not null then
        raise exception 'guard failure left the v2 promotion function behind';
      end if;
    end $$;
  `);
});

integrationTest('backfill failure rolls the entire migration back', () => {
  assertDedicatedDatabase();
  psql(`${setupSql}
    insert into public.bol_retailer_api_extract_runs values
      ('30000000-0000-4000-8000-000000000001', 'complete', '3.0', 'source/manifest.json', repeat('d', 64), 7, 2026, 41, '2026-10-05', '2026-10-11', now(), now());
    create or replace function pgmq.send(p_queue_name text, p_message jsonb)
    returns bigint language plpgsql as $$ begin raise exception 'forced queue failure'; end $$;
  `);
  psql(`begin;\n${migration}\ncommit;`, { expectFailure: true });
  psql(String.raw`
    do $$ begin
      if position('retailer-transform-v1' in pg_get_functiondef('pipeline.enqueue_bol_retailer_transform()'::regprocedure)) = 0 then
        raise exception 'failed backfill did not restore the v1 function';
      end if;
      if exists (select 1 from pipeline.transform_runs) then
        raise exception 'failed backfill left transform rows behind';
      end if;
      if exists (select 1 from pgmq.test_queue) then
        raise exception 'failed backfill left queue messages behind';
      end if;
    end $$;
  `);
});
