import 'server-only';
import { sql } from './db';
import { r2 } from './money';
import { natural, RuleError, type AccountType } from './ledger';
import { getSettings, type Settings } from './books';
import { fiscalYearStart } from './reports';
import { monthEnd } from './close';
import type { Sheet } from './xlsx-write';

// Statements pack (improvement 13): for a month, the profit and loss, the balance sheet, the cash flow and the trial
// balance, each for the month and the year to date, on one page and in one Excel workbook (a sheet each), printable to PDF.
//
// The cash flow is the indirect method: the profit, plus depreciation, plus the change in what is owed to and by the
// company (operating); the change in fixed assets (investing); and the partners' money in and out (financing). Each
// line is the cash effect of the movement on its accounts in the period, so the three always add up to the change in
// bank, cash and petty cash. The opening-balances entry is the starting point, not a flow.

type Acc = { code: string; name: string; type: AccountType; parent: string | null; is_bank: boolean; parent_name: string | null };
type Bal = { code: string; dr: number; cr: number };
export type Line = { code: string; name: string; month: number; ytd: number };
export type FlowLine = { label: string; month: number; ytd: number; codes: string[] };
export type Pack = {
  period: string; name: string; from: string; to: string; ytdFrom: string; company: string;
  pl: { revenue: Line[]; expense: Line[]; totals: { revenue: [number, number]; expense: [number, number]; profit: [number, number] } };
  bs: { assets: Line[]; liabilities: Line[]; equity: Line[]; profit: [number, number]; totals: { assets: [number, number]; le: [number, number] } };
  cf: { operating: FlowLine[]; investing: FlowLine[]; financing: FlowLine[]; totals: { operating: [number, number]; investing: [number, number]; financing: [number, number]; change: [number, number]; opening: [number, number]; closing: [number, number] } };
  tb: { code: string; name: string; type: AccountType; month_dr: number; month_cr: number; dr: number; cr: number }[];
};

