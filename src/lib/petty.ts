import 'server-only';
import { sql } from './db';
import { fmt, r2 } from './money';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit, nextNo, saveEntry } from './books';
import { TZ, today } from './dates';
import { pushTo } from './push';

// Petty cash (improvement 15). The holder counts the box by denomination; the count is set against the book balance
// on that day and any difference shows. When the box runs low the holder asks Finance for a top-up (by default up to
// the float); Finance or Management approves it from a bank account, which posts the transfer to petty cash.
// The month-end close ticks "Petty cash counted" from these counts. Petty cash is the cash in the office safe (A110,
// or the code set as pettyCash in the account map); the other cash accounts are left alone.

/** Egyptian notes and coins, largest first. */
export const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 1, 0.5, 0.25] as const;

export type PettyBox = { code: string; name: string; holder: string | null; float: number | null; balance: number; last_count: string | null; last_difference: number | null };

/** The petty cash account: the office safe. */
async function pettyCode() {
  const [r] = await sql<{ code: string | null }[]>`
    select coalesce((select a.code from accounts a join bank_accounts b on b.account = a.code and b.kind = 'cash' where a.code = coalesce(s.account_map->>'pettyCash', 'A110')),
      (select min(b.account) from bank_accounts b where b.kind = 'cash')) code from settings s where s.id = 1`;
  return r?.code ?? '';
}

export async function pettyBoxes(): Promise<PettyBox[]> {
  const code = await pettyCode();
  return sql<PettyBox[]>`
    select a.code, a.name, b.holder, b.float_amount::float float,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code), 0)::float balance,
      (select to_char(c.date,'YYYY-MM-DD') from cash_counts c where c.account = a.code order by c.date desc, c.at desc limit 1) last_count,
      (select c.difference::float from cash_counts c where c.account = a.code order by c.date desc, c.at desc limit 1) last_difference
    from accounts a join bank_accounts b on b.account = a.code and b.kind = 'cash' where a.postable and a.code = ${code}`;
}

async function box(code: string) {
  if (!code || code !== await pettyCode()) throw new RuleError('Petty cash is the office safe; choose it.');
  return code;
}
const bookOn = async (code: string, date: string) => r2((await sql<{ n: number }[]>`
  select coalesce(sum(l.dr - l.cr), 0)::float n from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = ${code} and e.date <= ${date}::date`)[0].n);

/** Saves a count: how many of each note and coin. The difference is counted − book on that day. */
export async function countCash(user: User, code: string, date: string, pieces: Record<string, number>, remark = '') {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance counts petty cash.');
  await box(code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw new RuleError('Enter the day of the count (today or earlier).');
  const notes: Record<string, number> = {};
  let counted = 0;
  for (const d of DENOMINATIONS) {
    const n = Number(pieces[String(d)] ?? 0);
    if (!Number.isInteger(n) || n < 0) throw new RuleError(`Enter a whole number of ${d >= 1 ? `${d} pound notes` : `${d * 100} piastre coins`}.`);
    if (n) { notes[String(d)] = n; counted += n * d; }
  }
  counted = r2(counted);
  const book = await bookOn(code, date), difference = r2(counted - book);
  if (difference && !remark.trim()) throw new RuleError(`The count is ${fmt(counted)} and the books say ${fmt(book)}. Write a note on the difference of ${fmt(difference)}.`);
  const [{ id }] = await sql<{ id: string }[]>`insert into cash_counts (account, date, notes, counted, book, difference, remark, counted_by)
    values (${code}, ${date}, ${sql.json(notes)}, ${counted}, ${book}, ${difference}, ${remark.trim()}, ${user.id}) returning id`;
  await audit(sql, user, 'cash-count', id, 'Petty cash counted', `${code} ${date}: counted ${counted.toFixed(2)}, book ${book.toFixed(2)}, difference ${difference.toFixed(2)}`);
  return { id, counted, book, difference };
}

export const cashCounts = (code: string) => sql<{ id: string; date: string; notes: Record<string, number>; counted: number; book: number; difference: number; remark: string; who: string | null }[]>`
  select c.id, to_char(c.date,'YYYY-MM-DD') date, c.notes, c.counted::float counted, c.book::float book, c.difference::float difference, c.remark, u.name who
  from cash_counts c left join users u on u.id = c.counted_by where c.account = ${code} order by c.date desc, c.at desc limit 24`;

/** Counts of the month's petty cash: one dated in the month or in the first 10 days after it, for every box that had cash. */
export async function countedFor(period: string, monthEnd: string) {
  const late = new Date(Date.parse(monthEnd + 'T00:00:00Z') + 10 * 864e5).toISOString().slice(0, 10);
  const rows = await sql<{ code: string; name: string; counted: boolean }[]>`
    select a.code, a.name, exists (select 1 from cash_counts c where c.account = a.code and c.date between ${period + '-01'}::date and ${late}::date) counted
    from accounts a join bank_accounts b on b.account = a.code and b.kind = 'cash'
    where a.code = ${await pettyCode()} and exists (select 1 from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code and e.date <= ${monthEnd}::date)`;
  return { boxes: rows.length, missing: rows.filter(r => !r.counted).map(r => r.name) };
}

export async function setFloat(user: User, code: string, amount: number | null) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance sets the float.');
  await box(code);
  if (amount !== null && !(amount >= 0)) throw new RuleError('Enter the float as an amount.');
  await sql`update bank_accounts set float_amount = ${amount === null ? null : r2(amount)} where account = ${code}`;
  await audit(sql, user, 'bank', code, 'Petty cash float set', amount === null ? 'none' : amount.toFixed(2));
}

