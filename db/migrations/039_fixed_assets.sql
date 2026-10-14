-- Fixed assets (improvement 14): a register with straight-line depreciation, posted once a month as one entry
-- (Dr the depreciation expense code chosen by Finance, per the asset's cost center; Cr accumulated depreciation).
create table fixed_assets (
  id            text primary key default gen_random_uuid()::text,
  no            text not null unique,
  name          text not null,
  category      text not null default '',
  dept_id       text references departments(id),
  project_id    text references projects(id),
  in_service    date not null,
  cost          numeric(18,2) not null check (cost > 0),
  salvage       numeric(18,2) not null default 0 check (salvage >= 0),
  life_months   int not null check (life_months > 0),
  asset_account text not null references accounts(code),
  purchase_entry_id text references journal_entries(id),
  stopped_on    date,                 -- sold or written off: no depreciation after this month
  stop_note     text not null default '',
  notes         text not null default '',
  created_by    text references users(id),
  created_at    timestamptz not null default now(),
  check (salvage < cost),
  check ((project_id is null) <> (dept_id is null))
);

create table depreciation_runs (
  period    text primary key check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  entry_id  text not null references journal_entries(id),
  total     numeric(18,2) not null,
  posted_by text references users(id),
  posted_at timestamptz not null default now()
);
create table depreciation_lines (
  period   text not null references depreciation_runs(period) on delete cascade,
  asset_id text not null references fixed_assets(id),
  amount   numeric(18,2) not null,
  primary key (period, asset_id)
);

-- the register's GL codes, where the chart has them (the depreciation expense code is picked by Finance)
update settings set account_map = account_map
  || case when exists (select 1 from accounts where code = 'A210') and not account_map ? 'fixedAssets' then '{"fixedAssets":"A210"}'::jsonb else '{}'::jsonb end
  || case when exists (select 1 from accounts where code = 'A219') and not account_map ? 'accDep' then '{"accDep":"A219"}'::jsonb else '{}'::jsonb end
where id = 1;
