import 'server-only';
import { sql } from './db';
import { DOCUMENTS } from './hr';
import { balanceOf } from './leave';

// What HR looks at: reminders, headcount, leave balances, documents and the KPIs from tasks and attendance.

export type Reminder = { kind: string; employee_id: string; name: string; text: string; due: string | null; urgent: boolean };
/** Things HR must act on soon: contracts and probations ending, no insurance number, missing documents, requests waiting, days left open. */
export async function reminders(today: string): Promise<Reminder[]> {
  const rows = await sql<{ id: string; name: string; contract_end: string | null; probation_end: string | null; insurance_no: string | null; no_deductions: boolean; missing: number; open_days: number; waiting: number; waiting_days: number }[]>`
    select e.id, e.name, to_char(e.contract_end,'YYYY-MM-DD') contract_end, to_char(e.probation_end,'YYYY-MM-DD') probation_end, e.insurance_no, e.no_deductions,
      (${DOCUMENTS.length} - (select count(*)::int from employee_documents x where x.employee_id = e.id and x.status in ('received','na'))) missing,
      (select count(*)::int from attendance a where a.employee_id = e.id and a.out_at is null and a.day < ${today}::date) open_days,
      (select count(*)::int from leave_requests r where r.employee_id = e.id and r.status in ('head','hr')) waiting,
      coalesce((select max(${today}::date - r.created_at::date) from leave_requests r where r.employee_id = e.id and r.status in ('head','hr')),0)::int waiting_days
    from employees e where e.active order by e.code, e.name`;
  const soon = (d: string | null, days: number) => !!d && d >= today && daysBetween(today, d) <= days;
  const out: Reminder[] = [];
  for (const e of rows) {
    if (e.contract_end && e.contract_end < today) out.push({ kind: 'contract', employee_id: e.id, name: e.name, text: `Contract ended ${e.contract_end}: renew it or close the file`, due: e.contract_end, urgent: true });
    else if (soon(e.contract_end, 30)) out.push({ kind: 'contract', employee_id: e.id, name: e.name, text: `Contract ends ${e.contract_end}`, due: e.contract_end, urgent: daysBetween(today, e.contract_end!) <= 7 });
    if (e.probation_end && e.probation_end < today) out.push({ kind: 'probation', employee_id: e.id, name: e.name, text: `Probation ended ${e.probation_end}: confirm or end the contract`, due: e.probation_end, urgent: true });
    else if (soon(e.probation_end, 14)) out.push({ kind: 'probation', employee_id: e.id, name: e.name, text: `Probation ends ${e.probation_end}`, due: e.probation_end, urgent: false });
    if (!e.insurance_no && !e.no_deductions) out.push({ kind: 'insurance', employee_id: e.id, name: e.name, text: 'No social insurance number on the file', due: null, urgent: false });
    if (e.missing > 0) out.push({ kind: 'documents', employee_id: e.id, name: e.name, text: `${e.missing} employment documents missing`, due: null, urgent: false });
    if (e.waiting > 0) out.push({ kind: 'leave', employee_id: e.id, name: e.name, text: `${e.waiting} leave request${e.waiting > 1 ? 's' : ''} waiting${e.waiting_days >= 3 ? ` for ${e.waiting_days} days` : ''}`, due: null, urgent: e.waiting_days >= 3 });
    if (e.open_days > 0) out.push({ kind: 'attendance', employee_id: e.id, name: e.name, text: `${e.open_days} day${e.open_days > 1 ? 's' : ''} without a clock-out`, due: null, urgent: false });
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.due ?? '9').localeCompare(b.due ?? '9'));
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export type Headcount = { dept: string; office: number; site: number; total: number; with_login: number };
export const headcount = () => sql<Headcount[]>`
  select coalesce(d.name, 'No department') dept, count(*) filter (where e.work_location = 'office')::int office, count(*) filter (where e.work_location = 'site')::int site,
    count(*)::int total, count(*) filter (where exists (select 1 from users u where u.id = e.user_id and u.active))::int with_login
  from employees e left join departments d on d.id = e.dept_id where e.active group by d.name order by d.name nulls last`;

