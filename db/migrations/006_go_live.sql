-- Go-live: wrong-password counter and lock on logins; one login per email whatever its capitalisation;
-- the duplicate foreign key added by 003 goes.

alter table users add column failed_logins int not null default 0, add column locked_until timestamptz;
create unique index users_email_lower on users (lower(email));
alter table employees drop constraint if exists employees_project_fk;
