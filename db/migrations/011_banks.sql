-- Banks, the credit card and petty cash: the details behind each cash-like account, and a reference number on every
-- payment out of one (CIB-34-00001 from the bank, CC-12-00001 from the card, PT-00001 from cash).
create table bank_accounts (
  account          text primary key references accounts(code),
  kind             text not null check (kind in ('bank', 'card', 'cash')),
  bank_name        text,
  branch           text,
  account_no       text,
  iban             text,
  swift            text,
  credit_limit     numeric(18,2),                    -- cards
  holder           text,                             -- petty cash: who keeps it
  ref_prefix       text not null,                    -- CIB-34-, CC-12-, PT-
  show_on_invoices boolean not null default false    -- the account clients are asked to pay into
);
alter table payments add column reference text;           -- the payment's number, copied from its journal entry
alter table journal_entries add column payment_ref text;  -- given when an entry that pays out of a bank, card or cash account posts

-- A120 is the company's CIB current account (the open item "rename A120 to the real bank"); details from the bank's certificate of 2026-09-01.
update accounts set name = 'CIB current account ···6334' where code = 'A120' and name = 'Main bank account';
insert into bank_accounts (account, kind, bank_name, branch, account_no, iban, swift, ref_prefix, show_on_invoices)
  select 'A120', 'bank', 'Commercial International Bank (CIB)', 'Green Plaza', '100076016334', 'EG840010004200000100076016334', 'CIBEEGCX042', 'CIB-34-', true
  where exists (select 1 from accounts where code = 'A120');
insert into bank_accounts (account, kind, ref_prefix, holder)
  select 'A110', 'cash', 'PT-', 'Office' where exists (select 1 from accounts where code = 'A110');

-- New codes under the existing headings (agreed 2026-10-11): the credit card, petty cash, bank charges and bank interest.
insert into accounts (code, name, type, parent, postable, is_bank, is_system)
  select 'L115', 'CIB credit card ···0012', 'liability', 'L100', true, true, true where exists (select 1 from accounts where code = 'L100');
insert into bank_accounts (account, kind, bank_name, account_no, credit_limit, ref_prefix)
  select 'L115', 'card', 'Commercial International Bank (CIB)', '···0012', 90000, 'CC-12-' where exists (select 1 from accounts where code = 'L115');
insert into accounts (code, name, type, parent, postable, is_bank, is_system)
  select 'A115', 'Petty cash – accountant', 'asset', 'A100', true, true, true where exists (select 1 from accounts where code = 'A100');
insert into bank_accounts (account, kind, ref_prefix, holder)
  select 'A115', 'cash', 'PT-', 'Accountant' where exists (select 1 from accounts where code = 'A115');
insert into accounts (code, name, type, parent, postable, cost_type, project_id)
  select '14005', 'رسوم بنكية', 'expense', '10000', true, 'Opex', (select id from projects where is_office limit 1) where exists (select 1 from accounts where code = '10000');
insert into accounts (code, name, type, parent, postable, is_system)
  select 'R130', 'Bank interest', 'revenue', 'R100', true, true where exists (select 1 from accounts where code = 'R100');
update settings set account_map = account_map || '{"bankCharges": "14005", "interest": "R130"}'::jsonb where id = 1;