const monthName = (p: string) => new Date(p + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** dr/cr per account between two dates (inclusive), optionally leaving out the opening-balances entry. */
const movement = (from: string | null, to: string, opening: boolean) => sql<Bal[]>`
  select l.account code, sum(l.dr)::float dr, sum(l.cr)::float cr from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
  where (${from}::date is null or e.date >= ${from}::date) and e.date <= ${to}::date and (${opening} or coalesce(e.source_type, '') <> 'opening')
  group by l.account`;

/** Which section of the cash flow an account's movement belongs to. */
function flowOf(a: Acc, s: Settings): 'cash' | 'profit' | 'depreciation' | 'investing' | 'financing' | 'working' {
  const m = s.account_map as Record<string, string | undefined>;
  if (a.is_bank && a.type === 'asset') return 'cash';
  if (a.type === 'revenue' || a.type === 'expense' || a.code === m.retained) return 'profit';
  if (a.code === m.accDep || (a.type === 'asset' && /depreciation/i.test(a.name))) return 'depreciation';
  if (a.code === m.fixedAssets || (a.type === 'asset' && /non-current|fixed/i.test(a.parent_name ?? ''))) return 'investing';
  if (a.type === 'equity') return 'financing';
  return 'working';
}

export async function statementsPack(period: string): Promise<Pack> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new RuleError('Pick a month.');
  const s = await getSettings();
  const from = period + '-01', to = monthEnd(period), ytdFrom = fiscalYearStart(s, to);
  const [accs, mon, ytd, close, flowM, flowY, cashStart] = await Promise.all([
    sql<Acc[]>`select a.code, a.name, a.type, a.parent, a.is_bank, p.name parent_name from accounts a left join accounts p on p.code = a.parent order by a.code`,
    movement(from, to, true), movement(ytdFrom, to, true), movement(null, to, true),
    movement(from, to, false), movement(ytdFrom, to, false),
    // cash at the start of the month and of the year: everything before it, plus the opening entry wherever it is dated
    sql<{ m: number; y: number }[]>`
      select coalesce(sum(case when e.date < ${from}::date or e.source_type = 'opening' then l.dr - l.cr end), 0)::float m,
        coalesce(sum(case when e.date < ${ytdFrom}::date or e.source_type = 'opening' then l.dr - l.cr end), 0)::float y
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.code = l.account and a.is_bank and a.type = 'asset'
      where e.date <= ${to}::date`,
  ]);
  const acc = new Map(accs.map(a => [a.code, a]));
  const idx = (b: Bal[]) => new Map(b.map(x => [x.code, x]));
  const M = idx(mon), Y = idx(ytd), C = idx(close);
  const nat = (b: Bal | undefined, t: AccountType) => (b ? r2(natural(t, b.dr, b.cr)) : 0);
  const lines = (t: AccountType, src: [Map<string, Bal>, Map<string, Bal>]) => accs.filter(a => a.type === t)
    .map(a => ({ code: a.code, name: a.name, month: nat(src[0].get(a.code), t), ytd: nat(src[1].get(a.code), t) }))
    .filter(l => l.month || l.ytd);
  const sum = (ls: { month: number; ytd: number }[]): [number, number] => [r2(ls.reduce((t, l) => t + l.month, 0)), r2(ls.reduce((t, l) => t + l.ytd, 0))];

  // profit and loss: the month and the year to date
  const revenue = lines('revenue', [M, Y]), expense = lines('expense', [M, Y]);
  const rT = sum(revenue), eT = sum(expense), profit: [number, number] = [r2(rT[0] - eT[0]), r2(rT[1] - eT[1])];

  // balance sheet at the month end (and at the end of the month before, for comparison)
  const P = idx(await movement(null, day(from, -1), true));
  const bsl = (t: AccountType) => accs.filter(a => a.type === t).map(a => ({ code: a.code, name: a.name, month: nat(C.get(a.code), t), ytd: nat(P.get(a.code), t) })).filter(l => l.month || l.ytd);
  const assets = bsl('asset'), liabilities = bsl('liability'), equity = bsl('equity');
  const profitTo = (b: Map<string, Bal>) => r2(accs.reduce((t, a) => t + (a.type === 'revenue' ? nat(b.get(a.code), 'revenue') : a.type === 'expense' ? -nat(b.get(a.code), 'expense') : 0), 0));
  const bsProfit: [number, number] = [profitTo(C), profitTo(P)];
  const aT = sum(assets), lT = sum(liabilities), qT = sum(equity);

  // cash flow
  const flows = (b: Bal[]) => {
    const out = new Map<string, { label: string; section: string; amount: number; codes: string[] }>();
    for (const x of b) {
      const a = acc.get(x.code);
      if (!a) continue;
      const f = flowOf(a, s);
      if (f === 'cash') continue;
      const cash = r2(x.cr - x.dr); // the cash effect of the movement
      const key = f === 'profit' ? 'profit' : f === 'depreciation' ? 'depreciation' : x.code;
      const label = f === 'profit' ? 'Profit for the period' : f === 'depreciation' ? 'Depreciation' : f === 'working' ? `Change in ${a.name}` : a.name;
      const section = f === 'profit' || f === 'depreciation' || f === 'working' ? 'operating' : f;
      const o = out.get(key) ?? { label, section, amount: 0, codes: [] };
      o.amount = r2(o.amount + cash); o.codes.push(x.code); out.set(key, o);
    }
    return out;
  };
  const fm = flows(flowM), fy = flows(flowY);
  const keys = [...new Set([...fy.keys(), ...fm.keys()])];
  const order = (k: string) => (k === 'profit' ? 0 : k === 'depreciation' ? 1 : 2);
  const sec = (name: string): FlowLine[] => keys.filter(k => (fy.get(k) ?? fm.get(k))!.section === name).sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map(k => { const v = (fy.get(k) ?? fm.get(k))!; return { label: v.label, month: fm.get(k)?.amount ?? 0, ytd: fy.get(k)?.amount ?? 0, codes: v.codes }; })
    .filter(l => l.month || l.ytd);
  const operating = sec('operating'), investing = sec('investing'), financing = sec('financing');
  const oT = sum(operating), iT = sum(investing), fT = sum(financing);
  const change: [number, number] = [r2(oT[0] + iT[0] + fT[0]), r2(oT[1] + iT[1] + fT[1])];
  const opening: [number, number] = [r2(cashStart[0].m), r2(cashStart[0].y)];

  // trial balance at the month end, with the month's movement
  const tb = accs.filter(a => C.get(a.code) || M.get(a.code)).map(a => {
    const c = C.get(a.code), m = M.get(a.code), net = r2((c?.dr ?? 0) - (c?.cr ?? 0));
    return { code: a.code, name: a.name, type: a.type, month_dr: r2(m?.dr ?? 0), month_cr: r2(m?.cr ?? 0), dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 };
  }).filter(r => r.month_dr || r.month_cr || r.dr || r.cr);

  return {
    period, name: monthName(period), from, to, ytdFrom, company: s.company_name,
    pl: { revenue, expense, totals: { revenue: rT, expense: eT, profit } },
    bs: { assets, liabilities, equity, profit: bsProfit, totals: { assets: aT, le: [r2(lT[0] + qT[0] + bsProfit[0]), r2(lT[1] + qT[1] + bsProfit[1])] } },
    cf: { operating, investing, financing, totals: { operating: oT, investing: iT, financing: fT, change, opening, closing: [r2(opening[0] + change[0]), r2(opening[1] + change[1])] } },
    tb,
  };
}

