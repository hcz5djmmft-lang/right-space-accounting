import 'server-only';
import { sql, type Tx } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { TZ } from './dates';

// Monthly pay items: what HR or Finance adds to or takes off a month's pay. The payroll run takes them in with one button.

export const KINDS = {
  overtime: { label: 'Overtime (typed)', col: 'overtime' },
  bonus: { label: 'Bonus', col: 'overtime' },
  penalty: { label: 'Penalty', col: 'late' },
  advance: { label: 'Advance recovered', col: 'deductions' },
  loan: { label: 'Loan instalment', col: 'deductions' },
  deduction: { label: 'Other deduction', col: 'deductions' },
} as const;
export type Kind = keyof typeof KINDS;
const needHR = (u: User, what: string) => { if (!hasRole(u, 'hr', 'finance')) throw new RuleError(`Only HR or Finance can ${what}.`); };

export type PayItem = { id: string; employee_id: string; name: string; code: string | null; period: string; kind: Kind; label: string; amount: number; note: string; loan_id: string | null; run_period: string | null; who: string | null; created_at: string };
export const listPayItems = async (opts: { period?: string; employee?: string } = {}) => (await sql<PayItem[]>`
  select i.id, i.employee_id, e.name, e.code, i.period, i.kind, i.kind label, i.amount, i.note, i.loan_id, i.run_period, u.name who, to_char(i.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at
  from pay_items i join employees e on e.id = i.employee_id left join users u on u.id = i.created_by
  where true ${opts.period ? sql`and i.period = ${opts.period}` : sql``} ${opts.employee ? sql`and i.employee_id = ${opts.employee}` : sql``}
  order by i.period desc, e.code, i.created_at`).map(i => ({ ...i, label: KINDS[i.kind].label }));

export async function addPayItem(user: User, i: { employee_id: string; period: string; kind: Kind; amount: number; note?: string }) {
  needHR(user, 'add pay items');
  if (!(i.kind in KINDS)) throw new RuleError('Choose the kind of item.');
  if (!/^\d{4}-\d{2}$/.test(i.period)) throw new RuleError('Choose the month.');
  if (!(i.amount > 0)) throw new RuleError('Enter the amount.');
  return sql.begin(async tx => {
    const [e] = await tx<{ name: string }[]>`select name from employees where id = ${i.employee_id}`;
    if (!e) throw new RuleError('Employee not found.');
    const [run] = await tx<{ status: string }[]>`select status from payroll_runs where period = ${i.period}`;
    if (run && run.status === 'posted') throw new RuleError(`Payroll ${i.period} is posted; put the item on the next month.`);
    const [r] = await tx<{ id: string }[]>`insert into pay_items (employee_id, period, kind, amount, note, created_by) values (${i.employee_id}, ${i.period}, ${i.kind}, ${r2(i.amount)}, ${(i.note ?? '').trim()}, ${user.id}) returning id`;
    await audit(tx, user, 'employee', i.employee_id, 'Pay item added', `${i.period} ${KINDS[i.kind].label} ${r2(i.amount)}`);
    return r.id;
  });
}
export async function removePayItem(user: User, id: string) {
  needHR(user, 'remove pay items');
  await sql.begin(async tx => {
    const [i] = await tx<{ employee_id: string; period: string; kind: Kind; amount: number; run_period: string | null }[]>`select employee_id, period, kind, amount, run_period from pay_items where id = ${id}`;
    if (!i) return;
    if (i.run_period) {
      const [run] = await tx<{ status: string }[]>`select status from payroll_runs where period = ${i.run_period}`;
      if (run && run.status === 'posted') throw new RuleError('This item is in a posted payroll and stays.');
    }
    await tx`delete from pay_items where id = ${id}`;
    await audit(tx, user, 'employee', i.employee_id, 'Pay item removed', `${i.period} ${KINDS[i.kind].label} ${i.amount}`);
  });
}

