-- Update 20 (Adel, 2026-10-15).

-- Item 9: access per sub-category. Null = never set one by one: the person keeps what their roles and department gave.
alter table users add column if not exists access text[];

-- Item 28: the department is Procurement, not Purchasing.
update departments set name = 'Procurement' where code = 'PUR' and name = 'Purchasing';
