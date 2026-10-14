-- Expense capture from the phone (improvement 6): a receipt photo, the amount, the GL code and the project or department,
-- paid from petty cash, the credit card or the person's own money. It goes through the payment request approvals
-- (department head, then the steps in Settings) and posts its entry on the last approval. Money the person paid
-- themselves is owed to them on the employee advances account until Finance reimburses it.
create table expense_claims (
  id            text primary key default gen_random_uuid()::text,
  no            text not null unique,                    -- EX-00001
  date          date not null,
  amount        numeric(18,2) not null check (amount > 0),
  account       text not null references accounts(code),
  project_id    text references projects(id),
  dept_id       text references departments(id),
  description   text not null default '',
  paid_from     text not null,                           -- a petty cash or card account code, or 'own'
  status        text not null default 'pending' check (status in ('pending', 'rejected', 'posted', 'cancelled')),
  approver_id   text references users(id),
  approver_label text,
  entry_id      text references journal_entries(id),
  reimbursed_entry_id text references journal_entries(id),
  created_by    text not null references users(id),
  created_at    timestamptz not null default now(),
  check ((project_id is null) <> (dept_id is null))
);
create table expense_approvals (
  expense_id text not null references expense_claims(id) on delete cascade,
  step       int not null,
  step_name  text not null,
  user_id    text references users(id),
  at         timestamptz not null default now(),
  primary key (expense_id, step)
);
