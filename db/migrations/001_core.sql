-- Right Space Accounting: core schema.
-- Money is numeric(18,2) in EGP. Ids are text so records imported from the old app keep their ids.

create extension if not exists pgcrypto;

create table settings (
  id               int primary key default 1 check (id = 1),
  company_name     text not null default 'Right Space Development',
  vat_rate         numeric(5,2) not null default 14,
  require_approval boolean not null default true,
  require_cc       boolean not null default true,
  lock_date        date,
  pr_prefix        text not null default 'C-',
  fy_start_month   int not null default 1,
  cats             jsonb not null default '{}',   -- {type:[], service:[], unit:[]}
  account_map      jsonb not null default '{}',   -- role -> system account code (ap, ar, vatIn, ...)
  payroll          jsonb not null default '{}'    -- {empRate, coRate, insMin, insMax, exemption, brackets}
);
insert into settings (id) values (1);

create table users (
  id            text primary key default gen_random_uuid()::text,
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  roles         text[] not null default '{}',  -- management, finance, engineering, projects, tenders
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

create table approval_steps (
  position int primary key,
  name     text not null,
  user_ids text[] not null default '{}'
);
insert into approval_steps (position, name) values (1,'Finance'),(2,'Engineering'),(3,'Management');

create table departments (
  id     text primary key default gen_random_uuid()::text,
  code   text not null unique,
  name   text not null,
  active boolean not null default true
);

create table employees (
  id          text primary key default gen_random_uuid()::text,
  code        text unique,
  name        text not null,
  job_title   text,
  dept_id     text references departments(id),
  project_id  text,
  user_id     text references users(id),
  basic       numeric(18,2) not null default 0,
  allowances  numeric(18,2) not null default 0,
  insurable   numeric(18,2) not null default 0,
  bank_account text,
  active      boolean not null default true
);

create table projects (
  id          text primary key default gen_random_uuid()::text,
  code        text not null unique,
  name        text not null,
  client_id   text,
  type        text,
  service     text,
  unit        text,
  location    text,
  area        numeric(12,2),
  contract    numeric(18,2),
  budget      numeric(18,2),
  status      text not null default 'Active' check (status in ('Active','On hold','Completed','Closed')),
  start_date  date,
  end_date    date,
  manager_id  text references employees(id),
  designer_id text references employees(id),
  site_eng_id text references employees(id),
  gl_suffix   int unique,
  description text,
  is_office   boolean not null default false
);
alter table employees add foreign key (project_id) references projects(id);

create table accounts (
  code      text primary key,
  name      text not null,
  type      text not null check (type in ('asset','liability','equity','revenue','expense')),
  parent    text references accounts(code),
  postable  boolean not null default true,
  is_bank   boolean not null default false,
  is_system boolean not null default false,
  budget    numeric(18,2),
  cost_type text check (cost_type in ('Opex','Capex') or cost_type is null),
  project_id text references projects(id)
);

create table parties (
  id         text primary key default gen_random_uuid()::text,
  code       text unique,
  type       text not null check (type in ('customer','vendor')),
  name       text not null,
  full_name  text,
  email      text,
  phone      text,
  bank_name  text,
  account_no text,
  iban       text,
  swift      text,
  tax_id     text,
  wht_rate   numeric(5,2) not null default 0,
  notes      text
);
alter table projects add foreign key (client_id) references parties(id);

-- Document numbering (JE-00001, C-000001, PAY-00001, ...)
create table counters (name text primary key, value int not null);

create table journal_entries (
  id          text primary key default gen_random_uuid()::text,
  no          text not null unique,
  date        date not null,
  memo        text not null default '',
  ref         text not null default '',
  kind        text not null default 'adjustment'
              check (kind in ('expense','collection','transfer','adjustment','payment_request','sales_invoice','payment','receipt','payroll','reversal')),
  status      text not null default 'draft' check (status in ('draft','pending','posted','rejected')),
  form        jsonb not null default '{}',   -- what the user typed for Expense / Collection / Transfer
  source_type text,
  source_id   text,
  reverses_id text references journal_entries(id),
  reversed_by text references journal_entries(id),
  created_by  text references users(id),
  created_at  timestamptz not null default now(),
  posted_by   text references users(id),
  posted_at   timestamptz
);

create table journal_lines (
  id          bigserial primary key,
  entry_id    text not null references journal_entries(id) on delete cascade,
  line_no     int not null,
  account     text not null references accounts(code),
  dr          numeric(18,2) not null default 0 check (dr >= 0),
  cr          numeric(18,2) not null default 0 check (cr >= 0),
  project_id  text references projects(id),
  dept_id     text references departments(id),
  party_id    text references parties(id),
  description text not null default '',
  check (dr = 0 or cr = 0)
);
create index on journal_lines (account);
create index on journal_lines (project_id);
create index on journal_lines (entry_id);

-- Everything that happens to a record: who, when, what.
create table audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   text references users(id),
  entity    text not null,
  entity_id text not null,
  action    text not null,
  note      text not null default '',
  data      jsonb
);
create index on audit_log (entity, entity_id);

