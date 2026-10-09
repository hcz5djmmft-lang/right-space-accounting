import 'server-only';
import { sql } from './db';
import { r2 } from './money';
import { natural, type AccountType } from './ledger';
import { trialBalance } from './books';
import type { Settings } from './books';
import { today } from './dates';

export { today } from './dates';

/** First day of the fiscal year that contains `on` (settings.fy_start_month, 1 = January). */
export function fiscalYearStart(s: Pick<Settings, 'fy_start_month'>, on = today()) {
  const m = s.fy_start_month || 1, y = Number(on.slice(0, 4)), cur = Number(on.slice(5, 7));
  return `${cur >= m ? y : y - 1}-${String(m).padStart(2, '0')}-01`;
}

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);

// ---- Cost centers: revenue and cost per project for a period ----
export type CCRow = {
  id: string | null; code: string; name: string; client: string | null; type: string | null; service: string | null; unit: string | null; status: string | null; is_office: boolean;
  contract: number | null; budget: number | null; rev: number; opex: number; capex: number; cost: number; net: number; pct: number | null;
};
export async function costCenters(opts: { from: string; to: string; dept?: string }): Promise<CCRow[]> {
  const [projects, agg] = await Promise.all([
    sql<{ id: string; code: string; name: string; client: string | null; type: string | null; service: string | null; unit: string | null; status: string; is_office: boolean; contract: number | null; budget: number | null }[]>`
      select p.id, p.code, p.name, c.name client, p.type, p.service, p.unit, p.status, p.is_office, p.contract, p.budget
      from projects p left join parties c on c.id = p.client_id order by p.is_office desc, p.code`,
    sql<{ project_id: string | null; rev: number; opex: number; capex: number }[]>`
      select l.project_id,
        coalesce(sum(case when a.type = 'revenue' then l.cr - l.dr end), 0) rev,
        coalesce(sum(case when a.type = 'expense' and coalesce(a.cost_type, 'Opex') <> 'Capex' then l.dr - l.cr end), 0) opex,
        coalesce(sum(case when a.type = 'expense' and a.cost_type = 'Capex' then l.dr - l.cr end), 0) capex
      from journal_lines l
      join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      join accounts a on a.code = l.account
      where e.date >= ${opts.from}::date and e.date <= ${opts.to}::date
        and (${opts.dept ?? null}::text is null or l.dept_id = ${opts.dept ?? null})
        and a.type in ('revenue', 'expense')
      group by l.project_id`,
  ]);
  const by = new Map(agg.map(x => [x.project_id, x]));
  const row = (p: Partial<CCRow> & { id: string | null; code: string; name: string }, x?: { rev: number; opex: number; capex: number }): CCRow => {
    const rev = r2(x?.rev ?? 0), opex = r2(x?.opex ?? 0), capex = r2(x?.capex ?? 0), cost = r2(opex + capex), budget = p.budget ?? null;
    return { client: null, type: null, service: null, unit: null, status: null, is_office: false, contract: null, ...p, budget, rev, opex, capex, cost, net: r2(rev - cost), pct: budget ? Math.round(cost / budget * 100) : null };
  };
  const rows = projects.map(p => row(p, by.get(p.id)));
  const none = by.get(null);
  if (none && (none.rev || none.opex || none.capex)) rows.push(row({ id: null, code: '', name: 'No cost center' }, none));
  return rows;
}

// ---- Budget vs actual per GL code (budgets are annual) ----
export type BudgetRow = {
  code: string; name: string; type: AccountType; cost_type: string | null; project_id: string | null; project_code: string | null; project_name: string | null;
  budget: number | null; actual: number; committed: number; remaining: number | null; pct: number | null;
};
export async function budgetVsActual(opts: { from: string; to: string }): Promise<BudgetRow[]> {
  const rows = await sql<(Omit<BudgetRow, 'actual' | 'remaining' | 'pct'> & { dr: number; cr: number })[]>`
    select a.code, a.name, a.type, a.cost_type, a.project_id, p.code project_code, p.name project_name, a.budget,
      coalesce(b.dr, 0) dr, coalesce(b.cr, 0) cr, coalesce(c.committed, 0) committed
    from accounts a
    left join projects p on p.id = a.project_id
    left join (select l.account, sum(l.dr) dr, sum(l.cr) cr from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where e.date >= ${opts.from}::date and e.date <= ${opts.to}::date group by l.account) b on b.account = a.code
    left join (select il.account, sum(il.qty * il.price) committed from invoice_lines il join invoices i on i.id = il.invoice_id
      where i.kind = 'purchase' and i.status = 'pending' group by il.account) c on c.account = a.code
    where a.postable and (a.type = 'expense' or a.budget is not null)
      and (a.budget is not null or b.account is not null or c.account is not null)
    order by a.project_id nulls first, a.code`;
  return rows.map(r => {
    const actual = natural(r.type, r.dr, r.cr), committed = r2(r.committed), budget = r.budget ?? null;
    return { ...r, budget, actual, committed, remaining: budget === null ? null : r2(budget - actual - committed), pct: budget ? Math.round((actual + committed) / budget * 100) : null };
  });
}

