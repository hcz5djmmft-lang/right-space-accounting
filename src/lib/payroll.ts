import 'server-only';
import { sql, type Tx } from './db';
import { audit, checkLock, getSettings, nextNo, postEntry, validateLines, writeLines } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { monthEnd, payLine, payrollLines, rates, runTotals, salaryPaymentLines, type PayLine } from './payroll-calc';

// Employees and monthly payroll runs. Finance (and Management) only: salary data is private.

const needFinance = (u: User, what: string) => { if (!hasRole(u, 'finance')) throw new RuleError(`Only Finance can ${what}.`); };

export type Employee = {
  id: string; code: string | null; name: string; job_title: string | null; dept_id: string | null; dept_name: string | null;
  project_id: string | null; project_code: string | null; hire_date: string | null; basic: number; allowances: number; insurable: number;
  bank_account: string | null; active: boolean; in_runs: boolean;
};
const empSelect = (tx: Tx) => tx<Employee[]>`
  select e.id, e.code, e.name, e.job_title, e.dept_id, d.name dept_name, e.project_id, p.code project_code, to_char(e.hire_date,'YYYY-MM-DD') hire_date,
    e.basic, e.allowances, e.insurable, e.bank_account, e.active, exists (select 1 from payroll_lines l where l.employee_id = e.id) in_runs
  from employees e left join departments d on d.id = e.dept_id left join projects p on p.id = e.project_id order by e.code, e.name`;
export const listEmployees = () => empSelect(sql);
export async function getEmployee(id: string) { return (await empSelect(sql)).find(e => e.id === id); }

