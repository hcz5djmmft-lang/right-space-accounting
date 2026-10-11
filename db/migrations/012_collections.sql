-- Collections: the three kinds of money Right Space collects, each on its own revenue code (new codes under the Revenue
-- heading, agreed 2026-10-11), the type on each sales invoice, and the project a receipt belongs to.
create table collection_types (
  id       text primary key,                          -- design, fitout, furniture
  name     text not null,
  name_ar  text,
  account  text not null references accounts(code),   -- the revenue code the type collects on
  sort     integer not null default 0,
  active   boolean not null default true
);
insert into accounts (code, name, type, parent, postable, is_system)
  select v.code, v.name, 'revenue', 'R100', true, true from (values ('R111', 'Design revenue'), ('R112', 'Fit-out revenue'), ('R113', 'Furniture revenue')) v(code, name)
  where exists (select 1 from accounts where code = 'R100') and not exists (select 1 from accounts a where a.code = v.code);
insert into collection_types (id, name, name_ar, account, sort)
  select v.id, v.name, v.name_ar, v.account, v.sort from (values ('design', 'Design', 'تصميم', 'R111', 1), ('fitout', 'Fit-out', 'تنفيذ', 'R112', 2), ('furniture', 'Furniture', 'أثاث', 'R113', 3)) v(id, name, name_ar, account, sort)
  where exists (select 1 from accounts where code = v.account);
alter table invoices add column category text;   -- sales invoices: the collection type (collection_types.id)
alter table payments add column project_id text; -- receipts: the project the money is for (taken from the invoice when allocated)
-- the account name printed with the bank details on invoices and bank transfer receipts
update bank_accounts set holder = 'Right Space Developments' where account = 'A120' and holder is null;
-- a receipt can be voided (its entry reversed), like an invoice
alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check check (status in ('draft', 'pending', 'posted', 'rejected', 'void'));
