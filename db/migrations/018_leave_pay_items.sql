-- Leave per Egyptian law, requested from the phone and approved by the department head then HR; monthly pay items
-- (overtime, bonuses, advances, loans, penalties, deductions) that feed the payroll run (Adel, 2026-10-13).

create table leave_requests (
  id             text primary key default gen_random_uuid()::text,
  employee_id    text not null references employees(id),
  type           text not null check (type in ('annual','casual','sick','unpaid','other')),
  from_date      date not null,
  to_date        date not null,
  days           numeric(5,1) not null,            -- working days (weekend days from the HR settings skipped)
  reason         text not null default '',
  status         text not null default 'head' check (status in ('head','hr','approved','rejected','cancelled')),
  head_user_id   text,                             -- the department head who signs first, fixed when the request is made; null = straight to HR
  head_signed_by text references users(id),
  head_at        timestamptz,
  hr_signed_by   text references users(id),
  hr_at          timestamptz,
  decision_note  text not null default '',
  created_by     text references users(id),
  created_at     timestamptz not null default now()
);
create index on leave_requests (employee_id, from_date);
create index on leave_requests (status);

create table loans (
  id          text primary key default gen_random_uuid()::text,
  employee_id text not null references employees(id),
  amount      numeric(18,2) not null,
  monthly     numeric(18,2) not null,              -- the instalment taken off each month's pay
  start_period text not null check (start_period ~ '^\d{4}-\d{2}$'),
  note        text not null default '',
  closed      boolean not null default false,
  created_by  text references users(id),
  created_at  timestamptz not null default now()
);

-- One line per employee and month: added to the pay (overtime, bonus), taken off the gross (penalty) or recovered
-- against staff advances (advance, loan, deduction). `run_period` is set once a payroll run has taken the item in.
create table pay_items (
  id          text primary key default gen_random_uuid()::text,
  employee_id text not null references employees(id),
  period      text not null check (period ~ '^\d{4}-\d{2}$'),
  kind        text not null check (kind in ('overtime','bonus','advance','loan','penalty','deduction')),
  amount      numeric(18,2) not null check (amount > 0),
  note        text not null default '',
  loan_id     text references loans(id),
  run_period  text references payroll_runs(period) on delete set null,
  created_by  text references users(id),
  created_at  timestamptz not null default now()
);
create index on pay_items (period, employee_id);
create unique index pay_items_loan_once on pay_items (loan_id, period) where loan_id is not null;
