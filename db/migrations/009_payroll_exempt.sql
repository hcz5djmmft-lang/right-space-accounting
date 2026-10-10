-- Staff who are paid the full salary, with no social insurance and no salary tax taken (Adel, 2026-10-10):
-- a switch on the employee record, remembered on each payroll line so a recalculation keeps it.

alter table employees add column no_deductions boolean not null default false;
alter table payroll_lines add column no_deductions boolean not null default false;

-- The staff loaded from the October 2026 payroll sheet (migration 007) pay neither.
update employees set no_deductions = true where id like 'emp-10__';
