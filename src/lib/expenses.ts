import 'server-only';
import { sql, type Tx } from './db';
import { r2, fmt } from './money';
import { type Line, RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit, checkLock, getSettings, nextNo, postEntry, validateLines, writeLines } from './books';
import { approverFor, canSign, getSteps, stepLabel } from './documents';
import { TZ } from './dates';
import { pushTo } from './push';

// Expense capture from the phone (improvement 6). Anyone signed in records what they spent with a photo of the receipt:
// amount, GL code, project or department, and what it was paid from (petty cash, the credit card, or their own money).
// The approvals are those of a payment request: the head of the department (a project: the head of Engineering), then
// the steps in Settings (Management). The last approval posts the entry: the expense against the petty cash or card
// account, or against the employee advances account when the person paid themselves, until Finance reimburses them.

export const OWN = 'own';
export type ExpenseInput = { id?: string; date: string; amount: number; account: string; project?: string | null; dept?: string | null; description: string; paidFrom: string };

export type Expense = {
  id: string; no: string; date: string; amount: number; account: string; account_name: string; project_id: string | null; project_code: string | null;
  dept_id: string | null; dept_name: string | null; description: string; paid_from: string; paid_from_name: string; status: string;
  approver_id: string | null; approver_label: string | null; signed: number; entry_id: string | null; entry_no: string | null;
  reimbursed_entry_id: string | null; reimbursed_no: string | null; created_by: string; who: string; created_at: string; receipts: number;
};
const select = sql`
  select x.id, x.no, to_char(x.date,'YYYY-MM-DD') date, x.amount::float amount, x.account, a.name account_name, x.project_id, p.code project_code, x.dept_id, d.name dept_name,
    x.description, x.paid_from, case when x.paid_from = 'own' then 'Own money (to reimburse)' else coalesce(b.name, x.paid_from) end paid_from_name, x.status,
    x.approver_id, x.approver_label, (select count(*)::int from expense_approvals v where v.expense_id = x.id) signed,
    x.entry_id, e.no entry_no, x.reimbursed_entry_id, r.no reimbursed_no, x.created_by, u.name who, to_char(x.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at,
    (select count(*)::int from attachments t where t.entity = 'expense' and t.entity_id = x.id) receipts
  from expense_claims x join accounts a on a.code = x.account left join projects p on p.id = x.project_id left join departments d on d.id = x.dept_id
  left join accounts b on b.code = x.paid_from left join journal_entries e on e.id = x.entry_id left join journal_entries r on r.id = x.reimbursed_entry_id
  left join users u on u.id = x.created_by`;
export const getExpense = async (id: string, tx: Tx = sql) => (await tx<Expense[]>`${select} where x.id = ${id}`)[0] ?? null;
/** The person's own expenses; Finance sees everyone's. */
export const listExpenses = (user: User, status = '') => sql<Expense[]>`${select}
  where (${hasRole(user, 'finance')} or x.created_by = ${user.id}) and (${status} = '' or x.status = ${status}) order by x.date desc, x.no desc limit 300`;

/** Petty cash and card accounts an expense can be paid from. */
export const paidFromOptions = () => sql<{ code: string; name: string; kind: string }[]>`
  select a.code, a.name, b.kind from accounts a join bank_accounts b on b.account = a.code where a.is_bank and a.postable and b.kind in ('cash', 'card') and not b.hidden order by b.kind desc, a.code`;

async function lines(tx: Tx, x: { amount: number; account: string; project_id: string | null; dept_id: string | null; description: string; paid_from: string; no: string; who: string }): Promise<Line[]> {
  const s = await getSettings(tx);
  const credit = x.paid_from === OWN ? s.account_map.empAdv : x.paid_from;
  if (!credit) throw new RuleError('No GL code is set for employee advances, so money paid by the person cannot be recorded.');
  const desc = `${x.no} · ${x.description}`.slice(0, 200);
  return [
    { account: x.account, dr: x.amount, cr: 0, project_id: x.project_id, dept_id: x.dept_id, description: desc },
    { account: credit, dr: 0, cr: x.amount, description: x.paid_from === OWN ? `${x.no} · owed to ${x.who}` : desc },
  ];
}

