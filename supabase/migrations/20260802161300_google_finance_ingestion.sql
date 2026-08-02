alter table public.source_files
  add column if not exists origin_channel text,
  add column if not exists gmail_message_id text,
  add column if not exists gmail_attachment_id text,
  add column if not exists drive_version text,
  add column if not exists drive_modified_at timestamptz,
  add column if not exists drive_web_view_link text,
  add column if not exists original_metadata jsonb not null default '{}'::jsonb;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'text/csv', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/xml', 'text/xml', 'image/png', 'image/jpeg'
]
where id = 'financial-evidence';

create unique index if not exists source_files_gmail_attachment_idx
  on public.source_files (gmail_message_id, gmail_attachment_id)
  where gmail_message_id is not null and gmail_attachment_id is not null;

create unique index if not exists source_files_drive_version_idx
  on public.source_files (drive_file_id, drive_version)
  where drive_file_id is not null and drive_version is not null;

create table public.google_connections (
  id text primary key,
  account_email text not null unique check (lower(account_email) = 'aterra.eu@gmail.com'),
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  status text not null check (status in ('connected', 'refresh_required', 'revoked', 'error')),
  connected_by text not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.monitored_folders (
  id text primary key,
  drive_folder_id text not null unique,
  folder_name text not null,
  provider_id text references public.source_providers(id),
  folder_role text not null check (folder_role in ('intake', 'accepted', 'exception')),
  active boolean not null default true,
  expected_cadence text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monitored_folders_active_idx on public.monitored_folders (active, provider_id);

create table public.sync_cursors (
  source text primary key check (source in ('gmail', 'drive')),
  cursor_value text,
  watch_expires_at timestamptz,
  watch_channel_id text,
  watch_resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_channel text not null check (source_channel in ('gmail', 'drive', 'manual', 'recovery')),
  job_type text not null check (job_type in ('gmail_sync', 'gmail_attachment', 'drive_sync', 'drive_file', 'watch_renewal')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingestion_jobs_work_idx on public.ingestion_jobs (status, available_at, created_at);
create index ingestion_jobs_source_idx on public.ingestion_jobs (source_channel, job_type, created_at desc);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('gmail', 'drive', 'recovery')),
  status text not null check (status in ('running', 'completed', 'failed')),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  queued_count integer not null default 0 check (queued_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  details jsonb not null default '{}'::jsonb
);

create index sync_runs_source_idx on public.sync_runs (source, started_at desc);

create table public.document_fingerprints (
  id uuid primary key default gen_random_uuid(),
  source_file_id text not null references public.source_files(id),
  fingerprint text not null unique,
  supplier_vat_id text,
  invoice_number text,
  invoice_date date,
  currency char(3),
  gross_amount numeric(18,2),
  created_at timestamptz not null default now()
);

create index document_fingerprints_invoice_idx
  on public.document_fingerprints (supplier_vat_id, invoice_number, invoice_date);

alter table public.google_connections enable row level security;
alter table public.monitored_folders enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.sync_runs enable row level security;
alter table public.document_fingerprints enable row level security;

revoke all on public.google_connections, public.monitored_folders, public.sync_cursors, public.ingestion_jobs, public.sync_runs, public.document_fingerprints from anon, authenticated;
grant all on public.google_connections, public.monitored_folders, public.sync_cursors, public.ingestion_jobs, public.sync_runs, public.document_fingerprints to service_role;

insert into public.source_providers (id, name, category, status)
values ('gmail-finance', 'Aterra Gmail', 'evidence-channel', 'active')
on conflict (id) do update set name = excluded.name, category = excluded.category, status = excluded.status;

insert into public.monitored_folders (id, drive_folder_id, folder_name, provider_id, folder_role, expected_cadence, metadata) values
  ('intake-gmail', '17uNvRq8OGvteUHvV9lt3gVdU5ZWzF-CJ', 'Gmail Attachments', 'gmail-finance', 'intake', 'event-driven', '{"source":"gmail-api","account":"aterra.eu@gmail.com"}'),
  ('intake-bol', '19cTVPfFpfQQlCyQW3wXebcBz2vrOIMP9', 'Bol', 'bol', 'intake', 'every 14 days', '{"authoritative_for":"marketplace revenue exports"}'),
  ('intake-marktmentor', '1G0ff8c9cD83NtkjS8bknAAUdAz3TZ5w8', 'Marktmentor', 'marktmentor', 'intake', 'monthly', '{"role":"supporting commercial evidence"}'),
  ('intake-tien', '1Eue8EippCi_MVW3hGtIkE9z3SNxMBz_D', 'Tien Fulfilment', 'tien', 'intake', 'event-driven', '{"preferred_format":"UBL 2.1 XML"}'),
  ('intake-import4you', '1ksFFslX1bKaGX7AhzVTCcoNPzS1cp1qs', 'Import 4 You', 'import-4-you', 'intake', 'event-driven', '{"duplicate_risk":"invoice and reminder copies"}'),
  ('intake-bank', '1af3Id5T1mWCx6LMF5wLPam-1pOIZrfaS', 'Bank Statements', 'knab', 'intake', 'monthly', '{"preferred_formats":["CAMT","MT940","CSV"]}'),
  ('intake-manual', '14W6VfyXXuEkLSqbzRbzTxbjko8uCO94s', 'Manual Uploads', null, 'intake', 'ad hoc', '{}'),
  ('accepted-originals', '1kNITTRinVxx8ZyqUSEljFPA2fOzq2uIQ', 'Accepted Originals', null, 'accepted', null, '{}'),
  ('exception-originals', '1rMXgjyTrico54AmszX488gR1qj915_Ej', 'Exceptions', null, 'exception', null, '{}')
on conflict (id) do update set
  drive_folder_id = excluded.drive_folder_id,
  folder_name = excluded.folder_name,
  provider_id = excluded.provider_id,
  folder_role = excluded.folder_role,
  expected_cadence = excluded.expected_cadence,
  metadata = excluded.metadata,
  active = true,
  updated_at = now();
