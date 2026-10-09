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
