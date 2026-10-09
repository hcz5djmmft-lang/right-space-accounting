// Pure accounting rules, carried over from the old app (entryLines, invoiceJE, paymentJE).
// No database access here, so every rule can be unit-tested.
import { r2 } from './money';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export const TYPES: Record<AccountType, { label: string; sign: 1 | -1 }> = {
  asset: { label: 'Assets', sign: 1 },
  liability: { label: 'Liabilities', sign: -1 },
  equity: { label: 'Equity', sign: -1 },
  revenue: { label: 'Revenue', sign: -1 },
  expense: { label: 'Expenses', sign: 1 },
};

/** Role -> system account code, from settings.account_map. */
export type AccountMap = Record<string, string>;

export type Line = {
  account: string;
  dr: number;
  cr: number;
  project_id?: string | null;
  dept_id?: string | null;
  party_id?: string | null;
  description: string;
};

export type EntryItem = { project?: string; dept?: string; acc: string; desc?: string; amount: number };
export type EntryForm = {
  type: 'expense' | 'collection' | 'transfer';
  memo: string;
  bank: string;
  toBank?: string;
  party?: string;
  vatRate?: number;
  amount?: number;
  items: EntryItem[];
};

export class RuleError extends Error {}

/** Builds the debit/credit lines for an Expense, Collection or Transfer. */
export function entryLines(form: EntryForm, map: AccountMap): Line[] {
  const memo = form.memo || '';
  if (!form.bank) throw new RuleError('Choose the bank or cash account.');
  if (form.type === 'transfer') {
    const amt = r2(form.amount);
    if (!form.toBank) throw new RuleError('Choose the account to transfer to.');
    if (form.toBank === form.bank) throw new RuleError('Transfer from and to must be different accounts.');
    if (amt <= 0) throw new RuleError('Enter the transfer amount.');
    return [
      { account: form.toBank, dr: amt, cr: 0, description: memo },
      { account: form.bank, dr: 0, cr: amt, description: memo },
    ];
  }
  const items = form.items.filter(i => i.acc && r2(i.amount) > 0);
  if (!items.length) throw new RuleError('Add at least one line with a GL code and an amount.');
  const sub = r2(items.reduce((s, i) => s + r2(i.amount), 0));
  const party = form.party || null;
  if (form.type === 'expense') {
    const lines: Line[] = items.map(i => ({
      account: i.acc, dr: r2(i.amount), cr: 0,
      project_id: i.project || null, dept_id: i.dept || null, party_id: party, description: i.desc || memo,
    }));
    const vat = r2(sub * (Number(form.vatRate) || 0) / 100);
    if (vat) lines.push({ account: map.vatIn, dr: vat, cr: 0, description: 'VAT · ' + memo });
    lines.push({ account: form.bank, dr: 0, cr: r2(sub + vat), description: memo });
    return lines;
  }
  return [
    { account: form.bank, dr: sub, cr: 0, description: memo },
    ...items.map(i => ({
      account: i.acc, dr: 0, cr: r2(i.amount),
      project_id: i.project || null, dept_id: i.dept || null,
      party_id: i.acc === map.ar ? party : null, description: i.desc || memo,
    })),
  ];
}

/** Every expense line must be assigned to a project or a department. Returns the offending account codes. */
export function missingCostCenter(lines: Line[], accountType: (code: string) => AccountType | undefined): string[] {
  return [...new Set(lines.filter(l => accountType(l.account) === 'expense' && !l.project_id && !l.dept_id).map(l => l.account))];
}

export function assertBalanced(lines: Line[]) {
  const dr = r2(lines.reduce((s, l) => s + l.dr, 0));
  const cr = r2(lines.reduce((s, l) => s + l.cr, 0));
  if (lines.length < 2 || dr !== cr || dr === 0) throw new RuleError(`Entry does not balance (debit ${dr}, credit ${cr}).`);
}

/** Balance in the account's natural direction (assets/expenses debit-positive, others credit-positive). */
export const natural = (type: AccountType, dr: number, cr: number) => r2(TYPES[type].sign * (dr - cr));

// ---------------------------------------------------------------
// Payment requests (purchase), sales invoices, payments
// ---------------------------------------------------------------

export type DocLine = { acc: string; desc?: string; qty: number; price: number; project?: string | null; dept?: string | null };
export type DocInput = {
  kind: 'sales' | 'purchase';
  no: string;
  party: string;
  project?: string | null;
  dept?: string | null;
  vatRate: number; whtRate: number; siRate: number; retRate: number; dpAmount: number;
  lines: DocLine[];
};
export type DocTotals = { subtotal: number; vat: number; total: number; wht: number; si: number; retention: number; dp: number; net: number };

export const lineAmount = (l: Pick<DocLine, 'qty' | 'price'>) => r2((Number(l.qty) || 0) * (Number(l.price) || 0));

/** Totals of a payment request or sales invoice. Deductions are on the subtotal, as in the old app. */
export function docTotals(d: Pick<DocInput, 'kind' | 'vatRate' | 'whtRate' | 'siRate' | 'retRate' | 'dpAmount' | 'lines'>): DocTotals {
  const subtotal = r2(d.lines.reduce((s, l) => s + lineAmount(l), 0));
  const vat = r2(subtotal * (d.vatRate || 0) / 100);
  const total = r2(subtotal + vat);
  if (d.kind !== 'purchase') return { subtotal, vat, total, wht: 0, si: 0, retention: 0, dp: 0, net: total };
  const wht = r2(subtotal * (d.whtRate || 0) / 100);
  const si = r2(subtotal * (d.siRate || 0) / 100);
  const retention = r2(subtotal * (d.retRate || 0) / 100);
  const dp = r2(d.dpAmount || 0);
  return { subtotal, vat, total, wht, si, retention, dp, net: r2(total - wht - si - retention - dp) };
}

