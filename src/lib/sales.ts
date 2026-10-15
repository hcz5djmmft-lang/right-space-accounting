import 'server-only';
import { sql, type Tx } from './db';
import { audit, checkLock, getSettings, nextNo, postEntry, reverseEntry, validateLines, writeLines } from './books';
import { docLines, docTotals, paymentLines, RuleError, type DocInput, type DocLine } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { collectionTypes } from './collections';
import { holdersOf } from './org';

// Sales invoices to customers and the receipts that settle them. Finance records both. From update 20 (Adel, 2026-10-15)
// a new invoice goes through Finance, then Engineering (the Director of Engineering), then Management before it is
// issued: Management's approval posts it. A returned invoice is a draft again.

export type InvoiceInput = { id?: string; date: string; due?: string | null; party: string; project?: string | null; category?: string | null; ref: string; vatRate: number; lines: DocLine[] };

const asDoc = (no: string, i: InvoiceInput): DocInput => ({
  kind: 'sales', no, party: i.party, project: i.project, dept: null, vatRate: i.vatRate, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0, lines: i.lines,
});

const needFinance = (u: User, what: string) => { if (!hasRole(u, 'finance')) throw new RuleError(`Only Finance can ${what}.`); };

/** Saves a sales invoice as a draft, or saves and posts it (Dr receivables, Cr revenue, Cr output VAT). */
export async function saveSalesInvoice(user: User, input: InvoiceInput, post: boolean) {
  needFinance(user, 'record sales invoices');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    if (!input.party) throw new RuleError('Choose the customer.');
    // the type (design, fit-out, furniture) decides the revenue code of every line; without one, each line names its own code
    const type = input.category ? (await collectionTypes(tx)).find(t => t.id === input.category) : null;
    if (input.category && !type) throw new RuleError('Choose the type of the invoice: design, fit-out or furniture.');
    const lines = input.lines.map(l => (type ? { ...l, acc: type.account } : l)).filter(l => l.acc && r2(l.qty * l.price) !== 0);
    if (!lines.length) throw new RuleError(type ? 'Add at least one line with an amount.' : 'Add at least one line with a revenue GL code and an amount.');
    const types = await tx<{ code: string; type: string }[]>`select code, type from accounts where code in ${tx(lines.map(l => l.acc))}`;
    const bad = lines.find(l => types.find(a => a.code === l.acc)?.type !== 'revenue');
    if (bad) throw new RuleError(`${bad.acc} is not a revenue GL code. Invoice lines go to revenue.`);
    const i = { ...input, lines };
    let id = i.id, no: string;
    if (id) {
      const [old] = await tx<{ status: string; no: string }[]>`select status, no from invoices where id = ${id} and kind = 'sales' for update`;
      if (!old) throw new RuleError('Invoice not found.');
      if (old.status !== 'draft') throw new RuleError('Only draft invoices can be edited. Void a posted invoice instead.');
      no = old.no;
    } else {
      no = await nextNo(tx, 'INV-');
    }
    const doc = asDoc(no, i);
    const t = docTotals(doc);
    docLines(doc, s.account_map); // builds the future entry, so bad input fails before anything is written
    const vals = {
      date: i.date, due_date: i.due || null, party_id: i.party, project_id: i.project || null, category: type?.id ?? null, ref: i.ref,
      vat_rate: i.vatRate, subtotal: t.subtotal, vat: t.vat, total: t.total, net: t.net, status: 'draft',
    };
    if (id) {
      await tx`update invoices set ${tx(vals)} where id = ${id}`;
      await tx`delete from invoice_lines where invoice_id = ${id}`;
    } else {
      [{ id }] = await tx<{ id: string }[]>`insert into invoices ${tx({ ...vals, kind: 'sales', no, created_by: user.id })} returning id`;
    }
    for (const [k, l] of lines.entries())
      await tx`insert into invoice_lines (invoice_id, line_no, account, description, qty, price, project_id)
        values (${id!}, ${k + 1}, ${l.acc}, ${l.desc ?? ''}, ${l.qty}, ${l.price}, ${l.project || i.project || null})`;
    await audit(tx, user, 'invoice', id!, input.id ? 'Edited' : 'Created');
    await closeInvoiceTask(tx, i.project);
    if (post) await postInvoice(tx, user, id!);
    return id!;
  });
}

