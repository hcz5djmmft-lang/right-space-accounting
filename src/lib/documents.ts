import 'server-only';
import { sql, type Tx } from './db';
import { r2 } from './money';
import { type DocInput, type DocLine, RuleError, docLines, docTotals, paymentLines } from './ledger';
import { type Role, type User, hasRole } from './roles';
import { audit, checkLock, getSettings, nextNo, postEntry, validateLines, writeLines } from './books';
import { appUrl, sendMail } from './mail';
import { leaveWaitingFor } from './leave';
import { designWaitingFor } from './design';

export type Step = { position: number; name: string; user_ids: string[] };
export const getSteps = (tx: Tx = sql) => tx<Step[]>`select position, name, user_ids from approval_steps order by position`;

/** Step 1 is signed by the head of the request's department; the people ticked in Settings sign the others. */
export const isHeadStep = (s: Step) => /head/i.test(s.name);
/** Step names map to roles when no named approvers are set for the step. */
const stepRole = (s: Step): Role | null => {
  const n = s.name.toLowerCase();
  return n.includes('finance') ? 'finance' : n.includes('engineer') ? 'engineering' : n.includes('manage') ? 'management' : null;
};
/** What a request carries about its first signer: the head fixed when it was submitted (none: Management stands in). */
export type Signable = { approver_id?: string | null };
export function canSign(u: User, s: Step | undefined, doc?: Signable) {
  if (!s) return false;
  if (isHeadStep(s)) return (!!doc?.approver_id && doc.approver_id === u.id) || u.roles.includes('management');
  if (s.user_ids.length) return s.user_ids.includes(u.id);
  const r = stepRole(s);
  return !!r && hasRole(u, r);
}
/** The name a step shows for a given request: "Engineering head" rather than "Department head". */
export const stepLabel = (s: Step, doc?: { approver_label?: string | null }) => (isHeadStep(s) && doc?.approver_label) || s.name;

async function signerEmails(tx: Tx, s: Step, doc?: Signable) {
  const users = await tx<User[]>`select id, email, name, roles from users where active`;
  if (isHeadStep(s)) {
    const head = users.find(u => u.id === doc?.approver_id);
    return head ? [head.email] : users.filter(u => u.roles.includes('management')).map(u => u.email);
  }
  // email the step's named approvers, else everyone holding the step's role
  const r = stepRole(s);
  return users.filter(u => (s.user_ids.length ? s.user_ids.includes(u.id) : !!r && u.roles.includes(r))).map(u => u.email);
}

/**
 * Who signs a request first: the head of its department; a project's request goes to the head of Engineering.
 * The header's cost center decides, else the first line that names one. No head set (or the head deactivated): Management.
 * A section (Technical Office, Site execution) with no head of its own sends its requests to its parent department's head.
 */
export async function approverFor(tx: Tx, doc: { dept?: string | null; project?: string | null; lines?: { dept?: string | null; project?: string | null }[] }) {
  const dept = doc.dept || (!doc.project && doc.lines?.find(l => l.dept)?.dept) || null;
  const project = doc.project || doc.lines?.find(l => l.project)?.project || null;
  const [d] = dept
    ? await tx<{ name: string; head: string | null }[]>`
        select case when h.id is null and ph.id is not null then p.name else d.name end name, coalesce(h.id, ph.id) head
        from departments d left join users h on h.id = d.head_user_id and h.active
        left join departments p on p.id = d.parent_id and p.active left join users ph on ph.id = p.head_user_id and ph.active where d.id = ${dept}`
    : project
      ? await tx<{ name: string; head: string | null }[]>`select d.name, (select u.id from users u where u.id = d.head_user_id and u.active) head from departments d where d.code = 'ENG' and d.active`
      : [];
  return d ? { id: d.head, label: `${d.name} head` } : { id: null, label: 'Department head' };
}

