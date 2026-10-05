-- Test-only representation of the pre-existing application product master.
-- Production already owns this table; repository migrations begin after it exists.
create table public.products (
  id text primary key,
  ean text,
  updated_at timestamptz not null default now()
);

insert into public.products (id, ean)
values
  ('carafe-fruit', '8720892887504'),
  ('carafe-rvs', '8720892887511'),
  ('sportsbag', '8720892887528'),
  ('diy-fort', null);