async function postInvoice(tx: Tx, user: User, id: string) {
  const s = await getSettings(tx);
  const [inv] = await tx<{ no: string; status: string; date: string; party_id: string; project_id: string | null; vat_rate: number }[]>`
    select no, status, to_char(date,'YYYY-MM-DD') date, party_id, project_id, vat_rate from invoices where id = ${id} and kind = 'sales' for update`;
  if (!inv) throw new RuleError('Invoice not found.');
  if (inv.status !== 'draft') throw new RuleError('This invoice is already posted.');
  checkLock(s, inv.date);
  const lines = await tx<{ account: string; description: string; qty: number; price: number; project_id: string | null }[]>`
    select account, description, qty, price, project_id from invoice_lines where invoice_id = ${id} order by line_no`;
  const jl = docLines({ kind: 'sales', no: inv.no, party: inv.party_id, project: inv.project_id, vatRate: inv.vat_rate, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0,
    lines: lines.map(l => ({ acc: l.account, desc: l.description, qty: l.qty, price: l.price, project: l.project_id })) }, s.account_map);
  await validateLines(tx, jl, s);
  const [party] = await tx<{ name: string }[]>`select name from parties where id = ${inv.party_id}`;
  const jno = await nextNo(tx, 'JE-');
  const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
    values (${jno}, ${inv.date}, ${inv.no + ' · ' + (party?.name ?? '')}, ${inv.no}, 'sales_invoice', 'draft', 'invoice', ${id}, ${user.id}) returning id`;
  await writeLines(tx, eid, jl);
  await postEntry(tx, user, eid, 'Posted from ' + inv.no);
  await tx`update invoices set status = 'posted', entry_id = ${eid} where id = ${id}`;
  await audit(tx, user, 'invoice', id, 'Posted', `Journal entry ${jno}`);
}

export async function postSalesInvoice(user: User, id: string) {
  needFinance(user, 'post sales invoices');
  await sql.begin(tx => postInvoice(tx, user, id));
}

export async function deleteSalesInvoice(user: User, id: string) {
  needFinance(user, 'delete invoices');
  await sql.begin(async tx => {
    const [inv] = await tx<{ status: string; no: string }[]>`select status, no from invoices where id = ${id} and kind = 'sales' for update`;
    if (!inv) return;
    if (inv.status !== 'draft') throw new RuleError('Only draft invoices can be deleted.');
    await tx`delete from invoices where id = ${id}`;
    await audit(tx, user, 'invoice', id, 'Deleted', inv.no);
  });
}

/** Cancels a posted invoice by reversing its entry. Not allowed once a receipt has been allocated to it. */
export async function voidSalesInvoice(user: User, id: string, reason: string, date: string) {
  needFinance(user, 'void invoices');
  const inv = await sql.begin(async tx => {
    const [inv] = await tx<{ no: string; status: string; entry_id: string }[]>`select no, status, entry_id from invoices where id = ${id} and kind = 'sales' for update`;
    if (!inv) throw new RuleError('Invoice not found.');
    if (inv.status !== 'posted') throw new RuleError('Only posted invoices can be voided.');
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' where a.invoice_id = ${id}`;
    if (n) throw new RuleError('A receipt is allocated to this invoice. Reverse the receipt first.');
    return inv;
  });
  const rid = await reverseEntry(user, inv.entry_id, `Void ${inv.no}${reason ? ': ' + reason : ''}`, date);
  await sql.begin(async tx => {
    await tx`update invoices set status = 'void' where id = ${id}`;
    await audit(tx, user, 'invoice', id, 'Voided', reason);
  });
  return rid;
}

/** Posted sales invoices with what has been received against them. */
export async function openInvoices(tx: Tx, party?: string) {
  return tx<{ id: string; no: string; date: string; project_id: string | null; category: string | null; total: number; received: number; open: number }[]>`
    select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.project_id, i.category, i.total,
      coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' where a.invoice_id = i.id),0) received,
      i.total - coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' where a.invoice_id = i.id),0) open
    from invoices i where i.kind = 'sales' and i.status = 'posted' and (${party ?? null}::text is null or i.party_id = ${party ?? null})
    order by i.date, i.no`;
}

/** What the customer settled: the bank amount plus any WHT the customer withheld, allocated to invoices. */
export type ReceiptInput = { date: string; party: string; project?: string | null; bank: string; received: number; wht: number; memo: string; ref: string; alloc: { invoice: string; amount: number }[] };