export type PRInput = {
  id?: string; date: string; due?: string | null; party: string; project?: string | null; dept?: string | null;
  costType?: string | null; ref: string; requester?: string | null;
  vatRate: number; whtRate: number; siRate: number; retRate: number; dpAmount: number; lines: DocLine[];
  /** vendor invoices (received against POs) this request pays, instead of lines of its own */
  bills?: string[];
};

const asDoc = (no: string, i: PRInput): DocInput => ({
  kind: 'purchase', no, party: i.party, project: i.project, dept: i.dept,
  vatRate: i.vatRate, whtRate: i.whtRate, siRate: i.siRate, retRate: i.retRate, dpAmount: i.dpAmount, lines: i.lines,
});

/** Saves a payment request as a draft, or submits it into the approval chain. */
export async function savePaymentRequest(user: User, input: PRInput, submit: boolean) {
  const res = await sql.begin(async tx => {
    const s = await getSettings(tx);
    if (!input.party) throw new RuleError('Choose the vendor.');
    const lines = input.lines.filter(l => l.acc && r2(l.qty * l.price) !== 0);
    const billIds = [...new Set(input.bills ?? [])];
    if (billIds.length && lines.length) throw new RuleError("A request either pays the vendor's invoices or has lines of its own, not both.");
    if (!lines.length && !billIds.length) throw new RuleError('Add at least one line with a GL code and an amount.');
    const i = { ...input, lines };
    let id = i.id, no: string;
    if (id) {
      const [old] = await tx<{ status: string; no: string; created_by: string }[]>`select status, no, created_by from invoices where id = ${id} and kind = 'purchase' for update`;
      if (!old) throw new RuleError('Payment request not found.');
      if (!['draft', 'rejected'].includes(old.status)) throw new RuleError('Only drafts and returned requests can be edited.');
      if (old.created_by !== user.id && !hasRole(user, 'finance')) throw new RuleError('Only the person who raised it, or Finance, can edit it.');
      no = old.no;
    } else {
      no = await nextNo(tx, s.pr_prefix, 6);
    }
    // a request that pays vendor invoices: each one this vendor's, unpaid and not on another request; it pays what is open
    const bills = billIds.length ? await requestableBills(tx, i.party, billIds, id) : [];
    const doc = asDoc(no, i);
    const t = bills.length ? billTotals(bills) : docTotals(doc);
    if (!bills.length) {
      const jl = docLines(doc, s.account_map); // checks deductions and builds the future entry
      if (submit) { await validateLines(tx, jl, s); }
    }
    const status = submit ? 'pending' : 'draft';
    const signLines = bills.length ? bills.map(b => ({ project: b.project_id, dept: b.dept_id })) : lines;
    const approver = submit ? await approverFor(tx, { dept: i.dept, project: i.project, lines: signLines }) : { id: null, label: null };
    const vals = {
      date: i.date, due_date: i.due || null, party_id: i.party, project_id: i.project || null, dept_id: i.dept || null,
      cost_type: i.costType || null, ref: i.ref, requester: i.requester || null, approver_id: approver.id, approver_label: approver.label,
      vat_rate: i.vatRate, wht_rate: i.whtRate, si_rate: i.siRate, ret_rate: i.retRate, dp_amount: i.dpAmount,
      subtotal: t.subtotal, vat: t.vat, wht: t.wht, si: t.si, retention: t.retention, total: t.total, net: t.net, status,
    };
    if (id) {
      await tx`update invoices set ${tx(vals)} where id = ${id}`;
      await tx`delete from invoice_lines where invoice_id = ${id}`;
      await tx`delete from invoice_approvals where invoice_id = ${id}`;
      await tx`delete from payment_request_bills where request_id = ${id}`;
    } else {
      [{ id }] = await tx<{ id: string }[]>`insert into invoices ${tx({ ...vals, kind: 'purchase', no, created_by: user.id })} returning id`;
    }
    for (const [k, l] of lines.entries())
      await tx`insert into invoice_lines (invoice_id, line_no, account, description, qty, price, project_id, dept_id)
        values (${id!}, ${k + 1}, ${l.acc}, ${l.desc ?? ''}, ${l.qty}, ${l.price}, ${l.project || null}, ${l.dept || null})`;
    for (const b of bills) await tx`insert into payment_request_bills (request_id, bill_id, amount) values (${id!}, ${b.id}, ${b.open})`;
    await audit(tx, user, 'invoice', id!, submit ? 'Submitted for approval' : input.id ? 'Edited' : 'Created');
    if (!submit) return { id: id!, notify: null, approver_label: null };
    if (!s.require_approval && hasRole(user, 'finance')) { await postRequest(tx, user, id!, 'Posted (approval not required)'); return { id: id!, notify: null, approver_label: null }; }
    const [first] = await getSteps(tx);
    return { id: id!, approver_label: approver.label, notify: first ? { step: first, emails: await signerEmails(tx, first, { approver_id: approver.id }), no, net: t.net } : null };
  });
  if (res.notify) await notifyStep(res.notify.emails, stepLabel(res.notify.step, { approver_label: res.approver_label }), res.notify.no, res.notify.net, res.id, user.name);
  return res.id;
}

