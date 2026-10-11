-- Departments as groups: each one has a head and says what its members may do; every login belongs to one.
-- Payment requests now go to the head of their department (a project's request to the head of Engineering), then to Management.
-- The links between departments and users are plain ids on purpose: a `truncate ... cascade` on one table must never
-- take the other with it (the cut-over import wipes departments; the logins have to survive that).
alter table departments add column head_user_id text;
alter table departments add column roles text[] not null default '{}';  -- what members may do: finance, engineering, projects, tenders, management
alter table users add column dept_id text;
alter table invoices add column approver_id text;      -- the department head who signs step 1, fixed when the request is submitted
alter table invoices add column approver_label text;   -- "Engineering head": shown while the request waits and kept on the approval

insert into departments (id, code, name) values ('pur', 'PUR', 'Purchasing') on conflict do nothing;
update departments set roles = case code
    when 'FIN' then '{finance}' when 'ENG' then '{engineering,projects}' when 'MGT' then '{management}' when 'S&M' then '{tenders}'
    else '{}' end::text[]
  where roles = '{}';

-- The approval chain: the department head first, then Management (the people ticked for the old step 3 stay ticked).
do $$
declare mgmt text[];
begin
  select user_ids into mgmt from approval_steps where position = 3;
  delete from approval_steps;
  insert into approval_steps (position, name, user_ids) values (1, 'Department head', '{}'), (2, 'Management', coalesce(mgmt, '{}'));
end $$;
update invoices set approver_label = 'Department head' where status = 'pending' and approver_label is null;

-- A database with one login so far: that person is the head of Finance and its first member.
update users set dept_id = (select id from departments where code = 'FIN') where dept_id is null and (select count(*) from users) = 1;
update departments set head_user_id = (select id from users limit 1) where code = 'FIN' and head_user_id is null and (select count(*) from users) = 1;