/** Records and posts a customer receipt (Finance). Dr bank, Dr WHT receivable, Cr receivables. Unallocated money stays on the customer's account. */
export async function postCustomerReceipt(user: User, p: ReceiptInput) {
  needFinance(user, 'record receipts');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    checkLock(s, p.date);
    if (!p.party) throw new RuleError('Choose the customer.');
    const [into] = await tx<{ hidden: boolean }[]>`select coalesce(b.hidden, false) hidden from accounts a left join bank_accounts b on b.account = a.code where a.code = ${p.bank}`;
    if (into?.hidden) throw new RuleError('That cash account is no longer in use: money comes into the bank or the office cash.');
    const received = r2(p.received), wht = r2(p.wht || 0), amount = r2(received + wht);
    if (received <= 0) throw new RuleError('Enter the amount received.');
    if (wht < 0) throw new RuleError('WHT cannot be negative.');
    const alloc = p.alloc.filter(a => r2(a.amount) > 0);
    const open = new Map((await openInvoices(tx, p.party)).map(r => [r.id, r]));
    for (const a of alloc) {
      const r = open.get(a.invoice);
      if (!r) throw new RuleError('A selected invoice is not open for this customer.');
      if (a.amount > r.open + 0.004) throw new RuleError(`${r.no}: allocation is more than its open balance (${r.open.toFixed(2)}).`);
    }
    const allocated = r2(alloc.reduce((t, a) => t + a.amount, 0));
    if (allocated > amount + 0.004) throw new RuleError(`Allocated ${allocated.toFixed(2)} but the receipt settles only ${amount.toFixed(2)} (bank amount plus WHT).`);
    // the receipt belongs to the project it was raised for, else to the project of the first invoice it settles
    const project = p.project || (alloc.length ? (open.get(alloc[0].invoice)?.project_id ?? null) : null);
    const no = await nextNo(tx, 'RCT-');
    const jl = paymentLines({ kind: 'receipt', no, party: p.party, bank: p.bank, amount, wht, allocated }, s.account_map);
    await validateLines(tx, jl, s);
    const [party] = await tx<{ name: string }[]>`select name from parties where id = ${p.party}`;
    const [{ id }] = await tx<{ id: string }[]>`insert into payments (kind, no, date, party_id, project_id, bank, amount, wht, memo, ref, status, created_by)
      values ('receipt', ${no}, ${p.date}, ${p.party}, ${project}, ${p.bank}, ${amount}, ${wht}, ${p.memo}, ${p.ref}, 'draft', ${user.id}) returning id`;
    for (const a of alloc) await tx`insert into payment_allocations (payment_id, invoice_id, amount) values (${id}, ${a.invoice}, ${r2(a.amount)})`;
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${p.date}, ${no + ' · ' + (party?.name ?? '')}, ${p.ref || no}, 'receipt', 'draft', 'payment', ${id}, ${user.id}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Posted from ' + no);
    await tx`update payments set status = 'posted', entry_id = ${eid} where id = ${id}`;
    await audit(tx, user, 'payment', id, 'Posted', `Journal entry ${jno}`);
    return id;
  });
}

/** Cancels a posted receipt by reversing its entry; the invoices it settled are open again. */
export async function voidCustomerReceipt(user: User, id: string, reason: string, date: string) {
  needFinance(user, 'void receipts');
  const p = await sql.begin(async tx => {
    const [p] = await tx<{ no: string; status: string; entry_id: string }[]>`select no, status, entry_id from payments where id = ${id} and kind = 'receipt' for update`;
    if (!p) throw new RuleError('Receipt not found.');
    if (p.status !== 'posted') throw new RuleError('Only posted receipts can be voided.');
    return p;
  });
  const rid = await reverseEntry(user, p.entry_id, `Void ${p.no}${reason ? ': ' + reason : ''}`, date);
  await sql.begin(async tx => {
    await tx`update payments set status = 'void' where id = ${id}`;
    await audit(tx, user, 'payment', id, 'Voided', reason);
  });
  return rid;
}

// ---- Approval before the invoice is issued (update 20, item 25) ----

export type SalesStep = 'finance' | 'engineering' | 'management';
export const SALES_STEP_LABEL: Record<SalesStep, string> = { finance: 'Finance', engineering: 'Engineering', management: 'Management' };
const NEXT: Record<SalesStep, SalesStep | null> = { finance: 'engineering', engineering: 'management', management: null };

/** Engineering's signer: the Director of Engineering, else the head of Engineering, else anyone in Engineering. */
async function engineeringSigners(tx: Tx) {
  const director = await holdersOf('eng_director', tx);
  if (director.length) return director;
  const [d] = await tx<{ head: string | null }[]>`select (select u.id from users u where u.id = d.head_user_id and u.active) head from departments d where d.code = 'ENG' and d.active`;
  return d?.head ? [d.head] : null;
}

/** Whether this person signs the invoice at its current step. Management signs any step. */
export async function canSignSales(user: User, step: SalesStep | null, tx: Tx = sql) {
  if (!step) return false;
  if (user.roles.includes('management')) return true;
  if (step === 'finance') return hasRole(user, 'finance');
  if (step === 'engineering') {
    const who = await engineeringSigners(tx);
    return who ? who.includes(user.id) : hasRole(user, 'engineering');
  }
  return false;
}