export type Loan = { id: string; employee_id: string; name: string; amount: number; monthly: number; start_period: string; note: string; closed: boolean; paid: number; remaining: number };
export const listLoans = (employee?: string) => sql<Loan[]>`
  select l.id, l.employee_id, e.name, l.amount, l.monthly, l.start_period, l.note, l.closed,
    coalesce((select sum(i.amount) from pay_items i where i.loan_id = l.id and i.run_period is not null),0) paid,
    l.amount - coalesce((select sum(i.amount) from pay_items i where i.loan_id = l.id),0) remaining
  from loans l join employees e on e.id = l.employee_id ${employee ? sql`where l.employee_id = ${employee}` : sql``} order by l.closed, l.start_period desc`;

/** A loan the company gave: paid out through the books as usual (staff advances), recovered by a monthly instalment from the start month. */
export async function addLoan(user: User, i: { employee_id: string; amount: number; monthly: number; start_period: string; note?: string }) {
  needHR(user, 'add loans');
  if (!(i.amount > 0) || !(i.monthly > 0)) throw new RuleError('Enter the loan amount and the monthly instalment.');
  if (i.monthly > i.amount) throw new RuleError('The instalment is larger than the loan.');
  if (!/^\d{4}-\d{2}$/.test(i.start_period)) throw new RuleError('Choose the first month of recovery.');
  return sql.begin(async tx => {
    const [e] = await tx<{ name: string }[]>`select name from employees where id = ${i.employee_id}`;
    if (!e) throw new RuleError('Employee not found.');
    const [r] = await tx<{ id: string }[]>`insert into loans (employee_id, amount, monthly, start_period, note, created_by) values (${i.employee_id}, ${r2(i.amount)}, ${r2(i.monthly)}, ${i.start_period}, ${(i.note ?? '').trim()}, ${user.id}) returning id`;
    await audit(tx, user, 'employee', i.employee_id, 'Loan added', `${r2(i.amount)} from ${i.start_period}, ${r2(i.monthly)} a month`);
    return r.id;
  });
}

/** Creates the month's instalment of every open loan that has reached its start month (once per month, the last one smaller). */
export async function dueInstalments(user: User | null, period: string, tx: Tx = sql) {
  const loans = await tx<{ id: string; employee_id: string; monthly: number; remaining: number }[]>`
    select l.id, l.employee_id, l.monthly, l.amount - coalesce((select sum(i.amount) from pay_items i where i.loan_id = l.id),0) remaining
    from loans l where not l.closed and l.start_period <= ${period} and not exists (select 1 from pay_items i where i.loan_id = l.id and i.period = ${period})`;
  let n = 0;
  for (const l of loans) {
    const amt = r2(Math.min(l.monthly, l.remaining));
    if (amt <= 0) { await tx`update loans set closed = true where id = ${l.id}`; continue; }
    await tx`insert into pay_items (employee_id, period, kind, amount, note, loan_id, created_by) values (${l.employee_id}, ${period}, 'loan', ${amt}, 'Loan instalment', ${l.id}, ${user?.id ?? null})`;
    if (amt >= l.remaining) await tx`update loans set closed = true where id = ${l.id}`;
    n++;
  }
  return n;
}

/** The month's items per employee, summed into the three payroll columns, and marks them as taken into the run. */
export async function takeIntoRun(period: string, tx: Tx) {
  const rows = await tx<{ employee_id: string; kind: Kind; amount: number }[]>`select employee_id, kind, amount from pay_items where period = ${period}`;
  const out = new Map<string, { overtime: number; late: number; deductions: number }>();
  for (const r of rows) {
    const t = out.get(r.employee_id) ?? { overtime: 0, late: 0, deductions: 0 };
    t[KINDS[r.kind].col] = r2(t[KINDS[r.kind].col] + r.amount);
    out.set(r.employee_id, t);
  }
  await tx`update pay_items set run_period = ${period} where period = ${period}`;
  return out;
}
