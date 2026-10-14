-- Opening balances (improvement 8): what each balance-sheet account held when the books start (1 January 2026), the
-- partners' funding on their current accounts among them. Typed here as a draft, then posted as one opening entry;
-- voiding that entry (a reversal on the same date) lets it be corrected and posted again.
create table opening_balances (
  account    text primary key references accounts(code),
  dr         numeric(18,2) not null default 0 check (dr >= 0),
  cr         numeric(18,2) not null default 0 check (cr >= 0),
  updated_by text references users(id),
  updated_at timestamptz not null default now()
);
alter table settings add column opening_date date not null default '2026-01-01';
