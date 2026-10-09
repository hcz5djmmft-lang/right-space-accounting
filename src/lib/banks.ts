import 'server-only';
import { sql } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';

// Banks & cash: balances, account activity and reconciliation against the bank statement.
// Reconciling changes nothing in the books; it only records which lines the statement shows.

export type BankAccount = { code: string; name: string; balance: number; cleared: number; stmt_date: string | null; stmt_balance: number | null };

export async function bankAccounts() {
  return sql<BankAccount[]>`
    select a.code, a.name,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code), 0) balance,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join bank_cleared c on c.line_id = l.id where l.account = a.code), 0) cleared,
      to_char(s.stmt_date, 'YYYY-MM-DD') stmt_date, s.stmt_balance
    from accounts a left join bank_statements s on s.account = a.code
    where a.is_bank and a.postable order by a.code`;
}

export type BankLine = { line_id: number; entry_id: string; no: string; date: string; memo: string; description: string; party: string | null; cc: string | null; dr: number; cr: number; cleared: boolean };

/** Posted activity on one bank or cash account, oldest first. */
export async function bankActivity(code: string, from = '', to = '') {
  return sql<BankLine[]>`
    select l.id line_id, e.id entry_id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, l.description, pt.name party, coalesce(p.code, d.name) cc, l.dr, l.cr,
      (c.line_id is not null) cleared
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    left join bank_cleared c on c.line_id = l.id
    left join parties pt on pt.id = l.party_id left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id
    where l.account = ${code} and (${from} = '' or e.date >= ${from || null}::date) and (${to} = '' or e.date <= ${to || null}::date)
    order by e.date, e.no, l.line_no`;
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
export function reconcile(a: BankAccount) {
  const difference = a.stmt_balance === null ? null : r2(a.stmt_balance - a.cleared);
  return { uncleared: r2(a.balance - a.cleared), difference, reconciled: difference !== null && Math.abs(difference) < 0.005 };
}