export type LeaveRow = { employee_id: string; code: string | null; name: string; dept_name: string | null; entitlement: number; taken: number; pending: number; balance: number; sick: number; unpaid: number };
/** Every active employee's annual balance for the year, with sick and unpaid days beside it. */
export async function leaveBalances(year: number): Promise<LeaveRow[]> {
  const emps = await sql<{ id: string; code: string | null; name: string; dept_name: string | null; sick: number; unpaid: number }[]>`
    select e.id, e.code, e.name, d.name dept_name,
      coalesce((select sum(days) from leave_requests r where r.employee_id = e.id and r.status = 'approved' and r.type = 'sick' and extract(year from r.from_date) = ${year}),0)::float sick,
      coalesce((select sum(days) from leave_requests r where r.employee_id = e.id and r.status = 'approved' and r.type = 'unpaid' and extract(year from r.from_date) = ${year}),0)::float unpaid
    from employees e left join departments d on d.id = e.dept_id where e.active order by e.code, e.name`;
  const out: LeaveRow[] = [];
  for (const e of emps) { const b = await balanceOf(e.id, year); out.push({ employee_id: e.id, code: e.code, name: e.name, dept_name: e.dept_name, entitlement: b.entitlement, taken: b.taken, pending: b.pending, balance: b.balance, sick: e.sick, unpaid: e.unpaid }); }
  return out;
}

export type Kpi = {
  employee_id: string; code: string | null; name: string; dept_name: string | null;
  assigned: number; done: number; on_time: number; late_done: number; open: number; overdue: number; avg_days: number | null;
  days_present: number; late_days: number; late_min: number; overtime_min: number; design_min: number;
};
/** Per employee for a month: the tasks given, finished, on time or late against the due date, still open or overdue, the average days to finish; plus attendance. */
export const kpis = (period: string, today: string) => sql<Kpi[]>`
  with t as (
    select t.assignee_emp_id emp, t.status, t.due, t.created_at, t.done_at from tasks t
    where t.assignee_emp_id is not null and (to_char(t.created_at at time zone 'Africa/Cairo','YYYY-MM') = ${period} or to_char(t.done_at at time zone 'Africa/Cairo','YYYY-MM') = ${period} or (t.status <> 'done' and to_char(t.created_at at time zone 'Africa/Cairo','YYYY-MM') <= ${period}))
  )
  select e.id employee_id, e.code, e.name, d.name dept_name,
    (select count(*)::int from t where t.emp = e.id) assigned,
    (select count(*)::int from t where t.emp = e.id and t.status = 'done') done,
    (select count(*)::int from t where t.emp = e.id and t.status = 'done' and (t.due is null or t.done_at::date <= t.due)) on_time,
    (select count(*)::int from t where t.emp = e.id and t.status = 'done' and t.due is not null and t.done_at::date > t.due) late_done,
    (select count(*)::int from t where t.emp = e.id and t.status <> 'done') open,
    (select count(*)::int from t where t.emp = e.id and t.status <> 'done' and t.due is not null and t.due < ${today}::date) overdue,
    (select round(avg(extract(epoch from (t.done_at - t.created_at)) / 86400)::numeric, 1)::float from t where t.emp = e.id and t.status = 'done') avg_days,
    (select count(*)::int from attendance a where a.employee_id = e.id and to_char(a.day,'YYYY-MM') = ${period}) days_present,
    (select count(*)::int from attendance a where a.employee_id = e.id and to_char(a.day,'YYYY-MM') = ${period} and a.late_min > 0) late_days,
    coalesce((select sum(a.late_min) from attendance a where a.employee_id = e.id and to_char(a.day,'YYYY-MM') = ${period}),0)::int late_min,
    coalesce((select sum(a.overtime_min) from attendance a where a.employee_id = e.id and to_char(a.day,'YYYY-MM') = ${period}),0)::int overtime_min,
    coalesce((select sum(s.minutes) from design_sessions s where s.employee_id = e.id and to_char(s.start_at at time zone 'Africa/Cairo','YYYY-MM') = ${period}),0)::int design_min
  from employees e left join departments d on d.id = e.dept_id where e.active order by e.code, e.name`;

export type DocRow = { employee_id: string; code: string | null; name: string; missing: string[] };
export async function documentsMissing(): Promise<DocRow[]> {
  const rows = await sql<{ id: string; code: string | null; name: string; keys: string[] }[]>`
    select e.id, e.code, e.name, coalesce(array_agg(x.key) filter (where x.key is not null), '{}') keys
    from employees e left join employee_documents x on x.employee_id = e.id and x.status in ('received','na') where e.active group by e.id order by e.code, e.name`;
  return rows.map(r => ({ employee_id: r.id, code: r.code, name: r.name, missing: DOCUMENTS.filter(d => !r.keys.includes(d.key)).map(d => d.name) })).filter(r => r.missing.length);
}