// ---- Aging of open receivables (sales invoices) or payables (payment requests) ----
export const BUCKETS = ['Current', '1–30', '31–60', '61–90', '90+'] as const;
export type AgingDoc = { id: string; no: string; date: string; due: string | null; party_id: string; party: string; balance: number; days: number; bucket: number };
export type AgingRow = { party_id: string; party: string; buckets: number[]; total: number };
export async function aging(opts: { side: 'sales' | 'purchase'; asOf: string }): Promise<{ docs: AgingDoc[]; parties: AgingRow[]; totals: number[] }> {
  const rows = await sql<{ id: string; no: string; date: string; due: string | null; party_id: string; party: string; balance: number }[]>`
    select i.id, i.no, to_char(i.date, 'YYYY-MM-DD') date, to_char(i.due_date, 'YYYY-MM-DD') due, i.party_id, pt.name party,
      (case when i.kind = 'sales' then i.total else i.net end)
        - coalesce((select sum(al.amount) from payment_allocations al join payments pm on pm.id = al.payment_id and pm.status = 'posted' and pm.date <= ${opts.asOf}::date
                    where al.invoice_id = i.id), 0) balance
    from invoices i join parties pt on pt.id = i.party_id
    where i.kind = ${opts.side} and i.status = 'posted' and i.date <= ${opts.asOf}::date
    order by pt.name, i.date, i.no`;
  const docs: AgingDoc[] = rows.filter(r => r.balance > 0.004).map(r => {
    const days = r.due ? daysBetween(r.due, opts.asOf) : 0;
    return { ...r, balance: r2(r.balance), days, bucket: days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4 };
  });
  const by = new Map<string, AgingRow>();
  for (const d of docs) {
    const p = by.get(d.party_id) ?? { party_id: d.party_id, party: d.party, buckets: [0, 0, 0, 0, 0], total: 0 };
    p.buckets[d.bucket] = r2(p.buckets[d.bucket] + d.balance); p.total = r2(p.total + d.balance); by.set(d.party_id, p);
  }
  const parties = [...by.values()];
  const totals = BUCKETS.map((_, i) => r2(parties.reduce((s, p) => s + p.buckets[i], 0)));
  return { docs, parties, totals };
}

// ---- VAT, WHT and other deductions for the tax returns ----
export const TAX_KEYS: [string, string][] = [
  ['vatOut', 'Output VAT (sales)'], ['vatIn', 'Input VAT (purchases)'], ['whtPay', 'WHT deducted from vendors'], ['whtRec', 'WHT deducted by customers'],
  ['siPay', "Contractors' social insurance"], ['retPay', 'Retention held'], ['socPay', 'Payroll social insurance'], ['taxPay', 'Salary tax'],
];
export type TaxAccount = { key: string; label: string; code: string; opening: number; dr: number; cr: number; closing: number };
export type Deduction = { id: string; no: string; date: string; vendor: string; tax_id: string | null; subtotal: number; wht_rate: number; wht: number; si_rate: number; si: number };
export async function taxReport(opts: { from: string; to: string }, map: Record<string, string>) {
  const codes = TAX_KEYS.map(([k]) => map[k]).filter(Boolean);
  const [bal, deductions] = await Promise.all([
    sql<{ account: string; opening: number; dr: number; cr: number }[]>`
      select l.account,
        coalesce(sum(case when e.date < ${opts.from}::date then l.dr - l.cr end), 0) opening,
        coalesce(sum(case when e.date >= ${opts.from}::date then l.dr end), 0) dr,
        coalesce(sum(case when e.date >= ${opts.from}::date then l.cr end), 0) cr
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where l.account = any(${codes}) and e.date <= ${opts.to}::date
      group by l.account`,
    sql<Deduction[]>`
      select i.id, i.no, to_char(i.date, 'YYYY-MM-DD') date, pt.name vendor, pt.tax_id, i.subtotal, i.wht_rate, i.wht, i.si_rate, i.si
      from invoices i join parties pt on pt.id = i.party_id
      where i.kind = 'purchase' and i.status = 'posted' and i.date >= ${opts.from}::date and i.date <= ${opts.to}::date and (i.wht > 0 or i.si > 0)
      order by i.date, i.no`,
  ]);
  const by = new Map(bal.map(b => [b.account, b]));
  const accounts: TaxAccount[] = TAX_KEYS.filter(([k]) => map[k]).map(([key, label]) => {
    const b = by.get(map[key]); const opening = r2(b?.opening ?? 0), dr = r2(b?.dr ?? 0), cr = r2(b?.cr ?? 0);
    return { key, label, code: map[key], opening, dr, cr, closing: r2(opening + dr - cr) };
  });
  const a = (k: string) => accounts.find(x => x.key === k);
  const outputVat = r2((a('vatOut')?.cr ?? 0) - (a('vatOut')?.dr ?? 0)), inputVat = r2((a('vatIn')?.dr ?? 0) - (a('vatIn')?.cr ?? 0));
  return { accounts, deductions, outputVat, inputVat, netVat: r2(outputVat - inputVat) };
}

