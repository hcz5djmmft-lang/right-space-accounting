-- Clock in and out from the phone (Adel, 2026-10-13): time, GPS position and a selfie per clock-in and clock-out, kept for HR to check.
-- Office staff may clock in only at the office (the location is an HR setting); site staff anywhere, and HR sees where.
-- Timesheets give lateness and overtime to payroll; designers clock their hours onto a project, costed from their salary.

alter table settings add column hr jsonb not null default '{}';   -- office position and radius, work hours, grace, weekend, overtime rate (lib/attendance-calc.ts)

create table attendance (
  id           text primary key default gen_random_uuid()::text,
  employee_id  text not null references employees(id),
  day          date not null,                       -- the company day of the clock-in (Cairo)
  in_at        timestamptz not null,
  out_at       timestamptz,
  in_lat       numeric(9,6), in_lng numeric(9,6), in_acc numeric(8,1),
  in_place     text not null default 'unknown' check (in_place in ('office','site','away','unknown')),
  out_lat      numeric(9,6), out_lng numeric(9,6), out_acc numeric(8,1),
  out_place    text check (out_place in ('office','site','away','unknown')),
  late_min     int not null default 0,
  overtime_min int not null default 0,
  worked_min   int not null default 0,
  checked_by   text references users(id),           -- HR looked at the selfies and the place
  checked_at   timestamptz,
  hr_note      text not null default '',
  created_at   timestamptz not null default now()
);
create index on attendance (employee_id, day);
create index on attendance (day);
-- one open clock-in per employee at a time
create unique index attendance_open_one on attendance (employee_id) where out_at is null;

create table design_sessions (
  id          text primary key default gen_random_uuid()::text,
  employee_id text not null references employees(id),
  project_id  text not null references projects(id),
  start_at    timestamptz not null,
  end_at      timestamptz,
  minutes     int not null default 0,
  rate        numeric(12,2) not null default 0,     -- the designer's cost per hour when the session ended
  cost        numeric(14,2) not null default 0,
  note        text not null default ''
);
create index on design_sessions (project_id);
create index on design_sessions (employee_id, start_at);
create unique index design_open_one on design_sessions (employee_id) where end_at is null;

-- Lateness taken off the month's pay (from the timesheet, or typed), beside overtime added to it.
alter table payroll_lines add column late numeric(18,2) not null default 0;