-- Payment requests (purchase) and sales invoices
create table invoices (
  id          text primary key default gen_random_uuid()::text,
  kind        text not null check (kind in ('sales','purchase')),
  no          text not null unique,
  date        date not null,
  due_date    date,
  party_id    text not null references parties(id),
  project_id  text references projects(id),
  dept_id     text references departments(id),
  cost_type   text,
  ref         text not null default '',
  requester   text,
  vat_rate    numeric(5,2) not null default 0,
  wht_rate    numeric(5,2) not null default 0,
  si_rate     numeric(5,2) not null default 0,
  ret_rate    numeric(5,2) not null default 0,
  dp_amount   numeric(18,2) not null default 0,
  subtotal    numeric(18,2) not null default 0,
  vat         numeric(18,2) not null default 0,
  wht         numeric(18,2) not null default 0,
  si          numeric(18,2) not null default 0,
  retention   numeric(18,2) not null default 0,
  total       numeric(18,2) not null default 0,
  net         numeric(18,2) not null default 0,
  status      text not null default 'draft' check (status in ('draft','pending','posted','rejected','void')),
  entry_id    text references journal_entries(id),
  created_by  text references users(id),
  created_at  timestamptz not null default now()
);

create table invoice_lines (
  id          bigserial primary key,
  invoice_id  text not null references invoices(id) on delete cascade,
  line_no     int not null,
  account     text not null references accounts(code),
  description text not null default '',
  qty         numeric(18,3) not null default 1,
  price       numeric(18,2) not null default 0,
  project_id  text references projects(id),
  dept_id     text references departments(id)
);

create table invoice_approvals (
  invoice_id text not null references invoices(id) on delete cascade,
  step       int not null,
  step_name  text not null,
  user_id    text references users(id),
  at         timestamptz not null default now(),
  primary key (invoice_id, step)
);

create table payments (
  id         text primary key default gen_random_uuid()::text,
  kind       text not null check (kind in ('receipt','payment')),
  no         text not null unique,
  date       date not null,
  party_id   text not null references parties(id),
  bank       text not null references accounts(code),
  amount     numeric(18,2) not null check (amount > 0),
  wht        numeric(18,2) not null default 0,
  memo       text not null default '',
  ref        text not null default '',
  status     text not null default 'draft' check (status in ('draft','pending','posted','rejected')),
  entry_id   text references journal_entries(id),
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table payment_allocations (
  payment_id text not null references payments(id) on delete cascade,
  invoice_id text not null references invoices(id),
  amount     numeric(18,2) not null check (amount > 0),
  primary key (payment_id, invoice_id)
);

-- Files attached to entries, payment requests, payments (stored in object storage; this is the index)
create table attachments (
  id          text primary key default gen_random_uuid()::text,
  entity      text not null,
  entity_id   text not null,
  file_name   text not null,
  mime_type   text not null,
  size_bytes  bigint not null,
  storage_key text not null,
  uploaded_by text references users(id),
  uploaded_at timestamptz not null default now()
);
create index on attachments (entity, entity_id);

-- ---------------------------------------------------------------
-- Ledger integrity, enforced by the database itself
-- ---------------------------------------------------------------

-- A posted entry must balance and can never be changed or deleted; only reversed.
create function check_entry_balanced(eid text) returns void language plpgsql as $$
declare d numeric; c numeric; n int;
begin
  select coalesce(sum(dr),0), coalesce(sum(cr),0), count(*) into d, c, n from journal_lines where entry_id = eid;
  if n < 2 then raise exception 'Entry % needs at least two lines', eid; end if;
  if d <> c then raise exception 'Entry % is not balanced: debit % vs credit %', eid, d, c; end if;
  if d = 0 then raise exception 'Entry % has no amount', eid; end if;
end $$;

create function guard_journal_entry() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then raise exception 'Posted entry % cannot be deleted; reverse it instead', old.no; end if;
    return old;
  end if;
  if old.status = 'posted' then
    -- only the reversal link may be set on a posted entry
    if (to_jsonb(new) - 'reversed_by') <> (to_jsonb(old) - 'reversed_by') then
      raise exception 'Posted entry % cannot be changed; reverse it instead', old.no;
    end if;
    return new;
  end if;
  if new.status = 'posted' then
    perform check_entry_balanced(new.id);
    if exists (select 1 from settings where lock_date is not null and new.date <= lock_date) then
      raise exception 'The books are locked up to %; entry % cannot be posted on %',
        (select lock_date from settings), new.no, new.date;
    end if;
  end if;
  return new;
end $$;
create trigger journal_entries_guard before update or delete on journal_entries
  for each row execute function guard_journal_entry();

create function guard_journal_entry_insert() returns trigger language plpgsql as $$
begin
  if new.status = 'posted' then
    raise exception 'Insert entries as draft, add their lines, then post';
  end if;
  return new;
end $$;
create trigger journal_entries_guard_insert before insert on journal_entries
  for each row execute function guard_journal_entry_insert();

create function guard_journal_line() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if st = 'posted' then raise exception 'Lines of a posted entry cannot be changed'; end if;
  return coalesce(new, old);
end $$;
create trigger journal_lines_guard before insert or update or delete on journal_lines
  for each row execute function guard_journal_line();

-- System accounts can never be deleted.
create function guard_account() returns trigger language plpgsql as $$
begin
  if old.is_system then raise exception 'System account % cannot be deleted', old.code; end if;
  if exists (select 1 from journal_lines where account = old.code) then
    raise exception 'Account % has entries and cannot be deleted', old.code;
  end if;
  return old;
end $$;
create trigger accounts_guard before delete on accounts for each row execute function guard_account();
