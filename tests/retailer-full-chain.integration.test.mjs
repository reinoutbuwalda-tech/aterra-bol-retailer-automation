import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.RETAILER_FULL_CHAIN_DATABASE_URL;
const migrationPath = process.env.RETAILER_V2_MIGRATION_PATH
  || new URL('../supabase/migrations/20260930155322_retailer_transform_v2_contract.sql', import.meta.url);

if (!databaseUrl) {
  throw new Error('Full-chain migration tests require RETAILER_FULL_CHAIN_DATABASE_URL for a disposable local Supabase database.');
}

const migration = readFileSync(migrationPath, 'utf8');

function psql(sql) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
    input: sql,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `SQL failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => {
      if (status === 0) resolve({ stdout, stderr });
      else reject(new Error(`Concurrent SQL failed with exit ${status}:\n${stderr}\n${stdout}`));
    });
    child.stdin.end(sql);
  });
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function assertDisposableSupabase() {
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '54322');
  assert.equal(target.pathname, '/postgres');
  assert.equal(
    psql('select current_database();'),
    'postgres',
    'Full-chain tests refuse to modify anything except the disposable local Supabase database at 127.0.0.1:54322/postgres.',
  );
}

test('the complete preceding migration chain exposes real pgmq and the v1 cutover state', () => {
  assertDisposableSupabase();
  const state = psql(String.raw`
    select concat_ws('|',
      (select extversion from pg_extension where extname = 'pgmq'),
      position('retailer-transform-v1' in pg_get_functiondef('pipeline.enqueue_bol_retailer_transform()'::regprocedure)),
      to_regprocedure('reporting.keep_best_active_data_product_revision()') is null
    );
  `);
  const [pgmqVersion, v1Position, protectorAbsent] = state.split('|');
  assert.ok(pgmqVersion);
  assert.ok(Number(v1Position) > 0, 'Preceding chain must still expose the v1 enqueue function.');
  assert.equal(protectorAbsent, 't', 'The v2 migration must not already be present in the preceding-chain database.');
});

test('real pgmq cutover blocks a concurrent source completion until v2 is committed', async () => {
  assertDisposableSupabase();
  psql(String.raw`
    truncate table public.bol_retailer_api_extract_runs cascade;
    select pgmq.purge_queue('bol_retailer_transform');
    insert into public.bol_retailer_api_extract_runs (
      id, status, source_schema_version, iso_year, iso_week, period_start, period_end,
      started_at, storage_path, snapshot_sha256, artifact_count
    ) values (
      '45000000-0000-4000-8000-000000000001', 'running', '3.0',
      2026, 43, '2026-10-19', '2026-10-25', now(), null, null, 0
    );
  `);

  const pausedMigration = migration.replace(
    'lock table pipeline.transform_runs in share row exclusive mode;',
    "lock table pipeline.transform_runs in share row exclusive mode;\nselect pg_sleep(2);",
  );
  const migrationSession = psqlAsync(`begin;\n${pausedMigration}\ncommit;`);
  await delay(400);
  const completionSession = psqlAsync(String.raw`
    update public.bol_retailer_api_extract_runs
    set status = 'complete', storage_path = 'retailer-api/year=2026/week=43/run=45000000-0000-4000-8000-000000000001/manifest.json',
        snapshot_sha256 = repeat('f', 64), artifact_count = 7, completed_at = now()
    where id = '45000000-0000-4000-8000-000000000001';
  `);
  await Promise.all([migrationSession, completionSession]);

  psql(String.raw`
    do $$ begin
      if exists (
        select 1 from pipeline.transform_runs
        where source_run_id = '45000000-0000-4000-8000-000000000001'
          and transform_version = 'retailer-transform-v1'
      ) then raise exception 'concurrent source completion enqueued v1'; end if;
      if not exists (
        select 1 from pipeline.transform_runs
        where source_run_id = '45000000-0000-4000-8000-000000000001'
          and transform_version = 'retailer-transform-v2'
      ) then raise exception 'concurrent source completion did not enqueue v2'; end if;
      if (select queue_length from pgmq.metrics('bol_retailer_transform')) <> 1 then
        raise exception 'real pgmq queue does not contain exactly one v2 message';
      end if;
    end $$;
  `);
});