/** Records (or, when returned, corrects) an expense and sends it for approval. A receipt photo must be attached before it is sent. */
export async function saveExpense(user: User, i: ExpenseInput, opts: { requireReceipt?: boolean } = {}) {
  const amount = r2(i.amount);
  if (!(amount > 0)) throw new RuleError('Enter the amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new RuleError('Enter the date.');
  if (!i.description.trim()) throw new RuleError('Say what it was for.');
  if (!!i.project === !!i.dept) throw new RuleError('Choose the project or the department it was for.');
  const res = await sql.begin(async tx => {
    const s = await getSettings(tx);
    checkLock(s, i.date);
    const [acc] = await tx<{ type: string; postable: boolean }[]>`select type, postable from accounts where code = ${i.account}`;
    if (!acc || acc.type !== 'expense' || !acc.postable) throw new RuleError('Choose the GL code of the expense.');
    if (i.paidFrom !== OWN && !(await paidFromOptions()).some(o => o.code === i.paidFrom)) throw new RuleError('Choose what it was paid from.');
    let id = i.id, no: string;
    if (id) {
      const [old] = await tx<{ status: string; no: string; created_by: string }[]>`select status, no, created_by from expense_claims where id = ${id} for update`;
      if (!old) throw new RuleError('Expense not found.');
      if (old.status !== 'rejected') throw new RuleError('Only a returned expense can be changed.');
      if (old.created_by !== user.id && !hasRole(user, 'finance')) throw new RuleError('Only the person who recorded it, or Finance, can change it.');
      no = old.no;
    } else no = await nextNo(tx, 'EX-');
    const x = { amount, account: i.account, project_id: i.project || null, dept_id: i.dept || null, description: i.description.trim(), paid_from: i.paidFrom, no, who: user.name };
    await validateLines(tx, await lines(tx, x), s);
    const approver = await approverFor(tx, { dept: x.dept_id, project: x.project_id });
    const vals = { date: i.date, amount, account: x.account, project_id: x.project_id, dept_id: x.dept_id, description: x.description, paid_from: x.paid_from, status: 'pending', approver_id: approver.id, approver_label: approver.label };
    if (id) {
      if (opts.requireReceipt !== false) {
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from attachments where entity = 'expense' and entity_id = ${id}`;
        if (!n) throw new RuleError('Attach a photo of the receipt first.');
      }
      await tx`update expense_claims set ${tx(vals)} where id = ${id}`;
      await tx`delete from expense_approvals where expense_id = ${id}`;
      await audit(tx, user, 'expense', id, 'Corrected and sent again');
    } else {
      [{ id }] = await tx<{ id: string }[]>`insert into expense_claims ${tx({ ...vals, no, created_by: user.id })} returning id`;
      await audit(tx, user, 'expense', id!, 'Recorded and sent for approval', `${fmt(amount)} · ${x.description}`);
    }
    return { id: id!, no, approver };
  });
  return res.id;
}

async function load(tx: Tx, id: string) {
  const [x] = await tx<{ id: string; no: string; status: string; date: string; amount: number; account: string; project_id: string | null; dept_id: string | null; description: string; paid_from: string; approver_id: string | null; approver_label: string | null; created_by: string; who: string }[]>`
    select x.id, x.no, x.status, to_char(x.date,'YYYY-MM-DD') date, x.amount::float amount, x.account, x.project_id, x.dept_id, x.description, x.paid_from, x.approver_id, x.approver_label, x.created_by, u.name who
    from expense_claims x join users u on u.id = x.created_by where x.id = ${id} for update of x`;
  if (!x) throw new RuleError('Expense not found.');
  return x;
}

/** Signs the step waiting for this person; the last step posts the entry. */
export async function approveExpense(user: User, id: string) {
  const out = await sql.begin(async tx => {
    const x = await load(tx, id);
    if (x.status !== 'pending') throw new RuleError('This expense is not waiting for approval.');
    if (x.created_by === user.id && !hasRole(user, 'management')) throw new RuleError('Someone else approves your own expense.');
    const steps = await getSteps(tx);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from expense_approvals where expense_id = ${id}`;
    const step = steps[n];
    if (!canSign(user, step, x)) throw new RuleError(`This expense is waiting for ${step ? stepLabel(step, x) : 'approval'}, and you are not an approver for that step.`);
    const label = stepLabel(step, x);
    await tx`insert into expense_approvals (expense_id, step, step_name, user_id) values (${id}, ${step.position}, ${label}, ${user.id})`;
    if (steps[n + 1]) { await audit(tx, user, 'expense', id, label + ' approved'); return { posted: false, x }; }
    const s = await getSettings(tx);
    checkLock(s, x.date);
    const jl = await lines(tx, x);
    await validateLines(tx, jl, s);
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${x.date}, ${`${x.no} · ${x.description}`.slice(0, 200)}, ${x.no}, 'expense', 'draft', 'expense', ${id}, ${x.created_by}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Posted from ' + x.no);
    await tx`update expense_claims set status = 'posted', entry_id = ${eid} where id = ${id}`;
    await audit(tx, user, 'expense', id, label + ' approved · posted', `Journal entry ${jno}`);
    return { posted: true, x };
  });
  if (out.posted) await pushTo([out.x.created_by], { title: `${out.x.no} is approved`, body: `${fmt(out.x.amount)} · ${out.x.description}${out.x.paid_from === OWN ? ' · Finance will reimburse you' : ''}`, url: `/expenses/${id}` });
}

export async function returnExpense(user: User, id: string, reason: string) {
  const x = await sql.begin(async tx => {
    const x = await load(tx, id);
    if (x.status !== 'pending') throw new RuleError('This expense is not waiting for approval.');
    const steps = await getSteps(tx);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from expense_approvals where expense_id = ${id}`;
    if (!canSign(user, steps[n], x)) throw new RuleError('Only the approver of the current step can return it.');
    if (!reason.trim()) throw new RuleError('Say what needs changing.');
    await tx`update expense_claims set status = 'rejected' where id = ${id}`;
    await audit(tx, user, 'expense', id, 'Returned for changes', reason.trim());
    return x;
  });
  await pushTo([x.created_by], { title: `${x.no} was returned`, body: reason.trim(), url: `/expenses/${id}` });
}

export async function cancelExpense(user: User, id: string) {
  await sql.begin(async tx => {
    const x = await load(tx, id);
    if (!['pending', 'rejected'].includes(x.status)) throw new RuleError('A posted expense is reversed from its journal entry instead.');
    if (x.created_by !== user.id && !hasRole(user, 'finance')) throw new RuleError('Only the person who recorded it, or Finance, can cancel it.');
    await tx`update expense_claims set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'expense', id, 'Cancelled');
  });
}

/** Finance pays the person back what they spent from their own money: employee advances against the bank or petty cash. */
export async function reimburseExpense(user: User, id: string, bank: string, date: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance reimburses expenses.');
  return sql.begin(async tx => {
    const x = await load(tx, id);
    const [r] = await tx<{ reimbursed_entry_id: string | null }[]>`select reimbursed_entry_id from expense_claims where id = ${id}`;
    if (x.status !== 'posted' || x.paid_from !== OWN) throw new RuleError('Only an approved expense paid from the person\'s own money is reimbursed.');
    if (r.reimbursed_entry_id) throw new RuleError('Already reimbursed.');
    const s = await getSettings(tx);
    checkLock(s, date);
    const [b] = await tx<{ code: string }[]>`select code from accounts where code = ${bank} and is_bank and postable and type = 'asset'`;
    if (!b) throw new RuleError('Choose the bank or petty cash account it is paid from.');
    const jl: Line[] = [
      { account: s.account_map.empAdv, dr: x.amount, cr: 0, description: `${x.no} · reimbursed to ${x.who}` },
      { account: bank, dr: 0, cr: x.amount, description: `${x.no} · reimbursed to ${x.who}` },
    ];
    await validateLines(tx, jl, s);
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${date}, ${`${x.no} · reimbursed to ${x.who}`}, ${x.no}, 'transfer', 'draft', 'expense', ${id}, ${user.id}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Reimbursement of ' + x.no);
    await tx`update expense_claims set reimbursed_entry_id = ${eid} where id = ${id}`;
    await audit(tx, user, 'expense', id, 'Reimbursed', `Journal entry ${jno}`);
    return eid;
  });
}

/** Expenses waiting for this person's step (the Approvals page and the pending steps). */
export async function expensesWaitingFor(user: User) {
  const [steps, rows] = await Promise.all([getSteps(), sql<Expense[]>`${select} where x.status = 'pending' order by x.date`]);
  return rows.filter(x => x.created_by !== user.id || hasRole(user, 'management')).filter(x => canSign(user, steps[x.signed], x))
    .map(x => ({ ...x, step: stepLabel(steps[x.signed], x) }));
}
/** Approved expenses still owed to the people who paid them (Finance). */
export const toReimburse = () => sql<Expense[]>`${select} where x.status = 'posted' and x.paid_from = 'own' and x.reimbursed_entry_id is null order by x.date`;

/** A new expense from the phone with its receipt photo: the photo is checked first, so an expense is never left without it. */
export async function recordExpense(user: User, i: ExpenseInput, receipt: { name: string; body: Buffer } | null) {
  const { sniff, MAX_BYTES, addAttachment } = await import('./attachments');
  if (!receipt || !receipt.body.length) throw new RuleError('Take a photo of the receipt.');
  if (receipt.body.length > MAX_BYTES) throw new RuleError('That photo is over 4 MB. Take it again a little further away.');
  if (!sniff(receipt.body)) throw new RuleError('The receipt must be a photo (JPEG, PNG, WebP, HEIC) or a PDF.');
  const id = await saveExpense(user, i, { requireReceipt: false });
  try { await addAttachment(user, 'expense', id, receipt.name, receipt.body, 'receipt'); }
  catch (e) { await sql`delete from expense_claims where id = ${id}`; throw e; }
  return id;
}
