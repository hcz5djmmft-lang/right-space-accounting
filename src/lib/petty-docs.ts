import 'server-only';
import { sql, type Tx } from './db';
import { audit, checkLock, getSettings, nextNo, postEntry, reverseEntry, validateLines, writeLines } from './books';
import { type Line, RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { TZ } from './dates';
import { approverFor } from './documents';
import { holdersOf } from './org';
import { officeCash } from './petty-vouchers';

// Petty cash (update 20, Adel 2026-10-15). One petty cash has one cost center (a project or a department) and several lines,
// each with its own amount and GL code. It is paid to an employee, a vendor, a subcontractor or someone else (name typed).
// It needs approval before it is paid: a department's petty cash goes to that department's head, a project's to the
// Director of Engineering, then to Management in both cases. Finance then pays it out of the office cash: the entry
// posts (Dr each line's GL code, Cr the office cash) and carries the petty cash's own number, PT-00001…

export type PaidToKind = 'employee' | 'vendor' | 'sub' | 'other';
export const PAID_TO: [PaidToKind, string][] = [['employee', 'Employees'], ['vendor', 'Vendors'], ['sub', 'Subcontractors'], ['other', 'Other']];
export type PettyLine = { acc: string; amount: number; desc?: string };
export type PettyInput = {
  date: string; kind: PaidToKind; paidTo: string; purpose: string; project?: string | null; dept?: string | null; lines: PettyLine[];
};
export type PettyStatus = 'head' | 'management' | 'approved' | 'paid' | 'rejected' | 'voided';
export const STATUS_LABEL: Record<PettyStatus, string> = {
  head: 'Waiting for the head', management: 'Waiting for Management', approved: 'Approved, to be paid', paid: 'Paid', rejected: 'Returned', voided: 'Voided',
};

/** The first signer: the department's head, or for a project the Director of Engineering (else the head of Engineering). */
async function firstSigner(tx: Tx, project: string | null, dept: string | null) {
  if (project) {
    const [director] = await holdersOf('eng_director', tx);
    if (director) return { id: director, label: 'Director of Engineering' };
    const a = await approverFor(tx, { project });
    return { id: a.id, label: a.id ? 'Director of Engineering' : 'Management' };
  }
  const a = await approverFor(tx, { dept });
  return { id: a.id, label: a.id ? a.label : 'Management' };
}

/** Who receives the cash: the name kept on the petty cash, from the list picked or typed for Other. */
async function payee(tx: Tx, kind: PaidToKind, v: string) {
  const t = v.trim();
  if (!t) throw new RuleError('Choose who receives the cash.');
  if (kind === 'other') return { id: null, name: t };
  if (kind === 'employee') {
    const [e] = await tx<{ id: string; name: string }[]>`select id, name from employees where id = ${t} and active`;
    if (!e) throw new RuleError('Choose the employee who receives the cash.');
    return e;
  }
  const [p] = await tx<{ id: string; name: string }[]>`select id, name from parties where id = ${t} and type = 'vendor' and is_sub = ${kind === 'sub'}`;
  if (!p) throw new RuleError(`Choose the ${kind === 'sub' ? 'subcontractor' : 'vendor'} who receives the cash.`);
  return p;
}

/** Finance makes a petty cash; it goes into its approvals at once. */
export async function createPetty(user: User, i: PettyInput) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance makes petty cash.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new RuleError('Pick the date.');
  if (!i.purpose.trim()) throw new RuleError('Write what the money is for.');
  if (!i.project === !i.dept) throw new RuleError('Choose the project or the department it is for.');
  const lines = i.lines.map(l => ({ ...l, amount: r2(l.amount), desc: (l.desc ?? '').trim() })).filter(l => l.acc || l.amount);
  if (!lines.length) throw new RuleError('Add at least one line with an amount and a GL code.');
  for (const [k, l] of lines.entries()) {
    if (!l.acc) throw new RuleError(`Line ${k + 1}: choose the GL code.`);
    if (!(l.amount > 0)) throw new RuleError(`Line ${k + 1}: enter the amount.`);
  }
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    checkLock(s, i.date);
    const who = await payee(tx, i.kind, i.paidTo);
    // the GL codes are checked now as they will post: expense codes of this project (or the Office codes for a department)
    const cash = await officeCash(tx);
    const test: Line[] = [...lines.map(l => ({ account: l.acc, dr: l.amount, cr: 0, project_id: i.project || null, dept_id: i.dept || null, description: l.desc })),
      { account: cash.code, dr: 0, cr: r2(lines.reduce((t, l) => t + l.amount, 0)), description: '' }];
    await validateLines(tx, test, s);
    const types = await tx<{ code: string; type: string }[]>`select code, type from accounts where code = any(${lines.map(l => l.acc)})`;
    if (types.some(t => t.type !== 'expense')) throw new RuleError('A petty cash is charged to expense GL codes.');
    const signer = await firstSigner(tx, i.project || null, i.dept || null);
    const no = await nextNo(tx, 'PT-');   // the same series as the office cash's payment numbers, so the number never repeats
    const total = r2(lines.reduce((t, l) => t + l.amount, 0));
    const [{ id }] = await tx<{ id: string }[]>`insert into petty_cash (no, date, paid_to_kind, paid_to_id, paid_to_name, purpose, project_id, dept_id, total, status, approver_id, approver_label, created_by)
      values (${no}, ${i.date}, ${i.kind}, ${who.id}, ${who.name}, ${i.purpose.trim()}, ${i.project || null}, ${i.dept || null}, ${total}, 'head', ${signer.id}, ${signer.label}, ${user.id}) returning id`;
    for (const [k, l] of lines.entries())
      await tx`insert into petty_cash_lines (petty_id, line_no, account, description, amount) values (${id}, ${k + 1}, ${l.acc}, ${l.desc}, ${l.amount})`;
    await audit(tx, user, 'petty', id, 'Made', `${no} · ${total} to ${who.name} · to ${signer.label}`);
    return id;
  });
}

