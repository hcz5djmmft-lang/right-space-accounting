import 'server-only';
import { sql } from './db';
import { audit, getSettings, saveEntry } from './books';
import { type AccountType, RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { type AccountInfo, type BankKind, summarize } from './bank-groups';

// Banks, the credit card and petty cash: balances, account activity, the grouped reconciliation summary and
// reconciliation against the bank statement. Reconciling changes nothing in the books; it only records which lines the statement shows.

export type BankAccount = {
  code: string; name: string; type: AccountType; balance: number; cleared: number; stmt_date: string | null; stmt_balance: number | null;
  kind: BankKind; bank_name: string | null; branch: string | null; account_no: string | null; iban: string | null; swift: string | null;
  credit_limit: number | null; holder: string | null; ref_prefix: string | null; hidden: boolean;
};

export async function bankAccounts() {
  return sql<BankAccount[]>`
    select a.code, a.name, a.type,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code), 0) balance,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join bank_cleared c on c.line_id = l.id where l.account = a.code), 0) cleared,
      to_char(s.stmt_date, 'YYYY-MM-DD') stmt_date, s.stmt_balance,
      coalesce(b.kind, 'bank') kind, b.bank_name, b.branch, b.account_no, b.iban, b.swift, b.credit_limit, b.holder, b.ref_prefix, coalesce(b.hidden, false) hidden
    from accounts a left join bank_statements s on s.account = a.code left join bank_accounts b on b.account = a.code
    where a.is_bank and a.postable order by a.code`;
}

/** What a card owes and what is left on its limit (its book balance is a credit when money is owed). */
export const cardFigures = (a: Pick<BankAccount, 'balance' | 'credit_limit'>) => ({ owed: r2(-a.balance), available: a.credit_limit === null ? null : r2(a.credit_limit + a.balance) });

export const KIND_LABEL: Record<BankKind, string> = { bank: 'Bank account', card: 'Credit card', cash: 'Office cash' };

export type BankLine = {
  line_id: number; entry_id: string; no: string; date: string; memo: string; description: string; party: string | null; cc: string | null;
  dr: number; cr: number; cleared: boolean; ref: string | null; kind: string; others: string[];
};

/** Posted activity on one bank, card or cash account, oldest first, with the other accounts of each entry. */
export async function bankActivity(code: string, from = '', to = '') {
  return sql<BankLine[]>`
    select l.id line_id, e.id entry_id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, l.description, pt.name party, coalesce(p.code, d.name) cc, l.dr, l.cr,
      (c.line_id is not null) cleared, e.payment_ref ref, e.kind,
      (select coalesce(array_agg(distinct o.account), '{}') from journal_lines o where o.entry_id = e.id and o.account <> l.account) others
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    left join bank_cleared c on c.line_id = l.id
    left join parties pt on pt.id = l.party_id left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id
    where l.account = ${code} and (${from} = '' or e.date >= ${from || null}::date) and (${to} = '' or e.date <= ${to || null}::date)
    order by e.date, e.no, l.line_no`;
}

/** The reconciliation summary of one account for a period: opening balance, money out and in by group, closing balance in the books. */
export async function bankSummary(code: string, from = '', to = '') {
  const [lines, s] = await Promise.all([bankActivity(code, from, to), getSettings()]);
  const codes = [...new Set(lines.flatMap(l => l.others))];
  const rows = codes.length ? await sql<{ code: string; type: AccountType; bank: BankKind | null }[]>`
    select a.code, a.type, b.kind bank from accounts a left join bank_accounts b on b.account = a.code where a.code = any(${codes})` : [];
  const byCode = new Map(rows.map(r => [r.code, r]));
  const m = s.account_map;
  const info = (c: string): AccountInfo => {
    const a = byCode.get(c);
    return { type: a?.type, bank: a?.bank ?? null, charges: c === m.bankCharges, interest: c === m.interest, receivable: c === m.ar };
  };
  const [{ opening }] = await sql<{ opening: number }[]>`
    select coalesce(sum(l.dr - l.cr), 0) opening from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    where l.account = ${code} and ${from} <> '' and e.date < ${from || null}::date`;
  const sum = summarize(lines, info);
  return { ...sum, opening: r2(opening), closing: r2(opening + sum.totalIn - sum.totalOut) };
}

async function bankOfKind(code: string, kind: BankKind) {
  const [a] = await sql<{ code: string }[]>`select a.code from accounts a left join bank_accounts b on b.account = a.code
    where a.code = ${code} and a.is_bank and coalesce(b.kind, 'bank') = ${kind}`;
  if (!a) throw new RuleError(`${code} is not a ${KIND_LABEL[kind].toLowerCase()}.`);
}
async function financeDept() {
  const [d] = await sql<{ id: string }[]>`select id from departments where active order by (code = 'FIN') desc, code limit 1`;
  if (!d) throw new RuleError('Add a department first (Settings → Departments).');
  return d.id;
}

/** Charges the bank took: an expense on the bank-charges code under Finance, paid from the bank (Finance). */
export async function postBankCharge(user: User, p: { bank: string; date: string; amount: number; memo: string }) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can record bank charges.');
  await bankOfKind(p.bank, 'bank');
  const s = await getSettings();
  if (!s.account_map.bankCharges) throw new RuleError('No GL code is set for bank charges.');
  if (!(p.amount > 0)) throw new RuleError('Enter the amount of the charges.');
  const dept = await financeDept();
  const id = await saveEntry(user, { date: p.date, ref: '', form: { type: 'expense', memo: p.memo || 'Bank charges', bank: p.bank, vatRate: 0, items: [{ dept, acc: s.account_map.bankCharges, amount: r2(p.amount) }] } }, 'post');
  await audit(sql, user, 'bank', p.bank, 'Bank charges recorded', `${r2(p.amount).toFixed(2)} on ${p.date}`);
  return id;
}

