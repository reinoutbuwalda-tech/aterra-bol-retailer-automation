create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

create table public.exceptions (
  id text primary key,
  title text not null,
  severity text not null check (severity in ('high', 'medium', 'low')),
  status text not null check (status in ('open', 'resolved')),
  source text not null,
  detail text not null,
  owner text not null,
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index exceptions_status_idx on public.exceptions (status, id);

create table public.legal_entities (
  id text primary key,
  legal_name text not null,
  trading_name text,
  legal_form text not null,
  kvk text not null unique,
  rsin text,
  vat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_users (
  email text primary key,
  display_name text not null,
  role text not null check (role in ('owner', 'architect', 'accountant')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_providers (
  id text primary key,
  name text not null,
  category text not null,
  active_from date,
  active_to date,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_files (
  id text primary key,
  provider_id text references public.source_providers(id),
  file_name text not null,
  drive_path text not null,
  drive_file_id text,
  object_key text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text,
  period_start date,
  period_end date,
  received_at timestamptz not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sha256)
);

create index source_files_period_idx on public.source_files (period_start, period_end);
create index source_files_provider_idx on public.source_files (provider_id);

create table public.ingestion_runs (
  id text primary key,
  source_file_id text not null references public.source_files(id),
  adapter text not null,
  adapter_version text not null,
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_accepted integer not null default 0 check (rows_accepted >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  status text not null,
  started_at timestamptz not null,
  completed_at timestamptz
);

create index ingestion_runs_source_file_idx on public.ingestion_runs (source_file_id);

create table public.marketplace_daily (
  id text primary key,
  source_file_id text not null references public.source_files(id),
  sales_date date not null,
  ean text not null,
  revenue numeric(18,2) not null,
  sales integer not null,
  orders integer not null,
  visits integer not null,
  row_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sales_date, ean, row_hash)
);

create index marketplace_daily_source_file_idx on public.marketplace_daily (source_file_id);
create index marketplace_daily_period_idx on public.marketplace_daily (sales_date, ean);

create table public.bank_statements (
  id text primary key,
  source_file_id text not null references public.source_files(id),
  account_ref text not null,
  period_start date not null,
  period_end date not null,
  opening_balance numeric(18,2) not null,
  credits numeric(18,2) not null,
  debits numeric(18,2) not null,
  closing_balance numeric(18,2) not null,
  currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bank_statements_source_file_idx on public.bank_statements (source_file_id);
create index bank_statements_period_idx on public.bank_statements (period_start, period_end);

create table public.bank_transactions (
  id text primary key,
  statement_id text not null references public.bank_statements(id),
  booked_at date not null,
  amount numeric(18,2) not null,
  description text not null,
  counterparty text,
  transaction_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bank_transactions_statement_idx on public.bank_transactions (statement_id);
create index bank_transactions_match_idx on public.bank_transactions (booked_at, amount);

create table public.settlements (
  id text primary key,
  source_file_id text not null references public.source_files(id),
  provider text not null,
  gross_amount numeric(18,2) not null,
  adjustment_amount numeric(18,2) not null,
  net_amount numeric(18,2) not null,
  currency char(3) not null default 'EUR',
  paid_at date,
  matched_transaction_id text references public.bank_transactions(id),
  match_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index settlements_source_file_idx on public.settlements (source_file_id);
create index settlements_transaction_idx on public.settlements (matched_transaction_id);

create table public.reconciliation_runs (
  id text primary key,
  period text not null,
  rule_version text not null,
  matched_count integer not null,
  unmatched_count integer not null,
  difference numeric(18,2) not null,
  status text not null,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approvals (
  id text primary key,
  subject_type text not null,
  subject_id text not null,
  decision text not null,
  rationale text,
  actor_email text not null,
  decided_at timestamptz not null
);

create index approvals_subject_idx on public.approvals (subject_type, subject_id, decided_at desc);

create table public.accounting_policies (
  id text not null,
  version integer not null check (version > 0),
  name text not null,
  definition text not null,
  effective_from date not null,
  status text not null,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, version)
);

create table public.audit_events (
  id text primary key,
  actor_email text not null,
  action text not null,
  object_type text not null,
  object_id text not null,
  before_json jsonb,
  after_json jsonb,
  occurred_at timestamptz not null
);

create index audit_events_object_idx on public.audit_events (object_type, object_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_email, occurred_at desc);

alter table public.exceptions enable row level security;
alter table public.legal_entities enable row level security;
alter table public.app_users enable row level security;
alter table public.source_providers enable row level security;
alter table public.source_files enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.marketplace_daily enable row level security;
alter table public.bank_statements enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.settlements enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.approvals enable row level security;
alter table public.accounting_policies enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.exceptions, public.legal_entities, public.app_users, public.source_providers, public.source_files, public.ingestion_runs, public.marketplace_daily, public.bank_statements, public.bank_transactions, public.settlements, public.reconciliation_runs, public.approvals, public.accounting_policies, public.audit_events from anon, authenticated;
grant all on public.exceptions, public.legal_entities, public.app_users, public.source_providers, public.source_files, public.ingestion_runs, public.marketplace_daily, public.bank_statements, public.bank_transactions, public.settlements, public.reconciliation_runs, public.approvals, public.accounting_policies, public.audit_events to service_role;

create or replace function internal.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

revoke all on function internal.prevent_audit_mutation() from public, anon, authenticated;

create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function internal.prevent_audit_mutation();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'financial-evidence',
  'financial-evidence',
  false,
  20971520,
  array['application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.legal_entities (id, legal_name, trading_name, legal_form, kvk, rsin, vat_id)
values ('treso-ono', 'Treso ONO', 'Aterra', 'VOF', '99133954', '868817375', 'NL868817375B01');

insert into public.app_users (email, display_name, role) values
  ('reinout.buwalda@gmail.com', 'Reinout', 'owner'),
  ('aterra.eu@gmail.com', 'Aterra', 'owner'),
  ('t.w.dewaard@gmail.com', 'Thijs', 'owner'),
  ('hiddebaron@live.nl', 'Hidde', 'architect');

insert into public.source_providers (id, name, category, status) values
  ('bol', 'Bol.com', 'marketplace', 'active'),
  ('marktmentor', 'MarktMentor', 'analytics', 'active'),
  ('tien', 'Tien Fulfilment', 'fulfilment', 'active'),
  ('max', 'Max Fulfilment', 'fulfilment', 'historical'),
  ('import-4-you', 'Import 4 You', 'freight-customs', 'active'),
  ('knab', 'KNAB', 'bank', 'active');