export type PettyDoc = {
  id: string; no: string; date: string; paid_to_kind: PaidToKind; paid_to_name: string; purpose: string; project_id: string | null; dept_id: string | null; cc: string | null;
  total: number; status: PettyStatus; approver_id: string | null; approver_label: string | null; head_name: string | null; head_at: string | null; mgmt_name: string | null; mgmt_at: string | null;
  decision_note: string; entry_id: string | null; entry_no: string | null; created_by: string | null; who: string | null; at: string;
};
const docSelect = (where = sql``, limit = 500) => sql<PettyDoc[]>`
  select c.id, c.no, to_char(c.date,'YYYY-MM-DD') date, c.paid_to_kind, c.paid_to_name, c.purpose, c.project_id, c.dept_id, coalesce(p.code, d.name) cc,
    c.total::float total, c.status, c.approver_id, c.approver_label, hu.name head_name, to_char(c.head_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') head_at,
    mu.name mgmt_name, to_char(c.mgmt_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') mgmt_at, c.decision_note, c.entry_id, e.no entry_no, c.created_by, u.name who,
    to_char(c.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at
  from petty_cash c left join projects p on p.id = c.project_id left join departments d on d.id = c.dept_id left join users u on u.id = c.created_by
  left join users hu on hu.id = c.head_by left join users mu on mu.id = c.mgmt_by left join journal_entries e on e.id = c.entry_id
  where true ${where} order by c.date desc, c.no desc limit ${limit}`;
export const listPetty = () => docSelect(sql``, 200);
export async function getPetty(id: string) { return (await docSelect(sql`and c.id = ${id}`))[0] ?? null; }
export const pettyLines = (id: string) => sql<{ line_no: number; account: string; account_name: string; description: string; amount: number }[]>`
  select l.line_no, l.account, a.name account_name, l.description, l.amount::float amount from petty_cash_lines l join accounts a on a.code = l.account where l.petty_id = ${id} order by l.line_no`;

/** Whether this person signs the step the petty cash waits on: the head (or the Director of Engineering), then Management. */
export function canSignPetty(user: User, d: Pick<PettyDoc, 'status' | 'approver_id'>) {
  if (d.status === 'head') return (!!d.approver_id && d.approver_id === user.id) || hasRole(user, 'management');
  if (d.status === 'management') return hasRole(user, 'management');
  return false;
}

export async function approvePetty(user: User, id: string) {
  await sql.begin(async tx => {
    const [d] = await tx<{ status: PettyStatus; approver_id: string | null; no: string }[]>`select status, approver_id, no from petty_cash where id = ${id} for update`;
    if (!d) throw new RuleError('Petty cash not found.');
    if (!canSignPetty(user, d)) throw new RuleError(d.status === 'head' || d.status === 'management' ? 'You are not the approver of this step.' : 'This petty cash is not waiting for approval.');
    if (d.status === 'head') {
      // a manager signing the first step signs for Management too: it is not asked twice of the same person
      const next = hasRole(user, 'management') ? 'approved' : 'management';
      await tx`update petty_cash set status = ${next}, head_by = ${user.id}, head_at = now(), mgmt_by = ${next === 'approved' ? user.id : null}, mgmt_at = ${next === 'approved' ? new Date() : null} where id = ${id}`;
    } else {
      await tx`update petty_cash set status = 'approved', mgmt_by = ${user.id}, mgmt_at = now() where id = ${id}`;
    }
    await audit(tx, user, 'petty', id, 'Approved', d.no);
  });
}