/** The pack as Excel sheets. */
export function packSheets(p: Pack): Sheet[] {
  const ytd = `Year to date (from ${p.ytdFrom})`;
  const rows = (ls: { code?: string; label?: string; name?: string; month: number; ytd: number }[]) => ls.map(l => [l.code ?? '', l.label ?? l.name ?? '', l.month, l.ytd]);
  return [
    { name: 'Profit and loss', rows: [['GL code', 'Account', p.name, ytd], ['## Revenue'], ...rows(p.pl.revenue), ['## Total revenue', '', ...p.pl.totals.revenue], ['## Expenses'], ...rows(p.pl.expense), ['## Total expenses', '', ...p.pl.totals.expense], ['## Net profit', '', ...p.pl.totals.profit]] },
    { name: 'Balance sheet', rows: [['GL code', 'Account', `At ${p.to}`, `At ${day(p.from, -1)}`], ['## Assets'], ...rows(p.bs.assets), ['## Total assets', '', ...p.bs.totals.assets], ['## Liabilities'], ...rows(p.bs.liabilities), ['## Equity'], ...rows(p.bs.equity), ['', 'Profit to date', ...p.bs.profit], ['## Total liabilities and equity', '', ...p.bs.totals.le]] },
    { name: 'Cash flow', rows: [['', 'Line', p.name, ytd], ['## Operating activities'], ...rows(p.cf.operating), ['## Cash from operating activities', '', ...p.cf.totals.operating], ['## Investing activities'], ...rows(p.cf.investing), ['## Cash from investing activities', '', ...p.cf.totals.investing], ['## Financing activities'], ...rows(p.cf.financing), ['## Cash from financing activities', '', ...p.cf.totals.financing], [],
      ['## Net change in cash', '', ...p.cf.totals.change], ['', 'Cash at the start', ...p.cf.totals.opening], ['## Cash at the end', '', ...p.cf.totals.closing]] },
    { name: 'Trial balance', rows: [['GL code', 'Account', `${p.name} debits`, `${p.name} credits`, `Debit at ${p.to}`, `Credit at ${p.to}`], ...p.tb.map(r => [r.code, r.name, r.month_dr || '', r.month_cr || '', r.dr || '', r.cr || '']),
      ['## Total', '', r2(p.tb.reduce((t, r) => t + r.month_dr, 0)), r2(p.tb.reduce((t, r) => t + r.month_cr, 0)), r2(p.tb.reduce((t, r) => t + r.dr, 0)), r2(p.tb.reduce((t, r) => t + r.cr, 0))]] },
  ];
}