/** Finance sends a draft for approval: it waits for Finance's own check first. */
export async function sendSalesForApproval(user: User, id: string) {
  needFinance(user, 'send sales invoices for approval');
  await sql.begin(async tx => {
    const [inv] = await tx<{ status: string; no: string }[]>`select status, no from invoices where id = ${id} and kind = 'sales' for update`;
    if (!inv) throw new RuleError('Invoice not found.');
    if (inv.status !== 'draft') throw new RuleError('Only a draft is sent for approval.');
    await tx`update invoices set status = 'pending', sales_step = 'finance', approver_label = 'Finance' where id = ${id}`;
    await audit(tx, user, 'invoice', id, 'Sent for approval', 'Finance, then Engineering, then Management');
  });
}

/** Signs the current step; Management's signature issues (posts) the invoice. */
export async function approveSales(user: User, id: string, note = '') {
  await sql.begin(async tx => {
    const [inv] = await tx<{ status: string; sales_step: SalesStep | null }[]>`select status, sales_step from invoices where id = ${id} and kind = 'sales' for update`;
    if (!inv) throw new RuleError('Invoice not found.');
    if (inv.status !== 'pending' || !inv.sales_step) throw new RuleError('This invoice is not waiting for approval.');
    if (!(await canSignSales(user, inv.sales_step, tx))) throw new RuleError(`This invoice waits for ${SALES_STEP_LABEL[inv.sales_step]}.`);
    await audit(tx, user, 'invoice', id, `Approved (${SALES_STEP_LABEL[inv.sales_step]})`, note);
    // Management may sign for an earlier step; the invoice still goes on to Management's own approval
    const next = NEXT[inv.sales_step];
    if (next) {
      await tx`update invoices set sales_step = ${next}, approver_label = ${SALES_STEP_LABEL[next]} where id = ${id}`;
      return;
    }
    await tx`update invoices set status = 'draft', sales_step = null, approver_label = null where id = ${id}`;
    await postInvoice(tx, user, id);
  });
}

/** Sends the invoice back to Finance as a draft, with the reason. */
export async function returnSales(user: User, id: string, note: string) {
  await sql.begin(async tx => {
    const [inv] = await tx<{ status: string; sales_step: SalesStep | null }[]>`select status, sales_step from invoices where id = ${id} and kind = 'sales' for update`;
    if (!inv || inv.status !== 'pending') throw new RuleError('This invoice is not waiting for approval.');
    if (!(await canSignSales(user, inv.sales_step, tx))) throw new RuleError(`This invoice waits for ${SALES_STEP_LABEL[inv.sales_step!]}.`);
    if (!note.trim()) throw new RuleError('Write why it goes back.');
    await tx`update invoices set status = 'draft', sales_step = null, approver_label = null where id = ${id}`;
    await audit(tx, user, 'invoice', id, 'Returned to Finance', note);
  });
}

/** Sales invoices waiting for this person's approval. */
export async function salesWaitingFor(user: User) {
  const rows = await sql<{ id: string; no: string; date: string; customer: string; total: number; sales_step: SalesStep }[]>`
    select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, p.name customer, i.total, i.sales_step
    from invoices i join parties p on p.id = i.party_id where i.kind = 'sales' and i.status = 'pending' and i.sales_step is not null order by i.date, i.no`;
  const out: (typeof rows)[number][] = [];
  for (const r of rows) if (await canSignSales(user, r.sales_step)) out.push(r);
  return out;
}

// ---- A new project asks the accountant for its sales invoice (update 20, item 26) ----

const INVOICE_TASK = 'Sales invoice: ';

/** Gives the accountant (else the finance head) a task to make the new project's sales invoice. It closes by itself once
 *  an invoice for the project is made. */
export async function askForSalesInvoice(tx: Tx, user: User, project: { id: string; code: string; name?: string | null }) {
  const [who] = [...await holdersOf('accountant', tx), ...await holdersOf('finance_head', tx)];
  if (!who) return null;
  const [e] = await tx<{ id: string }[]>`select id from employees where user_id = ${who} and active limit 1`;
  const [{ id }] = await tx<{ id: string }[]>`insert into tasks (title, details, status, priority, assignee_id, assignee_emp_id, link_type, link_id, link_label, project_id, created_by)
    values (${INVOICE_TASK + project.code + (project.name && project.name !== project.code ? ` · ${project.name}` : '')},
      ${`New project added by ${user.name}: make its sales invoice (AR > Sales invoices > New invoice). This task closes by itself once the invoice is made.`},
      'todo', 'normal', ${who}, ${e?.id ?? null}, 'cost-center', ${project.id}, ${project.code}, ${project.id}, ${user.id}) returning id`;
  return id;
}

async function closeInvoiceTask(tx: Tx, projectId: string | null | undefined) {
  if (!projectId) return;
  await tx`update tasks set status = 'done', done_at = now(), updated_at = now()
    where link_type = 'cost-center' and link_id = ${projectId} and status <> 'done' and title like ${INVOICE_TASK + '%'}`;
}