export type Topup = { id: string; no: string; account: string; box: string; amount: number; note: string; status: string; who: string | null; requested_by: string | null; at: string; decided: string | null; decision: string; entry_id: string | null; entry_no: string | null };
export const topups = (status?: string) => sql<Topup[]>`
  select t.id, t.no, t.account, a.name box, t.amount::float amount, t.note, t.status, u.name who, t.requested_by, to_char(t.requested_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at,
    d.name decided, t.decision, t.entry_id, e.no entry_no
  from petty_topups t join accounts a on a.code = t.account left join users u on u.id = t.requested_by left join users d on d.id = t.decided_by left join journal_entries e on e.id = t.entry_id
  where (${status ?? ''} = '' or t.status = ${status ?? ''}) order by t.requested_at desc limit 50`;

/** Who approves a top-up: Management, or Finance other than the person asking. */
export const canApproveTopup = (user: User, t: { requested_by: string | null }) => hasRole(user, 'management') || (hasRole(user, 'finance') && t.requested_by !== user.id);

async function approvers(except: string) {
  return (await sql<{ id: string }[]>`select id from users where active and id <> ${except} and ('management' = any(roles) or 'finance' = any(roles))`).map(r => r.id);
}

/** The holder asks Finance for a top-up. */
export async function requestTopup(user: User, code: string, amount: number, note: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance asks for petty cash top-ups.');
  await box(code);
  if (!(amount > 0)) throw new RuleError('Enter the amount needed.');
  const id = await sql.begin(async tx => {
    const [open] = await tx`select 1 from petty_topups where account = ${code} and status = 'pending'`;
    if (open) throw new RuleError('A top-up for this box is already waiting.');
    const no = await nextNo(tx, 'PCT-');
    const [{ id }] = await tx<{ id: string }[]>`insert into petty_topups (no, account, amount, note, requested_by) values (${no}, ${code}, ${r2(amount)}, ${note.trim()}, ${user.id}) returning id`;
    await audit(tx, user, 'petty-topup', id, 'Top-up requested', `${no} · ${r2(amount).toFixed(2)}`);
    return id;
  });
  await pushTo(await approvers(user.id), { title: 'Petty cash top-up waiting', body: `${user.name} asks for ${fmt(amount)}${note.trim() ? ` · ${note.trim()}` : ''}`, url: '/petty-cash' });
  return id;
}

/** Approves a top-up from a bank account: posts the transfer bank → petty cash on the day. */
export async function approveTopup(user: User, id: string, bank: string, date = today()) {
  const [t] = await sql<{ no: string; account: string; amount: number; status: string; requested_by: string | null; note: string }[]>`
    select no, account, amount::float amount, status, requested_by, note from petty_topups where id = ${id}`;
  if (!t) throw new RuleError('Top-up not found.');
  if (t.status !== 'pending') throw new RuleError('This top-up is not waiting.');
  if (!canApproveTopup(user, t)) throw new RuleError('Management, or someone else in Finance, approves this top-up.');
  const [b] = await sql<{ code: string }[]>`select a.code from accounts a left join bank_accounts k on k.account = a.code where a.code = ${bank} and a.is_bank and a.type = 'asset' and coalesce(k.kind, 'bank') = 'bank'`;
  if (!b) throw new RuleError('Choose the bank account the money comes from.');
  const entry = await saveEntry(user, { date, ref: t.no, form: { type: 'transfer', memo: `Petty cash top-up ${t.no}`, bank: b.code, toBank: t.account, amount: t.amount, items: [] } }, 'post');
  const [st] = await sql<{ status: string }[]>`select status from journal_entries where id = ${entry}`;
  await sql.begin(async tx => {
    const r = await tx`update petty_topups set status = 'paid', decided_by = ${user.id}, decided_at = now(), entry_id = ${entry} where id = ${id} and status = 'pending'`;
    if (!r.count) throw new RuleError('This top-up was just decided by someone else.');
    await audit(tx, user, 'petty-topup', id, 'Top-up approved', `${t.no} from ${b.code}${st?.status === 'posted' ? '' : ' (entry waiting for approval)'}`);
  });
  if (t.requested_by) await pushTo([t.requested_by], { title: `Top-up ${t.no} approved`, body: `${fmt(t.amount)} from the bank to petty cash`, url: '/petty-cash' });
  return entry;
}

export async function rejectTopup(user: User, id: string, reason: string) {
  const [t] = await sql<{ no: string; status: string; requested_by: string | null }[]>`select no, status, requested_by from petty_topups where id = ${id}`;
  if (!t) throw new RuleError('Top-up not found.');
  if (t.status !== 'pending') throw new RuleError('This top-up is not waiting.');
  const own = t.requested_by === user.id;
  if (!own && !canApproveTopup(user, t)) throw new RuleError('Management, or someone else in Finance, decides this top-up.');
  if (!own && !reason.trim()) throw new RuleError('Say why it is turned down.');
  await sql.begin(async tx => {
    await tx`update petty_topups set status = ${own ? 'cancelled' : 'rejected'}, decided_by = ${user.id}, decided_at = now(), decision = ${reason.trim()} where id = ${id}`;
    await audit(tx, user, 'petty-topup', id, own ? 'Top-up cancelled' : 'Top-up turned down', reason.trim());
  });
  if (!own && t.requested_by) await pushTo([t.requested_by], { title: `Top-up ${t.no} turned down`, body: reason.trim(), url: '/petty-cash' });
}

/** Top-ups waiting for this user, for the Approvals page. */
export async function topupsWaitingFor(user: User) {
  if (!hasRole(user, 'finance', 'management')) return [];
  return (await topups('pending')).filter(t => canApproveTopup(user, t));
}
