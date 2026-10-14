import 'server-only';
import { sql, type Tx } from './db';
import { audit, checkLock, getSettings, nextNo, postEntry, reverseEntry, validateLines, writeLines } from './books';
import { type Line, RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { TZ } from './dates';

// Petty cash vouchers (update 18): a petty cash is a cash payment, so it is paid only out of the office cash (the cash
// account shown on Banks & cash, A110 Cash – office safe), never from the bank. Finance makes one under Finance > Petty cash:
// amount, paid to (an employee), purpose, the project or department with its GL code and the date. It posts at once,
// Dr the expense and Cr the office cash, and takes the office cash's payment number (PT-00001…). A mistake is voided:
// the entry is reversed and the cash comes back.

/** The office cash: the cash account Banks & cash shows (the accountant's box, A115, is hidden and never used here). */
export async function officeCash(tx: Tx = sql) {
  const [a] = await tx<{ code: string; name: string; balance: number }[]>`
    select a.code, a.name, coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code), 0)::float balance
    from bank_accounts b join accounts a on a.code = b.account and a.postable where b.kind = 'cash' and not b.hidden order by a.code limit 1`;
  if (!a) throw new RuleError('No office cash account is set up. Tick "Bank or cash account" on Cash – office safe in the chart of accounts.');
  return a;
}

export type VoucherInput = { date: string; amount: number; paidTo: string; purpose: string; project?: string | null; dept?: string | null; acc: string };

export async function issuePettyCash(user: User, i: VoucherInput) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance makes petty cash.');
  const amount = r2(i.amount);
  if (!(amount > 0)) throw new RuleError('Enter the amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new RuleError('Pick the date.');
  if (!i.purpose.trim()) throw new RuleError('Write what the money is for.');
  if (!i.project === !i.dept) throw new RuleError('Choose the project or the department it is for.');
  if (!i.acc) throw new RuleError('Choose the GL code.');
  return sql.begin(async tx => {
    const [emp] = await tx<{ id: string; name: string }[]>`select id, name from employees where id = ${i.paidTo} and active`;
    if (!emp) throw new RuleError('Choose who receives the cash.');
    const s = await getSettings(tx);
    checkLock(s, i.date);
    const cash = await officeCash(tx);
    const desc = `${i.purpose.trim()} · paid to ${emp.name}`;
    const lines: Line[] = [
      { account: i.acc, dr: amount, cr: 0, project_id: i.project || null, dept_id: i.dept || null, description: desc },
      { account: cash.code, dr: 0, cr: amount, description: desc },
    ];
    await validateLines(tx, lines, s);
    const [a] = await tx<{ type: string }[]>`select type from accounts where code = ${i.acc}`;
    if (a?.type !== 'expense') throw new RuleError('A petty cash is charged to an expense GL code.');
    const no = await nextNo(tx, 'JE-');
    const [{ id }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, kind, status, form, source_type, created_by)
      values (${no}, ${i.date}, ${`Petty cash · ${desc}`}, 'petty_cash', 'draft', ${tx.json({ paid_to: emp.id, paid_to_name: emp.name, purpose: i.purpose.trim() })}, 'petty_cash', ${user.id}) returning id`;
    await writeLines(tx, id, lines);
    await audit(tx, user, 'journal', id, 'Petty cash made', `${amount} from ${cash.code} to ${emp.name}`);
    await postEntry(tx, user, id);
    return id;
  });
}

export type Voucher = {
  id: string; no: string; ref: string | null; date: string; amount: number; paid_to: string; purpose: string; cc: string | null; account: string; account_name: string;
  by: string | null; at: string; voided: boolean; reversal_no: string | null; reversed_by: string | null;
};
const voucherSelect = (where = sql``, limit = 500) => sql<Voucher[]>`
  select e.id, e.no, e.payment_ref ref, to_char(e.date,'YYYY-MM-DD') date, l.dr::float amount, coalesce(e.form->>'paid_to_name', '') paid_to, coalesce(e.form->>'purpose', e.memo) purpose,
    coalesce(p.code, d.name) cc, l.account, a.name account_name, u.name by, to_char(e.posted_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at,
    (e.reversed_by is not null) voided, r.no reversal_no, e.reversed_by
  from journal_entries e join journal_lines l on l.entry_id = e.id and l.dr > 0 join accounts a on a.code = l.account
  left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id left join users u on u.id = e.created_by
  left join journal_entries r on r.id = e.reversed_by
  where e.kind = 'petty_cash' and e.status = 'posted' ${where}
  order by e.date desc, e.no desc limit ${limit}`;
export const listVouchers = (limit = 50) => voucherSelect(sql``, limit);
export async function getVoucher(id: string) { return (await voucherSelect(sql`and e.id = ${id}`))[0]; }

/** Voids a voucher: the entry is reversed on the day given, the cash goes back into the office safe. */
export async function voidVoucher(user: User, id: string, reason: string, date: string) {
  const v = await getVoucher(id);
  if (!v) throw new RuleError('Petty cash not found.');
  if (!reason.trim()) throw new RuleError('Say why it is voided.');
  return reverseEntry(user, id, `Petty cash ${v.ref ?? v.no} voided: ${reason.trim()}`, date);
}