/** Interest the bank paid: money into the bank against the interest income code (Finance). */
export async function postInterest(user: User, p: { bank: string; date: string; amount: number; memo: string }) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can record interest.');
  await bankOfKind(p.bank, 'bank');
  const s = await getSettings();
  if (!s.account_map.interest) throw new RuleError('No GL code is set for bank interest.');
  if (!(p.amount > 0)) throw new RuleError('Enter the interest amount.');
  const id = await saveEntry(user, { date: p.date, ref: '', form: { type: 'collection', memo: p.memo || 'Bank interest', bank: p.bank, items: [{ acc: s.account_map.interest, amount: r2(p.amount) }] } }, 'post');
  await audit(sql, user, 'bank', p.bank, 'Interest recorded', `${r2(p.amount).toFixed(2)} on ${p.date}`);
  return id;
}

/** Of the lines shown, marks `clearedIds` as on the statement and the rest as not (Finance). */
export async function setCleared(user: User, code: string, shownIds: number[], clearedIds: number[]) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can reconcile bank accounts.');
  if (!shownIds.length) return;
  const on = new Set(clearedIds);
  await sql.begin(async tx => {
    const valid = await tx<{ id: number }[]>`
      select l.id from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.code = l.account and a.is_bank
      where l.account = ${code} and l.id in ${tx(shownIds)}`;
    const ids = valid.map(v => Number(v.id));
    const add = ids.filter(id => on.has(id)), drop = ids.filter(id => !on.has(id));
    if (drop.length) await tx`delete from bank_cleared where line_id in ${tx(drop)}`;
    for (const id of add) await tx`insert into bank_cleared (line_id, cleared_by) values (${id}, ${user.id}) on conflict (line_id) do nothing`;
    await audit(tx, user, 'bank', code, 'Reconciled', `${add.length} cleared, ${drop.length} uncleared`);
  });
}

export async function saveStatement(user: User, code: string, date: string | null, balance: number | null) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can reconcile bank accounts.');
  const [a] = await sql<{ code: string }[]>`select code from accounts where code = ${code} and is_bank`;
  if (!a) throw new RuleError('That is not a bank or cash account.');
  await sql.begin(async tx => {
    await tx`insert into bank_statements (account, stmt_date, stmt_balance, updated_by, updated_at) values (${code}, ${date || null}, ${balance === null ? null : r2(balance)}, ${user.id}, now())
      on conflict (account) do update set stmt_date = excluded.stmt_date, stmt_balance = excluded.stmt_balance, updated_by = excluded.updated_by, updated_at = now()`;
    await audit(tx, user, 'bank', code, 'Statement saved', `${date ?? ''} ${balance ?? ''}`.trim());
  });
}

/** The reconciliation summary shown above the activity. Reconciled when the statement balance equals what is cleared in the books. */
export function reconcile(a: Pick<BankAccount, 'balance' | 'cleared' | 'stmt_balance'>) {
  const difference = a.stmt_balance === null ? null : r2(a.stmt_balance - a.cleared);
  return { uncleared: r2(a.balance - a.cleared), difference, reconciled: difference !== null && Math.abs(difference) < 0.005 };
}
