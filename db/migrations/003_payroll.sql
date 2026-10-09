-- Payroll: monthly runs built from the employee records, posted to the ledger, then paid.

alter table employees add column hire_date date;
alter table employees add constraint employees_project_fk foreign key (project_id) references projects(id);

create table payroll_runs (
  period        text primary key check (period ~ '^\d{4}-\d{2}$'),   -- 2026-10
  date          date not null,                                        -- posting date, normally the month end
  status        text not null default 'draft' check (status in ('draft','pending','posted','rejected')),
  entry_id      text references journal_entries(id),
  paid_entry_id text references journal_entries(id),
  created_by    text references users(id),
  created_at    timestamptz not null default now()
);

create table payroll_lines (
  run_period  text not null references payroll_runs(period) on delete cascade,
  employee_id text not null references employees(id),
  line_no     int not null,
  name        text not null,
  project_id  text references projects(id),
  dept_id     text references departments(id),
  basic       numeric(18,2) not null default 0,
  allowances  numeric(18,2) not null default 0,
  overtime    numeric(18,2) not null default 0,
  deductions  numeric(18,2) not null default 0,
  gross       numeric(18,2) not null default 0,
  insurable   numeric(18,2) not null default 0,
  soc_emp     numeric(18,2) not null default 0,
  soc_co      numeric(18,2) not null default 0,
  tax         numeric(18,2) not null default 0,
  net         numeric(18,2) not null default 0,
  primary key (run_period, employee_id)
);