async function notifyStep(emails: string[], step: string, no: string, net: number, id: string, by: string) {
  await sendMail({
    to: emails,
    subject: `${no} is waiting for your ${step} approval`,
    text: `Payment request ${no} for EGP ${net.toLocaleString('en-US', { minimumFractionDigits: 2 })} is waiting for ${step} approval.\n` +
      `Last action by ${by}.\n\nOpen it: ${appUrl('/payment-requests/' + id)}\n\nRight Space`,
  });
}

async function loadRequest(tx: Tx, id: string) {
  const [inv] = await tx<{ id: string; no: string; status: string; date: string; party_id: string; project_id: string | null; dept_id: string | null;
    vat_rate: number; wht_rate: number; si_rate: number; ret_rate: number; dp_amount: number; net: number; created_by: string | null;
    approver_id: string | null; approver_label: string | null }[]>`
    select id, no, status, to_char(date,'YYYY-MM-DD') date, party_id, project_id, dept_id, vat_rate, wht_rate, si_rate, ret_rate, dp_amount, net, created_by,
      approver_id, approver_label
    from invoices where id = ${id} and kind = 'purchase' for update`;
  if (!inv) throw new RuleError('Payment request not found.');
  const lines = await tx<{ account: string; description: string; qty: number; price: number; project_id: string | null; dept_id: string | null }[]>`
    select account, description, qty, price, project_id, dept_id from invoice_lines where invoice_id = ${id} order by line_no`;
  return { inv, lines };
}

