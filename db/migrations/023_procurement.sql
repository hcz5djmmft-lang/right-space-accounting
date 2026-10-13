-- Procurement (Adel, 2026-10-13, update 14): the eight parts on top of update 5's purchasing. Vendors carry categories,
-- a rating and documents; a purchase request is assigned to a procurement engineer, collects quotations compared side by
-- side (the chosen offer sets the vendor and prices and goes to the procurement head, then Management); a PO has a
-- promised delivery date, deliveries (partial, late ones flagged as tasks) and site stock per project; subcontractors get
-- work orders per work category with retention and advance, approved like POs; the material plan lines remember the
-- request raised for them; committed cost (POs and work orders) is read against the BOQ budget.

alter table parties add column categories  text[] not null default '{}';
alter table parties add column rating      smallint check (rating between 1 and 5);
alter table parties add column rating_note text not null default '';
alter table parties add column rated_by    text references users(id);
alter table parties add column rated_at    timestamptz;

alter table purchase_requests add column buyer_id      text references users(id);   -- the procurement engineer it is assigned to
alter table purchase_requests add column delivery_date date;                         -- when the vendor promised delivery

create table quotations (
  id            text primary key default gen_random_uuid()::text,
  request_id    text not null references purchase_requests(id) on delete cascade,
  vendor_id     text not null references parties(id),
  date          date not null,
  ref           text not null default '',
  valid_until   date,
  delivery_days int,
  vat_rate      numeric(5,2) not null default 0,
  notes         text not null default '',
  chosen        boolean not null default false,
  created_by    text references users(id),
  created_at    timestamptz not null default now()
);
create index on quotations (request_id);
create table quotation_lines (
  quotation_id text not null references quotations(id) on delete cascade,
  line_id      bigint not null references purchase_request_lines(id) on delete cascade,
  price        numeric(18,2) not null default 0,
  primary key (quotation_id, line_id)
);

-- Goods received on a PO (a delivery note), apart from the vendor's invoice Finance receives later.
create table deliveries (
  id          text primary key default gen_random_uuid()::text,
  po_id       text not null references purchase_requests(id),
  date        date not null,
  ref         text not null default '',      -- the delivery note number
  notes       text not null default '',
  received_by text references users(id),
  created_at  timestamptz not null default now()
);
create index on deliveries (po_id);
create table delivery_lines (
  delivery_id text not null references deliveries(id) on delete cascade,
  line_id     bigint not null references purchase_request_lines(id),
  qty         numeric(18,3) not null check (qty > 0),
  primary key (delivery_id, line_id)
);

-- Site stock: what was delivered to a project less what the site used.
create table stock_issues (
  id          bigserial primary key,
  project_id  text not null references projects(id),
  material_id text not null references materials(id),
  date        date not null,
  qty         numeric(18,3) not null check (qty > 0),
  note        text not null default '',
  user_id     text references users(id),
  at          timestamptz not null default now()
);
create index on stock_issues (project_id, material_id);

-- Work order WO-00001 to a subcontractor for one work category of a project: items with rates, retention and advance
-- terms, approved like a PO (Procurement → department head → Management). Progress claims are certified against it.
create table work_orders (
  id             text primary key default gen_random_uuid()::text,
  no             text not null unique,
  project_id     text not null references projects(id),
  vendor_id      text references parties(id),
  category       text not null default 'other',   -- the Master BOQ section number, or 'other'
  title          text not null,
  date           date not null,
  start_date     date,
  end_date       date,
  retention_pct  numeric(5,2) not null default 5,
  advance_pct    numeric(5,2) not null default 0,
  vat_rate       numeric(5,2) not null default 0,
  account        text references accounts(code),  -- the project's GL code the work posts to
  status         text not null default 'draft' check (status in ('draft','head','management','approved','rejected','cancelled','closed')),
  approver_id    text,
  approver_label text,
  approved_at    date,
  notes          text not null default '',
  created_by     text references users(id),
  created_at     timestamptz not null default now()
);
create table work_order_lines (
  id            bigserial primary key,
  work_order_id text not null references work_orders(id) on delete cascade,
  line_no       int not null,
  item          text not null,
  unit          text not null default 'lot',
  qty           numeric(18,3) not null default 1 check (qty > 0),
  rate          numeric(18,2) not null default 0
);
create index on work_order_lines (work_order_id);
create table work_order_approvals (
  work_order_id text not null references work_orders(id) on delete cascade,
  step          text not null,
  step_name     text not null,
  user_id       text references users(id),
  at            timestamptz not null default now(),
  primary key (work_order_id, step)
);

-- A material plan line remembers the purchase request raised for it and the material it became.
alter table material_plan add column request_id  text references purchase_requests(id) on delete set null;
alter table material_plan add column material_id text references materials(id);