export type EmployeeInput = {
  id?: string; code: string; name: string; job_title: string; dept_id?: string | null; project_id?: string | null; hire_date?: string | null;
  basic: number; allowances: number; insurable: number; bank_account: string; active: boolean;
};
export async function saveEmployee(user: User, i: EmployeeInput) {
  needFinance(user, 'edit employees');
  if (!i.name.trim()) throw new RuleError('Enter the employee name.');
  return sql.begin(async tx => {
    const code = i.code.trim() || await nextNo(tx, 'E', 3);
    const vals = { code, name: i.name.trim(), job_title: i.job_title || null, dept_id: i.dept_id || null, project_id: i.project_id || null, hire_date: i.hire_date || null,
      basic: i.basic, allowances: i.allowances, insurable: i.insurable, bank_account: i.bank_account || null, active: i.active };
    let id = i.id;
    if (id) {
      const n = await tx`update employees set ${tx(vals)} where id = ${id}`;
      if (!n.count) throw new RuleError('Employee not found.');
    } else {
      [{ id }] = await tx<{ id: string }[]>`insert into employees ${tx(vals)} returning id`;
    }
    await audit(tx, user, 'employee', id!, i.id ? 'Edited' : 'Created', vals.name);
    return id!;
  });
}
export async function deleteEmployee(user: User, id: string) {
  needFinance(user, 'delete employees');
  await sql.begin(async tx => {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from payroll_lines where employee_id = ${id}`;
    if (n) throw new RuleError('This employee is in a payroll run. Mark them inactive instead.');
    const [e] = await tx<{ name: string }[]>`delete from employees where id = ${id} returning name`;
    if (e) await audit(tx, user, 'employee', id, 'Deleted', e.name);
  });
}

export type Run = { period: string; date: string; status: string; entry_id: string | null; entry_no: string | null; paid_entry_id: string | null; paid_no: string | null; employees: number; gross: number; net: number };
export const listRuns = () => sql<Run[]>`
  select r.period, to_char(r.date,'YYYY-MM-DD') date, r.status, r.entry_id, e.no entry_no, r.paid_entry_id, pe.no paid_no,
    (select count(*)::int from payroll_lines l where l.run_period = r.period) employees,
    coalesce((select sum(l.gross) from payroll_lines l where l.run_period = r.period),0) gross,
    coalesce((select sum(l.net) from payroll_lines l where l.run_period = r.period),0) net
  from payroll_runs r left join journal_entries e on e.id = r.entry_id left join journal_entries pe on pe.id = r.paid_entry_id
  order by r.period desc`;

export type RunLine = PayLine & { employee_id: string; name: string; code: string | null; project_id: string | null; dept_id: string | null; cc: string | null };
const runLines = (tx: Tx, period: string) => tx<RunLine[]>`
  select l.employee_id, l.name, e.code, l.project_id, l.dept_id, coalesce(p.code, d.name) cc,
    l.basic, l.allowances, l.overtime, l.deductions, l.gross, l.insurable, l.soc_emp, l.soc_co, l.tax, l.net
  from payroll_lines l join employees e on e.id = l.employee_id left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id
  where l.run_period = ${period} order by l.line_no`;

export async function getRun(period: string) {
  const [run] = await sql<Run[]>`select * from (${listRuns()}) r where r.period = ${period}`;
  if (!run) return null;
  const lines = await runLines(sql, period);
  return { run, lines, totals: runTotals(lines) };
}

async function lockRun(tx: Tx, period: string, editable = true) {
  const [run] = await tx<{ period: string; date: string; status: string; entry_id: string | null; paid_entry_id: string | null }[]>`
    select period, to_char(date,'YYYY-MM-DD') date, status, entry_id, paid_entry_id from payroll_runs where period = ${period} for update`;
  if (!run) throw new RuleError('Payroll run not found.');
  if (editable && !['draft', 'rejected'].includes(run.status)) throw new RuleError('This payroll is posted and cannot be changed.');
  return run;
}

/** Starts the month's run with every active employee at their current salary. */
export async function createRun(user: User, period: string, date: string) {
  needFinance(user, 'run payroll');
  if (!/^\d{4}-\d{2}$/.test(period)) throw new RuleError('Choose a month.');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    const R = rates(s.payroll);
    const [dup] = await tx`select 1 from payroll_runs where period = ${period}`;
    if (dup) throw new RuleError(`A payroll run for ${period} already exists.`);
    const emps = await tx<Employee[]>`select id, name, project_id, dept_id, basic, allowances, insurable from employees where active order by code, name`;
    if (!emps.length) throw new RuleError('Add active employees first.');
    await tx`insert into payroll_runs (period, date, created_by) values (${period}, ${date || monthEnd(period)}, ${user.id})`;
    for (const [k, e] of emps.entries()) {
      const l = payLine(e, 0, 0, R);
      await tx`insert into payroll_lines ${tx({ run_period: period, employee_id: e.id, line_no: k + 1, name: e.name, project_id: e.project_id, dept_id: e.dept_id, ...l })}`;
    }
    await audit(tx, user, 'payroll', period, 'Created', `${emps.length} employees`);
  });
}

/** Saves overtime and deductions, recalculating each line; with `refresh`, salaries and cost centers are re-read from the employee records. */
export async function saveRun(user: User, period: string, edits: { employee_id: string; overtime: number; deductions: number }[], refresh = false) {
  needFinance(user, 'edit payroll');
  await sql.begin(async tx => {
    await lockRun(tx, period);
    const R = rates((await getSettings(tx)).payroll);
    const lines = await runLines(tx, period);
    const emps = new Map((await tx<Employee[]>`select id, name, project_id, dept_id, basic, allowances, insurable from employees`).map(e => [e.id, e]));
    for (const l of lines) {
      const ed = edits.find(e => e.employee_id === l.employee_id);
      const base = refresh && emps.get(l.employee_id) ? emps.get(l.employee_id)! : { name: l.name, project_id: l.project_id, dept_id: l.dept_id, basic: l.basic, allowances: l.allowances, insurable: l.insurable };
      const n = payLine(base, ed ? ed.overtime : l.overtime, ed ? ed.deductions : l.deductions, R);
      await tx`update payroll_lines set ${tx({ name: base.name, project_id: base.project_id, dept_id: base.dept_id, ...n })} where run_period = ${period} and employee_id = ${l.employee_id}`;
    }
    await audit(tx, user, 'payroll', period, refresh ? 'Refreshed from employee records' : 'Saved');
  });
}

export async function deleteRun(user: User, period: string) {
  needFinance(user, 'delete payroll');
  await sql.begin(async tx => {
    await lockRun(tx, period);
    await tx`delete from payroll_runs where period = ${period}`;
    await audit(tx, user, 'payroll', period, 'Deleted');
  });
}

/** Posts the month: salaries and company insurance per cost center, against insurance, tax, advances and net salaries payable. */
export async function postRun(user: User, period: string) {
  needFinance(user, 'post payroll');
  return sql.begin(async tx => {
    const run = await lockRun(tx, period);
    const s = await getSettings(tx);
    checkLock(s, run.date);
    const lines = await runLines(tx, period);
    if (!lines.length) throw new RuleError('This run has no employees.');
    if (s.require_cc) {
      const miss = lines.filter(l => !l.project_id && !l.dept_id).map(l => l.name);
      if (miss.length) throw new RuleError(`Give ${miss.join(', ')} a project or a department, then refresh the run.`);
    }
    const jl = payrollLines(period, lines, s.account_map);
    await validateLines(tx, jl, s, { officeOnProject: true });
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${run.date}, ${'Payroll ' + period}, ${'PR-' + period}, 'payroll', 'draft', 'payroll', ${period}, ${user.id}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Posted from payroll ' + period);
    await tx`update payroll_runs set status = 'posted', entry_id = ${eid} where period = ${period}`;
    await audit(tx, user, 'payroll', period, 'Posted', `Journal entry ${jno}`);
    return eid;
  });
}

/** Pays the net salaries from a bank account: Dr net salaries payable, Cr bank. */
export async function paySalaries(user: User, period: string, bank: string, date: string) {
  needFinance(user, 'pay salaries');
  return sql.begin(async tx => {
    const run = await lockRun(tx, period, false);
    if (run.status !== 'posted') throw new RuleError('Post the payroll first.');
    if (run.paid_entry_id) throw new RuleError('These salaries are already paid.');
    const s = await getSettings(tx);
    checkLock(s, date);
    const net = runTotals(await runLines(tx, period)).net;
    if (net <= 0) throw new RuleError('There is nothing to pay.');
    const jl = salaryPaymentLines(period, net, bank, s.account_map);
    await validateLines(tx, jl, s);
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${date}, ${'Salary payment ' + period}, ${'PR-' + period}, 'payment', 'draft', 'payroll', ${period}, ${user.id}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Salary payment ' + period);
    await tx`update payroll_runs set paid_entry_id = ${eid} where period = ${period}`;
    await audit(tx, user, 'payroll', period, 'Salaries paid', `Journal entry ${jno} from ${bank}`);
    return eid;
  });
}
