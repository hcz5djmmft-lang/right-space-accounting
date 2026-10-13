-- Progress claims, variation orders, budget alerts and sample approvals (Adel's item 20 and the Technical Office proposal, 2026-10-13).

-- Subcontractor progress claims (نموذج مستخلص): the site engineer certifies the quantities (previous, current, cumulative and the
-- execution %), Procurement prices the items, Finance raises the payment request. Deductions as on the form: what was paid on the
-- earlier claims, the advance recovered on this claim, and the retention held on the cumulative work.
create table sub_claims (
  id             text primary key default gen_random_uuid()::text,
  no             text not null unique,                 -- SC-00001
  project_id     text not null references projects(id),
  vendor_id      text not null references parties(id),
  work_order_id  text references work_orders(id),
  trade          text not null default '',
  claim_no       int not null default 1,               -- interim claim number of this subcontractor on this project
  date           date not null,
  status         text not null default 'draft' check (status in ('draft','pricing','finance','requested','returned','cancelled')),
  retention_pct  numeric(5,2) not null default 5,
  advance        numeric(18,2) not null default 0,     -- advance recovered on this claim
  vat_rate       numeric(5,2) not null default 0,
  account        text references accounts(code),       -- the project's GL code the work posts to
  notes          text not null default '',
  certified_by   text references users(id),
  certified_at   timestamptz,
  priced_by      text references users(id),
  priced_at      timestamptz,
  request_id     text references invoices(id),         -- the payment request Finance raised from it
  created_by     text references users(id),
  created_at     timestamptz not null default now()
);
create index on sub_claims (project_id);
create index on sub_claims (vendor_id);
create table sub_claim_lines (
  id            bigserial primary key,
  claim_id      text not null references sub_claims(id) on delete cascade,
  line_no       int not null,
  wo_line_id    bigint references work_order_lines(id) on delete set null,
  item          text not null,
  unit          text not null default '',
  rate          numeric(18,2) not null default 0,
  current_qty   numeric(18,3) not null default 0,
  previous_qty  numeric(18,3) not null default 0,
  pct           numeric(5,2) not null default 100,    -- execution %
  notes         text not null default ''
);
create index on sub_claim_lines (claim_id);

-- Client progress claims: the work done per BOQ line as a cumulative %, the retention the client holds and the advance it recovers;
-- Finance invoices the certified work of the period.
create table client_claims (
  id             text primary key default gen_random_uuid()::text,
  no             text not null unique,                 -- CC-00001
  project_id     text not null references projects(id),
  claim_no       int not null default 1,
  date           date not null,
  status         text not null default 'draft' check (status in ('draft','certified','invoiced','cancelled')),
  retention_pct  numeric(5,2) not null default 5,
  advance        numeric(18,2) not null default 0,     -- advance recovered on this claim
  notes          text not null default '',
  certified_by   text references users(id),
  certified_at   timestamptz,
  invoice_id     text references invoices(id),
  created_by     text references users(id),
  created_at     timestamptz not null default now()
);
create index on client_claims (project_id);
create table client_claim_lines (
  claim_id     text not null references client_claims(id) on delete cascade,
  boq_line_id  bigint not null references boq_lines(id) on delete cascade,
  pct          numeric(5,2) not null default 0,        -- cumulative % done
  primary key (claim_id, boq_line_id)
);

-- Variation orders: priced changes the client approves; approved lines join the BOQ and the contract grows by their value.
create table variation_orders (
  id          text primary key default gen_random_uuid()::text,
  no          text not null unique,                    -- VO-00001
  project_id  text not null references projects(id),
  title       text not null,
  date        date not null,
  status      text not null default 'draft' check (status in ('draft','sent','approved','rejected','cancelled')),
  client_ref  text not null default '',
  notes       text not null default '',
  decided_by  text references users(id),
  decided_at  timestamptz,
  created_by  text references users(id),
  created_at  timestamptz not null default now()
);
create index on variation_orders (project_id);
create table variation_lines (
  id           bigserial primary key,
  vo_id        text not null references variation_orders(id) on delete cascade,
  line_no      int not null,
  description  text not null,
  unit         text not null default '',
  qty          numeric(18,3) not null default 1,
  rate         numeric(18,2) not null default 0,
  account      text references accounts(code),
  boq_line_id  bigint references boq_lines(id) on delete set null
);
create index on variation_lines (vo_id);
alter table boq_lines add column vo_id text references variation_orders(id) on delete set null;

-- One alert (a task for Cost control) per project and GL code while it stays over its budget.
create table budget_alerts (
  project_id  text not null references projects(id) on delete cascade,
  code        text not null,
  over_by     numeric(18,2) not null,
  task_id     text references tasks(id) on delete set null,
  raised_at   timestamptz not null default now(),
  primary key (project_id, code)
);

-- Samples: a finish is sent to the client as a sample (with photos attached) before it is bought.
alter table finishes drop constraint finishes_status_check;
alter table finishes add constraint finishes_status_check check (status in ('proposed','sent','approved','rejected'));
alter table finishes add column sample_ref text not null default '';
alter table finishes add column sent_at timestamptz;
