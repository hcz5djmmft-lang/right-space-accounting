// The bank reconciliation summary: what moved money out of an account and what brought money in, grouped the way
// the statement is read at Right Space (Adel, 2026-10-11). Pure, so the grouping can be unit-tested.
import type { AccountType } from './ledger';

export type BankKind = 'bank' | 'card' | 'cash';
/** What is known about a counterpart account on the same entry. */
export type AccountInfo = { type?: AccountType; bank?: BankKind | null; charges?: boolean; interest?: boolean; receivable?: boolean };
export type Movement = { kind: string; dr: number; cr: number; others: string[] };

export const OUT_GROUPS = ['Transfers to vendors', 'Bank charges', 'Credit card settlement', 'Transfers between accounts', 'Salaries', "Partners' withdrawals", 'Other payments'] as const;
export const IN_GROUPS = ['Collections', "Partners' deposits", 'Interest', 'Transfers between accounts', 'Other receipts'] as const;
export type Group = { side: 'out' | 'in'; group: (typeof OUT_GROUPS)[number] | (typeof IN_GROUPS)[number] };

/** Which group one movement on a bank, card or cash account belongs to; `info` describes the other accounts on its entry. */
export function groupOf(m: Movement, info: (code: string) => AccountInfo): Group {
  const o = m.others.map(info);
  if (m.cr > 0) { // credited: money out
    if (o.some(x => x.charges)) return { side: 'out', group: 'Bank charges' };
    if (m.kind === 'payment') return { side: 'out', group: 'Transfers to vendors' };
    if (m.kind === 'transfer' && o.some(x => x.bank === 'card')) return { side: 'out', group: 'Credit card settlement' };
    if (m.kind === 'transfer' || o.some(x => x.bank)) return { side: 'out', group: 'Transfers between accounts' };
    if (m.kind === 'payroll') return { side: 'out', group: 'Salaries' };
    if (o.some(x => x.type === 'equity')) return { side: 'out', group: "Partners' withdrawals" };
    return { side: 'out', group: 'Other payments' };
  }
  // debited: money in
  if (o.some(x => x.interest)) return { side: 'in', group: 'Interest' };
  if (o.some(x => x.type === 'equity')) return { side: 'in', group: "Partners' deposits" };
  if (['receipt', 'collection', 'sales_invoice'].includes(m.kind) || o.some(x => x.receivable || x.type === 'revenue')) return { side: 'in', group: 'Collections' };
  if (m.kind === 'transfer' || o.some(x => x.bank)) return { side: 'in', group: 'Transfers between accounts' };
  return { side: 'in', group: 'Other receipts' };
}

export type GroupTotal = { group: string; total: number; count: number };
/** Totals per group, in the fixed order, leaving out groups with nothing in them. */
export function summarize(moves: Movement[], info: (code: string) => AccountInfo) {
  const out = new Map<string, GroupTotal>(), inn = new Map<string, GroupTotal>();
  for (const m of moves) {
    const g = groupOf(m, info);
    const map = g.side === 'out' ? out : inn;
    const t = map.get(g.group) ?? { group: g.group, total: 0, count: 0 };
    t.total += g.side === 'out' ? m.cr : m.dr; t.count++;
    map.set(g.group, t);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pick = (names: readonly string[], map: Map<string, GroupTotal>) => names.filter(n => map.has(n)).map(n => ({ ...map.get(n)!, total: r2(map.get(n)!.total) }));
  const outs = pick(OUT_GROUPS, out), ins = pick(IN_GROUPS, inn);
  return { out: outs, in: ins, totalOut: r2(outs.reduce((s, g) => s + g.total, 0)), totalIn: r2(ins.reduce((s, g) => s + g.total, 0)) };
}
