-- Petty cash (improvement 15): a cash count by denomination against the book balance, and a top-up request to Finance
-- that posts the transfer from the bank when approved. The float is the amount the box is topped up to.
alter table bank_accounts add column float_amount numeric(18,2);

create table cash_counts (
  id          text primary key default gen_random_uuid()::text,
  account     text not null references accounts(code),
  date        date not null,
  notes       jsonb not null default '{}',       -- { "200": 3, "100": 5, "0.5": 4 }: how many of each note and coin
  counted     numeric(18,2) not null,
  book        numeric(18,2) not null,
  difference  numeric(18,2) not null,
  remark      text not null default '',
  counted_by  text references users(id),
  at          timestamptz not null default now()
);
create index on cash_counts (account, date);

create table petty_topups (
  id           text primary key default gen_random_uuid()::text,
  no           text not null unique,
  account      text not null references accounts(code),
  amount       numeric(18,2) not null check (amount > 0),
  note         text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'paid', 'rejected', 'cancelled')),
  requested_by text references users(id),
  requested_at timestamptz not null default now(),
  decided_by   text references users(id),
  decided_at   timestamptz,
  decision     text not null default '',
  entry_id     text references journal_entries(id)
);