/** Creates and posts the journal entry for a fully approved request. */
async function postRequest(tx: Tx, user: User, id: string, note: string) {
  const s = await getSettings(tx);
  const { inv, lines } = await loadRequest(tx, id);
  checkLock(s, inv.date);
  const [paysBills] = await tx`select 1 from payment_request_bills where request_id = ${id} limit 1`;
  if (paysBills) {
    // the vendor invoices are already in the books: approval only releases them for payment
    await tx`update invoices set status = 'posted' where id = ${id}`;
    await audit(tx, user, 'invoice', id, note, 'Vendor invoices released for payment');
    return;
  }
  const doc: DocInput = {
    kind: 'purchase', no: inv.no, party: inv.party_id, project: inv.project_id, dept: inv.dept_id,
    vatRate: inv.vat_rate, whtRate: inv.wht_rate, siRate: inv.si_rate, retRate: inv.ret_rate, dpAmount: inv.dp_amount,
    lines: lines.map(l => ({ acc: l.account, desc: l.description, qty: l.qty, price: l.price, project: l.project_id, dept: l.dept_id })),
  };
  const jl = docLines(doc, s.account_map);
  await validateLines(tx, jl, s);
  const [party] = await tx<{ name: string }[]>`select name from parties where id = ${inv.party_id}`;
  const jno = await nextNo(tx, 'JE-');
  const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
    values (${jno}, ${inv.date}, ${inv.no + ' · ' + (party?.name ?? '')}, ${inv.no}, 'payment_request', 'draft', 'invoice', ${id}, ${user.id}) returning id`;
  await writeLines(tx, eid, jl);
  await postEntry(tx, user, eid, 'Posted from ' + inv.no);
  await tx`update invoices set status = 'posted', entry_id = ${eid} where id = ${id}`;
  await audit(tx, user, 'invoice', id, note, `Journal entry ${jno}`);
}

export async function approveRequest(user: User, id: string) {
  const res = await sql.begin(async tx => {
    const s = await getSettings(tx);
    const { inv } = await loadRequest(tx, id);
    if (inv.status !== 'pending') throw new RuleError('This request is not waiting for approval.');
    const steps = await getSteps(tx);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from invoice_approvals where invoice_id = ${id}`;
    const step = steps[n];
    if (!canSign(user, step, inv)) throw new RuleError(`This request is waiting for ${step ? stepLabel(step, inv) : 'approval'}, and you are not an approver for that step.`);
    checkLock(s, inv.date);
    const label = stepLabel(step, inv);
    await tx`insert into invoice_approvals (invoice_id, step, step_name, user_id) values (${id}, ${step.position}, ${label}, ${user.id})`;
    const next = steps[n + 1];
    if (next) {
      await audit(tx, user, 'invoice', id, label + ' approved');
      return { next, emails: await signerEmails(tx, next, inv), inv };
    }
    await postRequest(tx, user, id, label + ' approved · posted');
    const [req] = await tx<{ email: string }[]>`select email from users where id = ${inv.created_by}`;
    return { next: null, emails: req ? [req.email] : [], inv };
  });
  if (res.next) await notifyStep(res.emails, stepLabel(res.next, res.inv), res.inv.no, res.inv.net, id, user.name);
  else await sendMail({ to: res.emails, subject: `${res.inv.no} is fully approved`, text: `Payment request ${res.inv.no} is fully approved and posted. It can now be paid.\n\n${appUrl('/payment-requests/' + id)}` });
}

