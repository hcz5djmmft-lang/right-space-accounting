-- Bank reconciliation: the latest statement per bank or cash account, and which posted
-- lines have appeared on a statement ("cleared"). Book balances come from journal_lines as always.

create table bank_statements (
  account      text primary key references accounts(code),
  stmt_date    date,
  stmt_balance numeric(18,2),
  updated_by   text references users(id),
  updated_at   timestamptz not null default now()
);

create table bank_cleared (
  line_id    bigint primary key references journal_lines(id) on delete cascade,
  cleared_by text references users(id),
  cleared_at timestamptz not null default now()
);
