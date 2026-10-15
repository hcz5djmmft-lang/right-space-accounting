-- Update 20 (Adel, 2026-10-15).

-- Item 9: access per sub-category. Null = never set one by one: the person keeps what their roles and department gave.
alter table users add column if not exists access text[];

-- Item 28: the department is Procurement, not Purchasing.
update departments set name = 'Procurement' where code = 'PUR' and name = 'Purchasing';

-- Items 14, 15, 17: petty cash paid to an employee, a vendor, a subcontractor or someone else; one cost center and several
-- lines, each with its GL code; approved by the head (a project's by the Director of Engineering), then Management, then paid.
create table if not exists petty_cash (
  id             text primary key default gen_random_uuid()::text,
  no             text not null unique,
  date           date not null,
  paid_to_kind   text not null check (paid_to_kind in ('employee', 'vendor', 'sub', 'other')),
  paid_to_id     text,
  paid_to_name   text not null,
  purpose        text not null,
  project_id     text references projects(id),
  dept_id        text references departments(id),
  total          numeric(14,2) not null,
  status         text not null check (status in ('head', 'management', 'approved', 'paid', 'rejected', 'voided')),
  approver_id    text,
  approver_label text,
  head_by        text references users(id),
  head_at        timestamptz,
  mgmt_by        text references users(id),
  mgmt_at        timestamptz,
  decision_note  text not null default '',
  entry_id       text references journal_entries(id),
  created_by     text references users(id),
  created_at     timestamptz not null default now(),
  check ((project_id is null) <> (dept_id is null))
);
create table if not exists petty_cash_lines (
  petty_id    text not null references petty_cash(id) on delete cascade,
  line_no     int not null,
  account     text not null references accounts(code),
  description text not null default '',
  amount      numeric(14,2) not null check (amount > 0),
  primary key (petty_id, line_no)
);

-- Item 25: a sales invoice is approved by Finance, Engineering, then Management before it is issued.
alter table invoices add column if not exists sales_step text check (sales_step in ('finance', 'engineering', 'management'));