// ---- General ledger lines of one GL code (shared by the page and the CSV export) ----
export type LedgerLine = { id: string; no: string; date: string; memo: string; description: string; cc: string | null; dr: number; cr: number };
export const ledgerLines = (account: string, from = '', to = '') => sql<LedgerLine[]>`
  select e.id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, l.description, coalesce(p.code, d.name) cc, l.dr, l.cr
  from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
  left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id
  where l.account = ${account} and (${from} = '' or e.date >= ${from || null}::date) and (${to} = '' or e.date <= ${to || null}::date)
  order by e.date, e.no, l.line_no`;

// ---- CSV for Excel: the same numbers as the screens, one function per report ----
export type CsvQuery = Record<string, string | undefined>;
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  // text that Excel would run as a formula (=SUM…, +…, @…) gets a leading apostrophe; negative numbers stay numbers
  if (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !/^-\d/.test(s))) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCsv = (rows: unknown[][]) => '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');

export async function reportCsv(kind: string, q: CsvQuery, settings: Settings): Promise<{ name: string; rows: unknown[][] } | null> {
  const year = today().slice(0, 4);
  const cc = q.cc ?? '', project = cc.startsWith('p:') ? cc.slice(2) : undefined, dept = cc.startsWith('d:') ? cc.slice(2) : undefined;
  if (kind === 'tb') {
    const rows = await trialBalance({ from: q.from || undefined, to: q.to || undefined, project, dept });
    return { name: `Trial balance ${q.from || 'start'} to ${q.to || today()}`, rows: [['GL code', 'Name', 'Debit', 'Credit'],
      ...rows.filter(r => Math.abs(r.dr - r.cr) > 0.004).map(r => [r.code, r.name, r.dr > r.cr ? r2(r.dr - r.cr) : '', r.cr > r.dr ? r2(r.cr - r.dr) : ''])] };
  }
  if (kind === 'is') {
    const from = q.from || `${year}-01-01`, to = q.to || `${year}-12-31`;
    const rows = await trialBalance({ from, to, project, dept });
    const sec = (t: AccountType) => rows.filter(r => r.type === t).map(r => [t === 'revenue' ? 'Revenue' : 'Expenses', r.code, r.name, natural(r.type, r.dr, r.cr)]);
    const sum = (t: AccountType) => r2(rows.filter(r => r.type === t).reduce((s, r) => s + natural(r.type, r.dr, r.cr), 0));
    return { name: `Income statement ${from} to ${to}`, rows: [['Section', 'GL code', 'Name', 'Amount'], ...sec('revenue'), ['Total revenue', '', '', sum('revenue')], ...sec('expense'), ['Total expenses', '', '', sum('expense')], ['Net profit', '', '', r2(sum('revenue') - sum('expense'))]] };
  }
  if (kind === 'bs') {
    const to = q.to || today();
    const rows = await trialBalance({ to });
    const sum = (t: AccountType) => r2(rows.filter(r => r.type === t).reduce((s, r) => s + natural(r.type, r.dr, r.cr), 0));
    const sec = (label: string, t: AccountType) => rows.filter(r => r.type === t && Math.abs(r.dr - r.cr) > 0.004).map(r => [label, r.code, r.name, natural(r.type, r.dr, r.cr)]);
    const profit = r2(sum('revenue') - sum('expense'));
    return { name: `Balance sheet as of ${to}`, rows: [['Section', 'GL code', 'Name', 'Amount'], ...sec('Assets', 'asset'), ['Total assets', '', '', sum('asset')], ...sec('Liabilities', 'liability'), ...sec('Equity', 'equity'), ['Profit to date', '', '', profit], ['Total liabilities & equity', '', '', r2(sum('liability') + sum('equity') + profit)]] };
  }
  if (kind === 'gl') {
    if (!q.account) return null;
    const [acc] = await sql<{ code: string; name: string; type: AccountType }[]>`select code, name, type from accounts where code = ${q.account}`;
    if (!acc) return null;
    let run = 0;
    const lines = await ledgerLines(acc.code, q.from, q.to);
    return { name: `Ledger ${acc.code} ${q.from || 'start'} to ${q.to || today()}`, rows: [['Date', 'Entry', 'Description', 'Cost center', 'Debit', 'Credit', 'Balance'],
      ...lines.map(l => { run = r2(run + natural(acc.type, l.dr, l.cr)); return [l.date, l.no, l.description || l.memo, l.cc ?? '', l.dr || '', l.cr || '', run]; })] };
  }
  if (kind === 'cc') {
    const from = q.from || fiscalYearStart(settings), to = q.to || today();
    const rows = await costCenters({ from, to, dept });
    return { name: `Cost centers ${from} to ${to}`, rows: [['Code', 'Cost center', 'Client', 'Project type', 'Service', 'Unit type', 'Status', 'Contract value', 'Cost budget', 'Revenue', 'Opex', 'Capex', 'Total cost', 'Budget used %', 'Net'],
      ...rows.map(r => [r.code, r.name, r.client ?? '', r.type ?? '', r.service ?? '', r.unit ?? '', r.status ?? '', r.contract ?? '', r.budget ?? '', r.rev, r.opex, r.capex, r.cost, r.pct ?? '', r.net])] };
  }
  if (kind === 'budget') {
    const from = q.from || fiscalYearStart(settings), to = q.to || today();
    const rows = await budgetVsActual({ from, to });
    return { name: `Budget vs actual ${from} to ${to}`, rows: [['GL code', 'GL name', 'Cost center', 'Cost type', 'Budget', 'Actual', 'Committed (pending requests)', 'Remaining', '% used'],
      ...rows.map(r => [r.code, r.name, r.project_code ?? '', r.cost_type ?? '', r.budget ?? '', r.actual, r.committed, r.remaining ?? '', r.pct ?? ''])] };
  }
  if (kind === 'aging') {
    const side = q.side === 'sales' ? 'sales' : 'purchase', asOf = q.to || today();
    const a = await aging({ side, asOf });
    return { name: `Aging ${side === 'sales' ? 'receivables' : 'payables'} as of ${asOf}`, rows: [['Party', ...BUCKETS, 'Total'],
      ...a.parties.map(p => [p.party, ...p.buckets, p.total]), ['Total', ...a.totals, r2(a.totals.reduce((s, v) => s + v, 0))], [],
      ['Document', 'Date', 'Due', 'Party', 'Days past due', 'Open balance'], ...a.docs.map(d => [d.no, d.date, d.due ?? '', d.party, d.days, d.balance])] };
  }
  if (kind === 'tax') {
    const from = q.from || fiscalYearStart(settings), to = q.to || today();
    const t = await taxReport({ from, to }, settings.account_map);
    return { name: `VAT and WHT ${from} to ${to}`, rows: [['Account', 'GL code', 'Opening (Dr−Cr)', 'Debits', 'Credits', 'Closing (Dr−Cr)'],
      ...t.accounts.map(a => [a.label, a.code, a.opening, a.dr, a.cr, a.closing]), [],
      ['Request', 'Date', 'Vendor', 'Tax ID', 'Base', 'WHT %', 'WHT', 'SI %', 'SI'], ...t.deductions.map(d => [d.no, d.date, d.vendor, d.tax_id ?? '', d.subtotal, d.wht_rate, d.wht, d.si_rate, d.si])] };
  }
  return null;
}
