-- Monthly budgets (improvement 12): an amount per month for a project or a department, for all its costs or for one
-- GL code, typed or uploaded from Excel. Budget against actual, with a task to the cost center's owner at 80% and 100%.
create table monthly_budgets (
  id         bigserial primary key,
  period     text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  project_id text references projects(id),
  dept_id    text references departments(id),
  account    text references accounts(code),
  amount     numeric(18,2) not null check (amount >= 0),
  updated_by text references users(id),
  updated_at timestamptz not null default now(),
  check ((project_id is null) <> (dept_id is null))
);
create unique index monthly_budgets_one on monthly_budgets (period, coalesce(project_id, ''), coalesce(dept_id, ''), coalesce(account, ''));

create table monthly_budget_alerts (
  budget_id bigint not null references monthly_budgets(id) on delete cascade,
  level     int not null check (level in (80, 100)),
  task_id   text references tasks(id) on delete set null,
  at        timestamptz not null default now(),
  primary key (budget_id, level)
);