export async function returnPetty(user: User, id: string, note: string) {
  await sql.begin(async tx => {
    const [d] = await tx<{ status: PettyStatus; approver_id: string | null; no: string }[]>`select status, approver_id, no from petty_cash where id = ${id} for update`;
    if (!d) throw new RuleError('Petty cash not found.');
    if (!canSignPetty(user, d)) throw new RuleError('Only the approver of the current step can return it.');
    if (!note.trim()) throw new RuleError('Say why it is returned.');
    await tx`update petty_cash set status = 'rejected', decision_note = ${note.trim()} where id = ${id}`;
    await audit(tx, user, 'petty', id, 'Returned', note.trim());
  });
}

/** Finance hands over the cash: the entry posts out of the office cash with the petty cash's own PT- number. */
export async function payPetty(user: User, id: string, date: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance pays petty cash.');
  return sql.begin(async tx => {
    const [d] = await tx<{ status: PettyStatus; no: string; project_id: string | null; dept_id: string | null; paid_to_name: string; paid_to_kind: string; paid_to_id: string | null; purpose: string }[]>`
      select status, no, project_id, dept_id, paid_to_name, paid_to_kind, paid_to_id, purpose from petty_cash where id = ${id} for update`;
    if (!d) throw new RuleError('Petty cash not found.');
    if (d.status !== 'approved') throw new RuleError('A petty cash is paid once the head and Management have approved it.');
    const s = await getSettings(tx);
    checkLock(s, date);
    const cash = await officeCash(tx);
    const rows = await tx<{ account: string; description: string; amount: number }[]>`select account, description, amount::float amount from petty_cash_lines where petty_id = ${id} order by line_no`;
    const total = r2(rows.reduce((t, l) => t + l.amount, 0));
    if (total > cash.balance + 0.004) throw new RuleError(`The office cash holds ${cash.balance.toFixed(2)}, less than ${total.toFixed(2)}. Ask for a top-up first.`);
    const memo = `${d.purpose} · paid to ${d.paid_to_name}`;
    const lines: Line[] = [
      ...rows.map(l => ({ account: l.account, dr: l.amount, cr: 0, project_id: d.project_id, dept_id: d.dept_id, description: l.description ? `${l.description} · ${memo}` : memo })),
      { account: cash.code, dr: 0, cr: total, description: memo },
    ];
    await validateLines(tx, lines, s);
    const jno = await nextNo(tx, 'JE-');
    // the payment number is the petty cash's own (set before posting, so the office cash's series is not used twice)
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, form, source_type, source_id, payment_ref, created_by)
      values (${jno}, ${date}, ${`Petty cash ${d.no} · ${memo}`}, ${d.no}, 'petty_cash', 'draft', ${tx.json({ paid_to: d.paid_to_id, paid_to_name: d.paid_to_name, paid_to_kind: d.paid_to_kind, purpose: d.purpose })},
        'petty', ${id}, ${d.no}, ${user.id}) returning id`;
    await writeLines(tx, eid, lines);
    await postEntry(tx, user, eid, 'Posted from ' + d.no);
    await tx`update petty_cash set status = 'paid', entry_id = ${eid} where id = ${id}`;
    await audit(tx, user, 'petty', id, 'Paid', `${total} from ${cash.code} · ${jno}`);
    return eid;
  });
}

/** A paid petty cash voided: its entry is reversed and the cash comes back. One not yet paid is simply voided. */
export async function voidPetty(user: User, id: string, reason: string, date: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance voids petty cash.');
  if (!reason.trim()) throw new RuleError('Say why it is voided.');
  const d = await getPetty(id);
  if (!d) throw new RuleError('Petty cash not found.');
  if (d.status === 'voided') throw new RuleError('Already voided.');
  if (d.entry_id) await reverseEntry(user, d.entry_id, `Petty cash ${d.no} voided: ${reason.trim()}`, date);
  await sql`update petty_cash set status = 'voided', decision_note = ${reason.trim()} where id = ${id}`;
  await audit(sql, user, 'petty', id, 'Voided', reason.trim());
}

/** Petty cash waiting for this person's signature (Approvals). */
export async function pettyWaitingFor(user: User) {
  const rows = await docSelect(sql`and c.status in ('head', 'management')`);
  return rows.filter(d => canSignPetty(user, d));
}