export async function returnRequest(user: User, id: string, reason: string) {
  const email = await sql.begin(async tx => {
    const { inv } = await loadRequest(tx, id);
    if (inv.status !== 'pending') throw new RuleError('This request is not waiting for approval.');
    const steps = await getSteps(tx);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from invoice_approvals where invoice_id = ${id}`;
    if (!canSign(user, steps[n], inv)) throw new RuleError('Only the approver of the current step can return it.');
    await tx`update invoices set status = 'rejected' where id = ${id}`;
    await audit(tx, user, 'invoice', id, 'Returned for changes', reason);
    const [req] = await tx<{ email: string }[]>`select email from users where id = ${inv.created_by}`;
    return { to: req?.email, no: inv.no };
  });
  if (email.to) await sendMail({ to: [email.to], subject: `${email.no} was returned for changes`, text: `${user.name} returned payment request ${email.no}.\nReason: ${reason || 'none given'}\n\n${appUrl('/payment-requests/' + id)}` });
}

export async function deleteRequest(user: User, id: string) {
  await sql.begin(async tx => {
    const { inv } = await loadRequest(tx, id);
    if (!['draft', 'rejected'].includes(inv.status)) throw new RuleError('Only drafts and returned requests can be deleted.');
    if (inv.created_by !== user.id && !hasRole(user, 'finance')) throw new RuleError('Only the person who raised it, or Finance, can delete it.');
    await tx`delete from invoices where id = ${id}`;
    await audit(tx, user, 'invoice', id, 'Deleted ' + inv.no);
  });
}

/**
 * What can be paid to a vendor: each approved payment request with lines of its own, and each vendor invoice (received
 * against a PO) that an approved payment request releases. `via` names that request.
 */
export async function openRequests(tx: Tx, party?: string) {
  return tx<{ id: string; no: string; date: string; net: number; paid: number; open: number; via: string | null; via_id: string | null }[]>`
    select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.net, invoice_paid(i.id) paid, i.net - invoice_paid(i.id) open, q.no via, q.id via_id
    from invoices i
    left join lateral (select r.id, r.no from payment_request_bills b join invoices r on r.id = b.request_id and r.status = 'posted' where b.bill_id = i.id limit 1) q on true
    where i.kind = 'purchase' and i.status = 'posted' and (${party ?? null}::text is null or i.party_id = ${party ?? null})
      and not exists (select 1 from payment_request_bills b where b.request_id = i.id)
      and (i.po_id is null or q.id is not null)
    order by i.date, i.no`;
}

type RequestableBill = { id: string; no: string; open: number; project_id: string | null; dept_id: string | null };
/** Checks the vendor invoices a payment request is to pay and returns what is open on each. */
async function requestableBills(tx: Tx, party: string, ids: string[], requestId?: string) {
  const rows = await tx<(RequestableBill & { party_id: string; status: string; po_id: string | null; other: string | null })[]>`
    select i.id, i.no, i.party_id, i.status, i.po_id, i.project_id, i.dept_id, i.net - invoice_paid(i.id) open,
      (select q.no from payment_request_bills b join invoices q on q.id = b.request_id and q.status in ('draft', 'pending', 'posted')
        where b.bill_id = i.id and q.id <> ${requestId ?? ''} limit 1) other
    from invoices i where i.id = any(${ids})`;
  if (rows.length !== ids.length) throw new RuleError('A selected invoice no longer exists.');
  for (const b of rows) {
    if (b.party_id !== party || !b.po_id || b.status !== 'posted') throw new RuleError(`${b.no} is not an invoice of this vendor received in the books.`);
    if (b.open <= 0.004) throw new RuleError(`${b.no} is already paid.`);
    if (b.other) throw new RuleError(`${b.no} is already on payment request ${b.other}.`);
  }
  return rows.map(b => ({ id: b.id, no: b.no, open: r2(b.open), project_id: b.project_id, dept_id: b.dept_id }));
}
const billTotals = (bills: { open: number }[]) => {
  const total = r2(bills.reduce((t, b) => t + b.open, 0));
  return { subtotal: total, vat: 0, wht: 0, si: 0, retention: 0, total, net: total, dp: 0 };
};

/** The vendor invoices a payment request pays. */
export const requestBills = (id: string) => sql<{ id: string; no: string; date: string; ref: string; po_no: string | null; po_id: string | null; amount: number; paid: number }[]>`
  select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.ref, r.po_no, r.id po_id, b.amount, invoice_paid(i.id) paid
  from payment_request_bills b join invoices i on i.id = b.bill_id left join purchase_requests r on r.id = i.po_id
  where b.request_id = ${id} order by i.date, i.no`;

export type PaymentInputForm = { date: string; party: string; bank: string; amount: number; memo: string; ref: string; alloc: { invoice: string; amount: number }[] };

/** Records and posts a vendor payment (Finance). Allocations clear requests; any remainder is a down payment. */
export async function postVendorPayment(user: User, p: PaymentInputForm) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can record payments.');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    checkLock(s, p.date);
    if (!p.party) throw new RuleError('Choose the vendor.');
    const alloc = p.alloc.filter(a => r2(a.amount) > 0);
    const open = new Map((await openRequests(tx, p.party)).map(r => [r.id, r]));
    for (const a of alloc) {
      const r = open.get(a.invoice);
      if (!r) throw new RuleError('A selected request is not open for this vendor.');
      if (a.amount > r.open + 0.004) throw new RuleError(`${r.no}: allocation is more than its open balance (${r.open.toFixed(2)}).`);
    }
    const allocated = r2(alloc.reduce((t, a) => t + a.amount, 0));
    const no = await nextNo(tx, 'PAY-');
    const jl = paymentLines({ kind: 'payment', no, party: p.party, bank: p.bank, amount: p.amount, wht: 0, allocated }, s.account_map);
    await validateLines(tx, jl, s);
    const [party] = await tx<{ name: string }[]>`select name from parties where id = ${p.party}`;
    const [{ id }] = await tx<{ id: string }[]>`insert into payments (kind, no, date, party_id, bank, amount, memo, ref, status, created_by)
      values ('payment', ${no}, ${p.date}, ${p.party}, ${p.bank}, ${r2(p.amount)}, ${p.memo}, ${p.ref}, 'draft', ${user.id}) returning id`;
    for (const a of alloc) await tx`insert into payment_allocations (payment_id, invoice_id, amount) values (${id}, ${a.invoice}, ${r2(a.amount)})`;
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${p.date}, ${no + ' · ' + (party?.name ?? '')}, ${p.ref || no}, 'payment', 'draft', 'payment', ${id}, ${user.id}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Posted from ' + no);
    const [{ payment_ref }] = await tx<{ payment_ref: string | null }[]>`select payment_ref from journal_entries where id = ${eid}`;
    await tx`update payments set status = 'posted', entry_id = ${eid}, reference = ${payment_ref} where id = ${id}`;
    await audit(tx, user, 'payment', id, 'Posted', `Journal entry ${jno}${payment_ref ? ' · ref ' + payment_ref : ''}`);
    return id;
  });
}

/** Payment requests waiting for this user's step, and (for Finance) entries waiting for approval. */
export async function waitingForUser(user: User) {
  const [steps, prs, entries] = await Promise.all([
    getSteps(),
    sql<{ id: string; no: string; date: string; memo: string; who: string | null; amount: number; signed: number; approver_id: string | null; approver_label: string | null }[]>`
      select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, p.name memo, coalesce(i.requester, u.name) who, i.net amount,
        (select count(*)::int from invoice_approvals a where a.invoice_id = i.id) signed, i.approver_id, i.approver_label
      from invoices i join parties p on p.id = i.party_id left join users u on u.id = i.created_by
      where i.kind = 'purchase' and i.status = 'pending' order by i.date`,
    sql<{ id: string; no: string; date: string; memo: string; who: string | null; amount: number }[]>`
      select e.id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, u.name who, coalesce(sum(l.dr),0) amount
      from journal_entries e left join journal_lines l on l.entry_id = e.id left join users u on u.id = e.created_by
      where e.status = 'pending' group by e.id, u.name order by e.date`,
  ]);
  // purchase requests: with Procurement for pricing, then the department head, then Management
  const [purchases, [proc]] = await Promise.all([
    sql<{ id: string; no: string; date: string; memo: string; who: string | null; amount: number; status: string; approver_id: string | null; approver_label: string | null }[]>`
      select r.id, r.no, to_char(r.date,'YYYY-MM-DD') date, coalesce(v.name, coalesce(p.code, d.name)) memo, u.name who, r.status, r.approver_id, r.approver_label,
        coalesce((select sum(round(l.qty * l.price, 2)) from purchase_request_lines l where l.request_id = r.id), 0) amount
      from purchase_requests r left join parties v on v.id = r.vendor_id left join projects p on p.id = r.project_id left join departments d on d.id = r.dept_id
      left join users u on u.id = r.created_by where r.status in ('procurement', 'head', 'management') order by r.date`,
    sql<{ ok: boolean }[]>`select true ok from departments where code = 'PUR' and (head_user_id = ${user.id} or id = ${user.dept_id ?? ''})`,
  ]);
  const { claimsWaitingFor } = await import('./claims');
  const { topupsWaitingFor } = await import('./petty');
  const { tasksToReview } = await import('./tasks');
  const { pettyWaitingFor } = await import('./petty-docs');
  const { salesWaitingFor, SALES_STEP_LABEL } = await import('./sales');
  const [leave, design, claims, topups, reviews, petty, sales] = await Promise.all([leaveWaitingFor(user), designWaitingFor(user), claimsWaitingFor(user), topupsWaitingFor(user), tasksToReview(user), pettyWaitingFor(user), salesWaitingFor(user)]);
  const procurement = hasRole(user, 'management') || !!proc;
  const mine = purchases.filter(r => r.status === 'procurement' ? procurement : r.status === 'head' ? canSign(user, steps[0], r) : canSign(user, steps[steps.length - 1]));
  // `act` (update 20): the row can be approved from the list with its Approve button; rows without one need their page
  // (Procurement prices a request, a top-up names its bank, a claim becomes a payment request).
  const rows: WaitingRow[] = [
    ...prs.filter(p => canSign(user, steps[p.signed], p)).map(p => ({ ...p, href: `/payment-requests/${p.id}`, type: `Payment request · ${stepLabel(steps[p.signed], p)}`, act: `pr:${p.id}` })),
    ...mine.map(r => ({ ...r, href: `/purchasing/${r.id}`, type: `Purchase request · ${r.status === 'procurement' ? 'Procurement pricing' : r.status === 'head' ? r.approver_label ?? 'Department head' : 'Management'}`, act: r.status === 'procurement' ? undefined : `purchase:${r.id}` })),
    ...(hasRole(user, 'finance') ? entries.map(e => ({ ...e, href: `/entries/${e.id}`, type: 'Entry', act: `entry:${e.id}` })) : []),
    ...petty.map(d => ({ id: d.id, no: d.no, date: d.date, memo: `${d.paid_to_name} · ${d.purpose} · ${d.cc ?? ''}`, who: d.who, amount: d.total, href: `/petty-cash/${d.id}`, type: `Petty cash · ${d.status === 'head' ? d.approver_label ?? 'Department head' : 'Management'}`, act: `petty:${d.id}` })),
    ...sales.map(i => ({ id: i.id, no: i.no, date: i.date, memo: i.customer, who: null, amount: i.total, href: `/sales-invoices/${i.id}`, type: `Sales invoice · ${SALES_STEP_LABEL[i.sales_step]}`, act: `sales:${i.id}` })),
    ...leave.map(l => ({ id: l.id, no: l.name, date: l.from_date, memo: `${l.type_label} ${l.from_date} to ${l.to_date} (${l.days} days)${l.reason ? ` · ${l.reason}` : ''}`, who: l.name, amount: 0, href: `/leave/${l.id}`, type: `Leave · ${l.status === 'head' ? 'Department head' : 'HR'}`, act: `leave:${l.id}` })),
    ...design.map(s => ({ id: s.id, no: s.project_code, date: s.submitted_at?.slice(0, 10) ?? '', memo: `${s.kind_label} v${s.version} · ${s.drawings} drawings`, who: s.designer, amount: 0, href: `/design/${s.id}`, type: `Drawing set · ${s.status_label.replace('With the ', '')}`, act: `design:${s.id}` })),
    ...topups.map(t => ({ id: t.id, no: t.no, date: t.at.slice(0, 10), memo: `${t.box}${t.note ? ` · ${t.note}` : ''}`, who: t.who, amount: t.amount, href: '/petty-cash', type: 'Petty cash top-up' })),
    ...reviews.map(t => ({ id: t.id, no: t.project_code ?? 'Task', date: t.submitted_at?.slice(0, 10) ?? '', memo: `${t.title}${t.submit_note ? ` · ${t.submit_note}` : ''}`, who: t.assignee, amount: 0, href: `/tasks/${t.id}`, type: 'Task · review', act: `task:${t.id}` })),
    ...claims.map(c => ({ id: c.id, no: c.no, date: c.date, memo: `${c.vendor} · ${c.code} · claim ${c.claim_no}${c.trade ? ` · ${c.trade}` : ''}`, who: c.certified_by_name, amount: c.gross, href: `/claims/${c.id}`, type: `Progress claim · ${c.status === 'pricing' ? 'Procurement pricing' : 'Finance payment request'}` })),
  ];
  return rows;
}
export type WaitingRow = { id: string; no: string; date: string; memo: string; who: string | null; amount: number; href: string; type: string; act?: string };

