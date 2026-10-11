-- Partners: the four owners at 25% each (Adel, 2026-10-11), each with a current account under the Equity heading
-- (new codes under an existing heading, agreed 2026-10-11). Money a partner puts in is credited to it, withdrawals
-- are debited, and their share of the profit is credited when Management shares it out.
create table partners (
  id      text primary key,
  name    text not null,
  share   numeric(5,2) not null check (share >= 0 and share <= 100),
  account text not null unique references accounts(code),
  sort    integer not null default 0,
  active  boolean not null default true
);

-- A period whose profit has been shared out to the partners; the same days cannot be shared twice.
create table partner_profit_shares (
  id         text primary key default gen_random_uuid()::text,
  date_from  date not null,
  date_to    date not null check (date_to >= date_from),
  profit     numeric(18,2) not null,
  entry_id   text not null references journal_entries(id),
  created_by text references users(id),
  created_at timestamptz not null default now()
);

alter table journal_entries drop constraint if exists journal_entries_kind_check;
alter table journal_entries add constraint journal_entries_kind_check check (kind in
  ('expense','collection','transfer','adjustment','payment_request','sales_invoice','payment','receipt','payroll','reversal','partner'));

insert into accounts (code, name, type, parent, postable, is_system)
  select v.code, v.name, 'equity', 'Q100', true, true
  from (values ('Q111', 'Current account – Adel'), ('Q112', 'Current account – Haitham'), ('Q113', 'Current account – Youssef'), ('Q114', 'Current account – Marwan')) v(code, name)
  where exists (select 1 from accounts where code = 'Q100') and not exists (select 1 from accounts a where a.code = v.code);
insert into partners (id, name, share, account, sort)
  select v.id, v.name, 25, v.account, v.sort
  from (values ('adel', 'Adel Maksoud', 'Q111', 1), ('haitham', 'Haitham', 'Q112', 2), ('youssef', 'Youssef', 'Q113', 3), ('marwan', 'Marwan', 'Q114', 4)) v(id, name, account, sort)
  where exists (select 1 from accounts where code = v.account)
  on conflict do nothing;

-- profit is shared out of retained earnings
update settings set account_map = account_map || '{"retained": "Q120"}'::jsonb where id = 1 and exists (select 1 from accounts where code = 'Q120');
