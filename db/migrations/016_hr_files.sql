-- HR employee files (Adel, 2026-10-13): every employee has a file with personal and contract data, an Office or Site flag,
-- the documents of the company's Employment Documents form with their files, and a login created from the file.
-- Tasks can be assigned to any employee, with or without a login.

alter table employees add column work_location text not null default 'office' check (work_location in ('office','site'));
alter table employees add column national_id text;
alter table employees add column phone text;
alter table employees add column personal_email text;
alter table employees add column address text;
alter table employees add column birth_date date;
alter table employees add column gender text check (gender in ('male','female'));
alter table employees add column contract_type text;      -- permanent | fixed | probation | daily
alter table employees add column contract_start date;
alter table employees add column contract_end date;
alter table employees add column probation_end date;
alter table employees add column insurance_no text;
alter table employees add column emergency_name text;
alter table employees add column emergency_phone text;
alter table employees add column notes text;

-- One row per document of the form and employee: received, missing or not applicable (a woman has no military certificate).
create table employee_documents (
  employee_id text not null references employees(id) on delete cascade,
  key         text not null,
  status      text not null default 'missing' check (status in ('missing','received','na')),
  qty         int,                      -- photographs: how many were handed in
  received_on date,
  note        text not null default '',
  primary key (employee_id, key)
);

-- A file can say which document of the form it is (the tag is the document key); receipts have none.
alter table attachments add column tag text;

-- A task's assignee is an employee; the login is kept beside it so "assigned to me" and the badge still work.
alter table tasks add column assignee_emp_id text references employees(id);
update tasks t set assignee_emp_id = e.id from employees e where e.user_id = t.assignee_id and t.assignee_emp_id is null;

-- Admin & HR members do HR work.
update departments set roles = array_append(roles, 'hr') where code = 'ADM' and not ('hr' = any(roles));
