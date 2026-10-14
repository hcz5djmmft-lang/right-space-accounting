import 'server-only';
import { sql } from './db';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit, getSettings } from './books';
import { reconcile } from './banks';
import { TZ, lastDay } from './dates';
import { depreciationFor, depreciationRun } from './assets';

// Month-end close (improvement 9). For each month a checklist: the bank and the credit card reconciled through the
// month end, petty cash counted, payroll posted, the VAT return marked prepared, and nothing left waiting in the month.
// The system ticks what it can tell from the books; Finance ticks the rest. Management then locks the books to the
// month end: the lock date in Settings, which stops any entry being posted or changed on or before it.

export type CloseItem = { key: string; label: string; auto: boolean; done: boolean; detail: string; href: string };
export type Ticks = Record<string, { by: string; at: string }>;

const MANUAL = { petty: 'Petty cash counted' } as const;
export type ManualKey = keyof typeof MANUAL;
export const isManual = (k: string): k is ManualKey => k in MANUAL;

export const monthEnd = lastDay;
const prevEnd = (period: string) => new Date(Date.parse(period + '-01T00:00:00Z') - 864e5).toISOString().slice(0, 10);
const checkPeriod = (p: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new RuleError('Pick a month.'); };
const monthName = (p: string) => new Date(p + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function ticksOf(period: string) {
  const [r] = await sql<{ ticks: Ticks; closed_by: string | null; closed_at: string | null }[]>`
    select c.ticks, u.name closed_by, to_char(c.closed_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') closed_at
    from month_closes c left join users u on u.id = c.closed_by where c.period = ${period}`;
  return r ?? { ticks: {} as Ticks, closed_by: null, closed_at: null };
}

/** The checklist of one month (YYYY-MM). */
export async function closeChecklist(period: string) {
  checkPeriod(period);
  const start = period + '-01', end = monthEnd(period);
  const [banks, openLines, [run], [staff], [waiting], [vat], dep, depRun, saved, s] = await Promise.all([
    sql<{ code: string; name: string; kind: string; balance: number; cleared: number; stmt_date: string | null; stmt_balance: number | null }[]>`
      select a.code, a.name, coalesce(b.kind, 'bank') kind, to_char(s.stmt_date,'YYYY-MM-DD') stmt_date, s.stmt_balance::float stmt_balance,
        coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code), 0)::float balance,
        coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join bank_cleared c on c.line_id = l.id where l.account = a.code), 0)::float cleared
      from accounts a left join bank_accounts b on b.account = a.code left join bank_statements s on s.account = a.code
      where a.is_bank and a.postable and coalesce(b.kind, 'bank') in ('bank', 'card')
        and exists (select 1 from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code and e.date <= ${end}::date)
      order by a.code`,
    sql<{ account: string; n: number }[]>`select account, count(*)::int n from statement_lines where status = 'open' and date <= ${end}::date group by account`,
    sql<{ status: string }[]>`select status from payroll_runs where period = ${period}`,
    sql<{ n: number }[]>`select count(*)::int n from employees where active and coalesce(hire_date, '1900-01-01') <= ${end}::date`,
    sql<{ entries: number; invoices: number; expenses: number }[]>`
      select (select count(*) from journal_entries where status in ('draft', 'pending') and date between ${start}::date and ${end}::date)::int entries,
        (select count(*) from invoices where status = 'pending' and date between ${start}::date and ${end}::date)::int invoices,
        (select count(*) from expense_claims where status = 'pending' and date between ${start}::date and ${end}::date)::int expenses`,
    sql<{ by: string | null; at: string }[]>`select u.name by, to_char(v.prepared_at at time zone ${TZ},'YYYY-MM-DD') at from vat_returns v left join users u on u.id = v.prepared_by where v.period = ${period}`,
    depreciationFor(period),
    depreciationRun(period),
    ticksOf(period),
    getSettings(),
  ]);
  const open = new Map(openLines.map(l => [l.account, l.n]));
  const behind = banks.filter(b => !(b.stmt_date && b.stmt_date >= end && reconcile(b).reconciled && !open.get(b.code)));
  const manual = (key: ManualKey, href: string): CloseItem => {
    const t = saved.ticks[key];
    return { key, label: MANUAL[key], auto: false, done: !!t, detail: t ? `Ticked by ${t.by} on ${t.at}` : 'Tick when done', href };
  };
  const waitN = waiting.entries + waiting.invoices + waiting.expenses;
  const items: CloseItem[] = [
    { key: 'bank', label: 'Bank and credit card reconciled to the month end', auto: true, done: behind.length === 0, href: '/banks',
      detail: banks.length === 0 ? 'No bank activity this month' : behind.length === 0 ? 'Every statement reaches ' + end + ' and agrees with the books'
        : 'Still to do: ' + behind.map(b => `${b.name}${open.get(b.code) ? ` (${open.get(b.code)} statement lines not matched)` : !b.stmt_date || b.stmt_date < end ? ' (statement not up to the month end)' : ' (does not agree)'}`).join(', ') },
    manual('petty', '/banks'),
    { key: 'payroll', label: 'Payroll posted', auto: true, done: run?.status === 'posted' || staff.n === 0, href: `/payroll`,
      detail: run?.status === 'posted' ? `${period} payroll is posted` : staff.n === 0 ? 'No staff this month' : run ? `${period} payroll is ${run.status === 'pending' ? 'waiting for approval' : run.status}` : `No ${period} payroll yet` },
    { key: 'vat', label: 'VAT return prepared', auto: true, done: !!vat, href: `/reports/vat-return?m=${period}`,
      detail: vat ? `Prepared by ${vat.by ?? 'Finance'} on ${vat.at}` : 'Open the VAT return and press "Mark as prepared"' },
    { key: 'depreciation', label: 'Depreciation posted', auto: true, done: !!depRun || dep.length === 0, href: '/fixed-assets',
      detail: depRun ? `Posted as ${depRun.no}` : dep.length === 0 ? 'No assets to depreciate this month' : `${dep.length} assets to depreciate: press "Post depreciation" on the Fixed assets page` },
    { key: 'waiting', label: 'Nothing left waiting in the month', auto: true, done: waitN === 0, href: '/approvals',
      detail: waitN === 0 ? 'No drafts or approvals dated in the month' : [waiting.entries && `${waiting.entries} entries`, waiting.invoices && `${waiting.invoices} invoices or payment requests`, waiting.expenses && `${waiting.expenses} expenses`].filter(Boolean).join(', ') + ' still draft or waiting' },
  ];
  return { period, name: monthName(period), start, end, items, ready: items.every(i => i.done), locked: !!s.lock_date && s.lock_date >= end, lockDate: s.lock_date, closedBy: saved.closed_by, closedAt: saved.closed_at };
}

/** The months from the opening date to last month, newest first, each with how far its close has got. */
export async function closeMonths(now = new Date()) {
  const s = await getSettings();
  const first = (s.opening_date ?? '2026-01-01').slice(0, 7);
  const cur = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
  const months: string[] = [];
  for (let p = cur; p >= first && months.length < 24; p = prevEnd(p).slice(0, 7)) months.push(p);
  const saved = await sql<{ period: string; n: number; closed_at: string | null }[]>`
    select period, (select count(*) from jsonb_object_keys(ticks))::int n, to_char(closed_at,'YYYY-MM-DD') closed_at from month_closes where period in ${sql(months.length ? months : [''])}`;
  const by = new Map(saved.map(r => [r.period, r]));
  return months.map(p => ({ period: p, name: monthName(p), end: monthEnd(p), locked: !!s.lock_date && s.lock_date >= monthEnd(p), closedAt: by.get(p)?.closed_at ?? null, current: p === cur }));
}

/** Finance ticks (or unticks) a checklist item the system cannot tell by itself. */
export async function tickItem(user: User, period: string, key: string, on: boolean) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance ticks the month-end checklist.');
  checkPeriod(period);
  if (!isManual(key)) throw new RuleError('The system ticks that item by itself.');
  const at = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, dateStyle: 'short' }).format(new Date());
  await sql.begin(async tx => {
    await tx`insert into month_closes (period) values (${period}) on conflict do nothing`;
    if (on) await tx`update month_closes set ticks = ticks || ${tx.json({ [key]: { by: user.name, at } })} where period = ${period}`;
    else await tx`update month_closes set ticks = ticks - ${key} where period = ${period}`;
    await audit(tx, user, 'close', period, `${MANUAL[key]} ${on ? 'ticked' : 'unticked'}`);
  });
}

