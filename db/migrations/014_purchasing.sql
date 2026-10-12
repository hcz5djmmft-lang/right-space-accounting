-- Purchasing (Adel, 2026-10-11): a material list, purchase requests that become purchase orders, receiving the vendor's
-- invoice against a PO, and payment requests that pay a vendor's unpaid invoices.
--
-- A material carries the GL code it is bought on (the base code, e.g. 24001 electrical supplies): on a project it posts
-- to that project's copy (24001-3), for a department to the Office code itself.
create table materials (
  id           text primary key default gen_random_uuid()::text,
  code         text not null unique,
  name         text not null,
  name_ar      text,
  unit         text not null default 'pc',
  account_base text not null,
  last_price   numeric(18,2),
  active       boolean not null default true
);

-- Purchase request PRQ-00001: raised by anyone for a project or a department; Procurement prices it and picks the vendor,
-- the department head approves, Management gives the final approval, and it becomes purchase order PO-00001.
-- status: draft → procurement → head → management → approved (a PO); rejected = returned to the requester; cancelled.
create table purchase_requests (
  id             text primary key default gen_random_uuid()::text,
  no             text not null unique,
  date           date not null,
  needed_by      date,
  project_id     text references projects(id),
  dept_id        text references departments(id),
  notes          text not null default '',
  status         text not null default 'draft' check (status in ('draft','procurement','head','management','approved','rejected','cancelled')),
  vendor_id      text references parties(id),
  vat_rate       numeric(5,2) not null default 0,
  approver_id    text,              -- the department head who signs, fixed when Procurement sends it on
  approver_label text,
  po_no          text unique,
  po_date        date,
  closed         boolean not null default false,  -- nothing more will be received on this PO
  created_by     text references users(id),
  created_at     timestamptz not null default now(),
  check (project_id is not null or dept_id is not null)
);

create table purchase_request_lines (
  id          bigserial primary key,
  request_id  text not null references purchase_requests(id) on delete cascade,
  line_no     int not null,
  material_id text references materials(id),
  description text not null default '',
  unit        text not null default 'pc',
  qty         numeric(18,3) not null check (qty > 0),
  price       numeric(18,2) not null default 0,
  account     text references accounts(code)   -- the GL code the line posts to (the material's code for the request's cost center)
);
create index on purchase_request_lines (request_id);

create table purchase_request_approvals (
  request_id text not null references purchase_requests(id) on delete cascade,
  step       text not null,   -- procurement, head, management
  step_name  text not null,   -- "Procurement", "Engineering head", "Management"
  user_id    text references users(id),
  at         timestamptz not null default now(),
  primary key (request_id, step)
);

-- Vendor invoices received against a PO are invoices (kind 'purchase', numbered VI-00001) that post at once; each line
-- remembers its PO line, so the PO shows what was received and what remains.
alter table invoices add column po_id text references purchase_requests(id);
alter table invoice_lines add column po_line_id bigint references purchase_request_lines(id);

-- A payment request can pay vendor invoices already in the books instead of carrying its own lines.
create table payment_request_bills (
  request_id text not null references invoices(id) on delete cascade,
  bill_id    text not null references invoices(id),
  amount     numeric(18,2) not null check (amount > 0),
  primary key (request_id, bill_id)
);

-- What has been paid on a payment request or a vendor invoice: payments allocated to it, and for a request that pays
-- vendor invoices, the payments allocated to those invoices.
create function invoice_paid(inv text) returns numeric language sql stable as $$
  select coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' where a.invoice_id = inv), 0)
       + coalesce((select sum(a.amount) from payment_request_bills b join payment_allocations a on a.invoice_id = b.bill_id
                   join payments p on p.id = a.payment_id and p.status = 'posted' where b.request_id = inv), 0)
$$;

-- A starter material list to try the system with; the real list replaces it later.
insert into materials (code, name, name_ar, unit, account_base)
  select v.code, v.name, v.name_ar, v.unit, v.base from (values
    ('MAT-001', 'Cement, 50 kg bag', 'أسمنت', 'bag', '28004'),
    ('MAT-002', 'Sand', 'رمل', 'm³', '28003'),
    ('MAT-003', 'Electrical cable 3 mm', 'سلك كهرباء ٣ مم', 'roll', '24001'),
    ('MAT-004', 'Switches and sockets', 'مفاتيح وبرايز', 'pc', '24001'),
    ('MAT-005', 'PPR pipe 25 mm', 'مواسير PPR', 'm', '24002'),
    ('MAT-006', 'Plumbing fittings', 'وصلات سباكة', 'pc', '24002'),
    ('MAT-007', 'Wall paint', 'دهانات', 'gallon', '24003'),
    ('MAT-008', 'Putty', 'معجون', 'bag', '24003'),
    ('MAT-009', 'Tile adhesive', 'لاصق سيراميك', 'bag', '24004'),
    ('MAT-010', 'Porcelain tiles', 'بورسلين', 'm²', '24004'),
    ('MAT-011', 'Gypsum board sheet', 'لوح جبس بورد', 'sheet', '23001'),
    ('MAT-012', 'Aluminium works', 'ألوميتال', 'm²', '23002'),
    ('MAT-013', 'HDF sheet', 'لوح HDF', 'sheet', '23003'),
    ('MAT-014', 'Marble', 'رخام', 'm²', '23004'),
    ('MAT-015', 'Glass', 'زجاج', 'm²', '23005'),
    ('MAT-016', 'MDF / wood sheet', 'خشب MDF', 'sheet', '25001'),
    ('MAT-017', 'Site consumables', 'نثريات الموقع', 'lot', '28001'),
    ('MAT-018', 'Office stationery', 'أدوات مكتبية', 'lot', '13002'),
    ('MAT-019', 'Hospitality supplies', 'مستلزمات ضيافة', 'lot', '13001'),
    ('MAT-020', 'Office equipment', 'معدات مكتبية', 'pc', '13003')) v(code, name, name_ar, unit, base)
  where exists (select 1 from accounts where code like v.base || '%')
  on conflict do nothing;
