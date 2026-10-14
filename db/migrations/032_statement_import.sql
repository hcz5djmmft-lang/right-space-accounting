-- Bank statement import (improvement 5): the statement files Finance uploads and their lines, each matched to the
-- posted book line it is (which also ticks that line as cleared), set aside, or still open.
create table statement_imports (
  id          text primary key default gen_random_uuid()::text,
  account     text not null references accounts(code),
  file_name   text not null default '',
  lines       int not null default 0,
  imported_by text references users(id),
  at          timestamptz not null default now()
);
create table statement_lines (
  id              bigserial primary key,
  account         text not null references accounts(code),
  import_id       text references statement_imports(id) on delete set null,
  line_key        text not null unique,                 -- a re-import of the same statement adds nothing
  date            date not null,
  description     text not null default '',
  ref             text not null default '',
  amount          numeric(18,2) not null,               -- money in positive, money out negative (the company's side)
  balance         numeric(18,2),
  status          text not null default 'open' check (status in ('open', 'matched', 'ignored')),
  matched_line_id bigint unique references journal_lines(id) on delete set null,
  matched_by      text references users(id),
  matched_at      timestamptz
);
create index statement_lines_account on statement_lines(account, status, date);