/** Management locks the books to the month end. Open items stop it unless Management locks anyway. */
export async function closeMonth(user: User, period: string, anyway = false) {
  if (!hasRole(user, 'management')) throw new RuleError('Only Management locks the books.');
  const c = await closeChecklist(period);
  if (c.locked) throw new RuleError(`The books are already locked to ${c.lockDate}.`);
  const left = c.items.filter(i => !i.done);
  if (left.length && !anyway) throw new RuleError(`Still open: ${left.map(i => i.label.toLowerCase()).join('; ')}. Finish them or tick "Lock anyway".`);
  await sql.begin(async tx => {
    await tx`update settings set lock_date = ${c.end} where id = 1`;
    await tx`insert into month_closes (period, closed_by, closed_at) values (${period}, ${user.id}, now())
      on conflict (period) do update set closed_by = excluded.closed_by, closed_at = excluded.closed_at`;
    await audit(tx, user, 'close', period, `Books locked to ${c.end}`, left.length ? `Locked with open items: ${left.map(i => i.label).join('; ')}` : '');
  });
}

/** Management moves the lock date back to before the month, so it can be corrected. Later months reopen with it. */
export async function reopenMonth(user: User, period: string, reason: string) {
  if (!hasRole(user, 'management')) throw new RuleError('Only Management moves the lock date.');
  checkPeriod(period);
  if (!reason.trim()) throw new RuleError('Say why the month is reopened.');
  const s = await getSettings();
  const back = prevEnd(period);
  if (!s.lock_date || s.lock_date <= back) throw new RuleError('That month is not locked.');
  await sql.begin(async tx => {
    await tx`update settings set lock_date = ${back < (s.opening_date ?? '') ? null : back} where id = 1`;
    await tx`update month_closes set closed_by = null, closed_at = null where period >= ${period}`;
    await audit(tx, user, 'close', period, `Books reopened from ${period}-01`, reason.trim());
  });
}