/** A line's cost center: its own, else the document's. */
const assignOf = (l: DocLine, d: DocInput) =>
  l.project || l.dept ? { project_id: l.project || null, dept_id: l.dept || null } : { project_id: d.project || null, dept_id: d.dept || null };

/** Journal lines for a posted payment request or sales invoice (port of the old invoiceJE). */
export function docLines(d: DocInput, map: AccountMap): Line[] {
  const t = docTotals(d);
  if (t.net < 0) throw new RuleError('Deductions are larger than the amount; check the rates and the down payment.');
  const P = d.project || null;
  const out: Line[] = [];
  if (d.kind === 'sales') {
    out.push({ account: map.ar, dr: t.total, cr: 0, party_id: d.party, project_id: P, description: d.no });
    for (const l of d.lines) out.push({ account: l.acc, dr: 0, cr: lineAmount(l), ...assignOf(l, d), description: l.desc || d.no });
    if (t.vat) out.push({ account: map.vatOut, dr: 0, cr: t.vat, project_id: P, description: 'VAT ' + d.no });
  } else {
    for (const l of d.lines) out.push({ account: l.acc, dr: lineAmount(l), cr: 0, ...assignOf(l, d), party_id: d.party, description: l.desc || d.no });
    if (t.vat) out.push({ account: map.vatIn, dr: t.vat, cr: 0, project_id: P, description: 'VAT ' + d.no });
    if (t.wht) out.push({ account: map.whtPay, dr: 0, cr: t.wht, party_id: d.party, project_id: P, description: `WHT ${d.whtRate}% · ${d.no}` });
    if (t.si) out.push({ account: map.siPay, dr: 0, cr: t.si, party_id: d.party, project_id: P, description: `Social insurance ${d.siRate}% · ${d.no}` });
    if (t.retention) out.push({ account: map.retPay, dr: 0, cr: t.retention, party_id: d.party, project_id: P, description: `Retention ${d.retRate}% · ${d.no}` });
    if (t.dp) out.push({ account: map.dpAdv, dr: 0, cr: t.dp, party_id: d.party, project_id: P, description: 'Down payment recovery · ' + d.no });
    out.push({ account: map.ap, dr: 0, cr: t.net, party_id: d.party, project_id: P, description: d.no });
  }
  return out.filter(l => l.dr || l.cr);
}

export type PaymentInput = { kind: 'payment' | 'receipt'; no: string; party: string; bank: string; amount: number; wht: number; allocated: number };

/** Journal lines for a vendor payment or customer receipt (port of the old paymentJE).
 *  A vendor payment clears payables up to what is allocated; the rest is a down payment (90000). */
export function paymentLines(p: PaymentInput, map: AccountMap): Line[] {
  const amount = r2(p.amount), wht = r2(p.wht || 0), allocated = r2(p.allocated || 0);
  if (amount <= 0) throw new RuleError('Enter the amount.');
  if (!p.bank) throw new RuleError('Choose the bank or cash account.');
  if (p.kind === 'receipt') {
    const out: Line[] = [{ account: p.bank, dr: r2(amount - wht), cr: 0, description: p.no }];
    if (wht) out.push({ account: map.whtRec, dr: wht, cr: 0, party_id: p.party, description: 'WHT ' + p.no });
    out.push({ account: map.ar, dr: 0, cr: amount, party_id: p.party, description: p.no });
    return out;
  }
  if (allocated > amount + 0.004) throw new RuleError('Allocated more than the payment amount.');
  const adv = r2(amount - allocated);
  const out: Line[] = [];
  if (allocated) out.push({ account: map.ap, dr: allocated, cr: 0, party_id: p.party, description: p.no });
  if (adv) out.push({ account: map.dpAdv, dr: adv, cr: 0, party_id: p.party, description: 'Down payment · ' + p.no });
  out.push({ account: p.bank, dr: 0, cr: amount, description: p.no });
  return out;
}

/** "Two hundred twenty-five thousand Egyptian pounds only" — printed on payment requests. */
export function amountInWords(n: number): string {
  const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const t = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const h = (x: number) => {
    let s = '';
    if (x >= 100) { s += a[Math.floor(x / 100)] + ' hundred'; x %= 100; if (x) s += ' '; }
    if (x >= 20) { s += t[Math.floor(x / 10)]; if (x % 10) s += '-' + a[x % 10]; } else if (x > 0) s += a[x];
    return s;
  };
  let p = Math.floor(Math.abs(n)), pi = Math.round((Math.abs(n) - p) * 100);
  if (pi === 100) { p++; pi = 0; }
  const out: string[] = [];
  for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const) if (p >= v) { out.push(h(Math.floor(p / v)) + ' ' + w); p %= v; }
  if (p) out.push(h(p));
  let s = (out.join(' ') || 'zero') + ' Egyptian pounds';
  if (pi) s += ' and ' + h(pi) + ' piasters';
  return s.charAt(0).toUpperCase() + s.slice(1) + ' only';
}
