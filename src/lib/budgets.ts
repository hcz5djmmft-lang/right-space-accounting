import 'server-only';
import { sql } from './db';
import { fmt, r2 } from './money';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit } from './books';
import { today, lastDay as monthEnd } from './dates';
import { readSpreadsheet } from './xlsx';
import { parseMoney } from './statements';

// Monthly budgets (improvement 12). Finance sets an amount per month for each project or department, for all its costs
// or for one GL code, typed on the page or uploaded from Excel. The page sets each against what was actually spent
// (posted expense lines of the month; a GL code budget also counts its project copies and the codes under it), and a task goes to the cost center's owner when it reaches 80% and again at 100%.

export type BudgetRow = {
  id: string; period: string; project_id: string | null; dept_id: string | null; cc: string; cc_name: string; account: string | null; account_name: string | null;
  amount: number; actual: number; left: number; pct: number | null;
};

const checkPeriod = (p: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new RuleError('Pick a month.'); };
const monthName = (p: string) => new Date(p + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The month's budgets with what was spent against each. */
export async function budgetRows(period: string): Promise<BudgetRow[]> {
  checkPeriod(period);
  const from = period + '-01', to = monthEnd(period);
  const rows = await sql<Omit<BudgetRow, 'left' | 'pct'>[]>`
    select b.id::text id, b.period, b.project_id, b.dept_id, coalesce(p.code, d.code) cc, coalesce(p.name, d.name) cc_name, b.account, a.name account_name, b.amount::float amount,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts x on x.code = l.account and x.type = 'expense'
        where e.date between ${from}::date and ${to}::date
          and (l.project_id = b.project_id or l.dept_id = b.dept_id)
          and (b.account is null or l.account = b.account or l.account like b.account || '-%' or x.parent = b.account)), 0)::float actual
    from monthly_budgets b left join projects p on p.id = b.project_id left join departments d on d.id = b.dept_id left join accounts a on a.code = b.account
    where b.period = ${period} order by (b.project_id is null), coalesce(p.code, d.code), b.account nulls first`;
  return rows.map(r => ({ ...r, actual: r2(r.actual), left: r2(r.amount - r.actual), pct: r.amount ? Math.round(r.actual / r.amount * 100) : null }));
}

/** Cost centers that spent in the month without a budget. */
export async function unbudgeted(period: string) {
  checkPeriod(period);
  const from = period + '-01', to = monthEnd(period);
  return sql<{ project_id: string | null; dept_id: string | null; cc: string; cc_name: string; actual: number }[]>`
    select l.project_id, l.dept_id, coalesce(p.code, d.code) cc, coalesce(p.name, d.name) cc_name, sum(l.dr - l.cr)::float actual
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts x on x.code = l.account and x.type = 'expense'
    left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id
    where e.date between ${from}::date and ${to}::date and (l.project_id is not null or l.dept_id is not null)
      and not exists (select 1 from monthly_budgets b where b.period = ${period} and (b.project_id = l.project_id or b.dept_id = l.dept_id))
    group by l.project_id, l.dept_id, p.code, d.code, p.name, d.name having sum(l.dr - l.cr) <> 0 order by 3`;
}

export type BudgetInput = { period: string; cc: string; account?: string | null; amount: number };

/** Finds a project or department by its id, its code (PH-B1302, FIN) or its name. */
async function costCenter(cc: string) {
  const t = cc.trim().replace(/^[pd]:/, '');
  const [p] = await sql<{ id: string }[]>`select id from projects where id = ${t} or lower(code) = lower(${t}) or lower(name) = lower(${t}) limit 1`;
  if (p && !cc.startsWith('d:')) return { project: p.id, dept: null };
  const [d] = await sql<{ id: string }[]>`select id from departments where id = ${t} or lower(code) = lower(${t}) or lower(name) = lower(${t}) limit 1`;
  if (d) return { project: null, dept: d.id };
  throw new RuleError(`No project or department called "${t}".`);
}

/** Saves budget lines: an amount of 0 removes the line. */
export async function saveBudgets(user: User, lines: BudgetInput[], note = 'Budgets saved') {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance sets budgets.');
  const resolved: { project: string | null; dept: string | null; period: string; account: string | null; amount: number }[] = [];
  for (const l of lines) {
    checkPeriod(l.period);
    if (!(l.amount >= 0)) throw new RuleError('A budget cannot be negative.');
    const c = await costCenter(l.cc);
    const account = l.account?.trim() || null;
    if (account) {
      const [a] = await sql<{ type: string }[]>`select type from accounts where code = ${account}`;
      if (!a) throw new RuleError(`GL code ${account} does not exist.`);
      if (a.type !== 'expense') throw new RuleError(`GL code ${account} is not an expense code.`);
    }
    resolved.push({ ...c, period: l.period, account, amount: r2(l.amount) });
  }
  await sql.begin(async tx => {
    for (const l of resolved) {
      const key = tx`period = ${l.period} and coalesce(project_id, '') = ${l.project ?? ''} and coalesce(dept_id, '') = ${l.dept ?? ''} and coalesce(account, '') = ${l.account ?? ''}`;
      if (!l.amount) { await tx`delete from monthly_budgets where ${key}`; continue; }
      const [had] = await tx<{ id: string; amount: number }[]>`select id, amount::float amount from monthly_budgets where ${key}`;
      if (had) {
        await tx`update monthly_budgets set amount = ${l.amount}, updated_by = ${user.id}, updated_at = now() where id = ${had.id}`;
        // a raised budget may cross the alert levels again
        if (l.amount > had.amount) await tx`delete from monthly_budget_alerts where budget_id = ${had.id}`;
      } else await tx`insert into monthly_budgets (period, project_id, dept_id, account, amount, updated_by) values (${l.period}, ${l.project}, ${l.dept}, ${l.account}, ${l.amount}, ${user.id})`;
    }
    await audit(tx, user, 'budget', resolved[0]?.period ?? '', note, `${resolved.length} lines`);
  });
  return resolved.length;
}

/** Copies the previous month's budgets into a month that has none. */
export async function copyBudgets(user: User, period: string) {
  checkPeriod(period);
  const [y, m] = period.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from monthly_budgets where period = ${period}`;
  if (n) throw new RuleError('This month already has budgets.');
  const rows = await sql<{ project_id: string | null; dept_id: string | null; account: string | null; amount: number }[]>`select project_id, dept_id, account, amount::float amount from monthly_budgets where period = ${prev}`;
  if (!rows.length) throw new RuleError(`${monthName(prev)} has no budgets to copy.`);
  return saveBudgets(user, rows.map(r => ({ period, cc: r.project_id ? 'p:' + r.project_id : 'd:' + r.dept_id, account: r.account, amount: r.amount })), `Budgets copied from ${prev}`);
}

const HEAD = { period: /^(month|period|الشهر)$/i, cc: /^(cost ?cent(er|re)|project|department|dept|المشروع|القسم|مركز التكلفة)$/i, account: /^(gl( code)?|account|code|الحساب|كود)$/i, amount: /^(amount|budget|value|المبلغ|الموازنة)$/i };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A column header that names a month: 2026-10, 10/2026, Oct 2026, October-26. */
export function headerMonth(h: string, year: string) {
  const t = h.trim().toLowerCase();
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/](\d{4})$/.exec(t);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const w = /^([a-z]{3})[a-z]*[\s\-']*(\d{2}|\d{4})?$/.exec(t);
  if (w && MONTHS.includes(w[1])) {
    const yy = w[2] ? (w[2].length === 2 ? '20' + w[2] : w[2]) : year;
    return `${yy}-${String(MONTHS.indexOf(w[1]) + 1).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Reads a budget file (Excel or CSV). Either one line per budget (Month, Cost center, GL code, Amount) or one row per
 * cost center (and GL code) with a column per month (Jan 2026, Feb 2026 … or 2026-01 …).
 */
export function parseBudgetFile(buf: Buffer, fileName: string, year = today().slice(0, 4)): BudgetInput[] {
  let rows: string[][];
  try { rows = readSpreadsheet(buf, fileName); } catch (e) { throw new RuleError(e instanceof Error ? e.message : 'The file could not be read.'); }
  for (let h = 0; h < Math.min(rows.length, 20); h++) {
    const head = rows[h].map(c => String(c ?? '').trim());
    const col = (re: RegExp) => head.findIndex(c => re.test(c));
    const cc = col(HEAD.cc), acc = col(HEAD.account), per = col(HEAD.period), amt = col(HEAD.amount);
    if (cc < 0) continue;
    const months = head.map((c, i) => [i, headerMonth(c, year)] as const).filter((x): x is readonly [number, string] => !!x[1]);
    const out: BudgetInput[] = [];
    for (const r of rows.slice(h + 1)) {
      const center = String(r[cc] ?? '').trim();
      if (!center || /^total/i.test(center)) continue;
      const account = acc >= 0 ? String(r[acc] ?? '').trim() || null : null;
      if (per >= 0 && amt >= 0) {
        const p = headerMonth(String(r[per] ?? ''), year), a = parseMoney(String(r[amt] ?? ''));
        if (p && a !== null) out.push({ period: p, cc: center, account, amount: a });
      } else for (const [i, p] of months) {
        const a = parseMoney(String(r[i] ?? ''));
        if (a !== null) out.push({ period: p, cc: center, account, amount: a });
      }
    }
    if (out.length) return out;
  }
  throw new RuleError('No budget lines found. Use the columns Month, Cost center, GL code (optional) and Amount, or a Cost center column with a column per month.');
}

export async function importBudgets(user: User, buf: Buffer, fileName: string) {
  return saveBudgets(user, parseBudgetFile(buf, fileName), `Budgets uploaded from ${fileName.slice(0, 80)}`);
}

/** Who hears about a budget: the project's manager (else site engineer), or the department head; else the head of Finance. */
async function ownerOf(b: { project_id: string | null; dept_id: string | null }) {
  const [o] = b.project_id
    ? await sql<{ id: string | null }[]>`select coalesce(m.user_id, s.user_id) id from projects p left join employees m on m.id = p.manager_id left join employees s on s.id = p.site_eng_id where p.id = ${b.project_id}`
    : await sql<{ id: string | null }[]>`select head_user_id id from departments where id = ${b.dept_id}`;
  if (o?.id) return o.id;
  const [f] = await sql<{ id: string | null }[]>`select d.head_user_id id from departments d where d.code = 'FIN'`;
  return f?.id ?? null;
}

/** Raises a task at 80% and at 100% of each budget of the month (and the month before, for late postings). Safe to run often. */
export async function raiseBudgetAlerts(now = today()) {
  const cur = now.slice(0, 7), [y, m] = cur.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  let raised = 0;
  for (const period of [prev, cur]) {
    for (const b of await budgetRows(period)) {
      if (b.pct === null || b.pct < 80) continue;
      const level = b.pct >= 100 ? 100 : 80;
      const had = await sql<{ level: number }[]>`select level from monthly_budget_alerts where budget_id = ${b.id}`;
      if (had.some(h => h.level >= level)) continue;
      const assignee = await ownerOf(b);
      const what = `${b.cc}${b.account ? ` ${b.account}` : ''} ${monthName(period)}`;
      const title = level === 100 ? `Budget used up: ${what}, ${fmt(b.actual)} of ${fmt(b.amount)} (${b.pct}%)` : `Budget ${b.pct}% used: ${what}, ${fmt(b.actual)} of ${fmt(b.amount)}`;
      const [t] = await sql<{ id: string }[]>`insert into tasks (title, details, priority, due, assignee_id, link_type, link_id, link_label)
        values (${title}, ${'Spending has reached ' + level + '% of the budget. Check what is left before approving more.'}, ${level === 100 ? 'high' : 'normal'}, ${now}, ${assignee}, 'budget', ${period}, ${'Budgets ' + monthName(period)}) returning id`;
      await sql`insert into monthly_budget_alerts (budget_id, level, task_id) values (${b.id}, ${level}, ${t.id}) on conflict do nothing`;
      if (level === 100) await sql`insert into monthly_budget_alerts (budget_id, level, task_id) values (${b.id}, 80, null) on conflict do nothing`;
      raised++;
    }
  }
  return raised;
}
