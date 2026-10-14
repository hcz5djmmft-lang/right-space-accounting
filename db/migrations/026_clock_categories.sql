-- Clock-in categories and project pins (Adel, 2026-10-14). A clock-in now says what the person is doing: Office, Site on a project
-- or Design on a project (the list is data in lib/clock-categories.ts); the category can be switched during the day and each stretch
-- is a work session, the design clock generalised. Every project can carry a location pin with an allowed distance: a site clock-in
-- on a pinned project is checked against it the way office staff are checked against the office; an unpinned project only records.

alter table attendance add column category text not null default 'office';
alter table attendance add column project_id text references projects(id);
update attendance a set category = 'site' from employees e where e.id = a.employee_id and e.work_location = 'site';

alter table design_sessions rename to work_sessions;
alter table work_sessions add column category text not null default 'design';
alter table work_sessions alter column project_id drop not null;
alter table work_sessions add column attendance_id text references attendance(id);
alter index design_open_one rename to work_open_one;        -- still one open stretch per employee
create index on work_sessions (category);

alter table projects add column site_lat numeric(9,6);
alter table projects add column site_lng numeric(9,6);
alter table projects add column site_radius_m int not null default 200;
