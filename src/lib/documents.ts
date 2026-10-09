import 'server-only';
import { sql, type Tx } from './db';
import { r2 } from './money';
import { type DocInput, type DocLine, RuleError, docLines, docTotals, paymentLines } from './ledger';
import { type Role, type User, hasRole } from './roles';
import { audit, checkLock, getSettings, nextNo, postEntry, validateLines, writeLines } from './books';
import { appUrl, sendMail } from './mail';

export type Step = { position: number; name: string; user_ids: string[] };
export const getSteps = (tx: Tx = sql) => tx<Step[]>`select position, name, user_ids from approval_steps order by position`;

/** Step names map to roles when no named approvers are set for the step. */
const stepRole = (s: Step): Role | null => {
  const n = s.name.toLowerCase();
  return n.includes('finance') ? 'finance' : n.includes('engineer') ? 'engineering' : n.includes('manage') ? 'management' : null;
};
export function canSign(u: User, s: Step | undefined) {
  if (!s) return false;
  if (u.roles.includes('management')) return true;
  if (s.user_ids.length) return s.user_ids.includes(u.id);
  const r = stepRole(s);
  return !!r && hasRole(u, r);
}
async function signerEmails(tx: Tx, s: Step) {
  const users = await tx<User[]>`select id, email, name, roles from users where active`;
  // email the step's named approvers, else everyone holding the step's role (Management can sign any step but is only emailed for its own)
  const r = stepRole(s);
  return users.filter(u => (s.user_ids.length ? s.user_ids.includes(u.id) : !!r && u.roles.includes(r))).map(u => u.email);
}

export type PRInput = {
  id?: string; date: string; due?: string | null; party: string; project?: string | null; dept?: string | null;
  costType?: string | null; ref: string; requester?: string | null;
  vatRate: number; whtRate: number; siRate: number; retRate: number; dpAmount: number; lines: DocLine[];
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
    if (!lines.length) throw new RuleError('Add at least one line with a GL code and an amount.');
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
    const doc = asDoc(no, i);
    const t = docTotals(doc);
    const jl = docLines(doc, s.account_map); // checks deductions and builds the future entry
    if (submit) { await validateLines(tx, jl, s); }
    const status = submit ? 'pending' : 'draft';
    const vals = {
      date: i.date, due_date: i.due || null, party_id: i.party, project_id: i.project || null, dept_id: i.dept || null,
      cost_type: i.costType || null, ref: i.ref, requester: i.requester || null,
      vat_rate: i.vatRate, wht_rate: i.whtRate, si_rate: i.siRate, ret_rate: i.retRate, dp_amount: i.dpAmount,
      subtotal: t.subtotal, vat: t.vat, wht: t.wht, si: t.si, retention: t.retention, total: t.total, net: t.net, status,
    };
    if (id) {
      await tx`update invoices set ${tx(vals)} where id = ${id}`;
      await tx`delete from invoice_lines where invoice_id = ${id}`;
      await tx`delete from invoice_approvals where invoice_id = ${id}`;
    } else {
      [{ id }] = await tx<{ id: string }[]>`insert into invoices ${tx({ ...vals, kind: 'purchase', no, created_by: user.id })} returning id`;
    }
    for (const [k, l] of lines.entries())
      await tx`insert into invoice_lines (invoice_id, line_no, account, description, qty, price, project_id, dept_id)
        values (${id!}, ${k + 1}, ${l.acc}, ${l.desc ?? ''}, ${l.qty}, ${l.price}, ${l.project || null}, ${l.dept || null})`;
    await audit(tx, user, 'invoice', id!, submit ? 'Submitted for approval' : input.id ? 'Edited' : 'Created');
    if (!submit) return { id: id!, notify: null };
    if (!s.require_approval && hasRole(user, 'finance')) { await postRequest(tx, user, id!, 'Posted (approval not required)'); return { id: id!, notify: null }; }
    const [first] = await getSteps(tx);
    return { id: id!, notify: first ? { step: first, emails: await signerEmails(tx, first), no, net: t.net } : null };
  });
  if (res.notify) await notifyStep(res.notify.emails, res.notify.step, res.notify.no, res.notify.net, res.id, user.name);
  return res.id;
}

async function notifyStep(emails: string[], step: Step, no: string, net: number, id: string, by: string) {
  await sendMail({
    to: emails,
    subject: `${no} is waiting for your ${step.name} approval`,
    text: `Payment request ${no} for EGP ${net.toLocaleString('en-US', { minimumFractionDigits: 2 })} is waiting for ${step.name} approval.\n` +
      `Last action by ${by}.\n\nOpen it: ${appUrl('/payment-requests/' + id)}\n\nRight Space Accounting`,
  });
}

async function loadRequest(tx: Tx, id: string) {
  const [inv] = await tx<{ id: string; no: string; status: string; date: string; party_id: string; project_id: string | null; dept_id: string | null;
    vat_rate: number; wht_rate: number; si_rate: number; ret_rate: number; dp_amount: number; net: number; created_by: string | null }[]>`
    select id, no, status, to_char(date,'YYYY-MM-DD') date, party_id, project_id, dept_id, vat_rate, wht_rate, si_rate, ret_rate, dp_amount, net, created_by
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
    if (!canSign(user, step)) throw new RuleError(`This request is waiting for ${step?.name ?? 'approval'}, and you are not an approver for that step.`);
    checkLock(s, inv.date);
    await tx`insert into invoice_approvals (invoice_id, step, step_name, user_id) values (${id}, ${step.position}, ${step.name}, ${user.id})`;
    const next = steps[n + 1];
    if (next) {
      await audit(tx, user, 'invoice', id, step.name + ' approved');
      return { next, emails: await signerEmails(tx, next), inv };
    }
    await postRequest(tx, user, id, step.name + ' approved · posted');
    const [req] = await tx<{ email: string }[]>`select email from users where id = ${inv.created_by}`;
    return { next: null, emails: req ? [req.email] : [], inv };
  });
  if (res.next) await notifyStep(res.emails, res.next, res.inv.no, res.inv.net, id, user.name);
  else await sendMail({ to: res.emails, subject: `${res.inv.no} is fully approved`, text: `Payment request ${res.inv.no} is fully approved and posted. It can now be paid.\n\n${appUrl('/payment-requests/' + id)}` });
}

export async function returnRequest(user: User, id: string, reason: string) {
  const email = await sql.begin(async tx => {
    const { inv } = await loadRequest(tx, id);
    if (inv.status !== 'pending') throw new RuleError('This request is not waiting for approval.');
    const steps = await getSteps(tx);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from invoice_approvals where invoice_id = ${id}`;
    if (!canSign(user, steps[n])) throw new RuleError('Only the approver of the current step can return it.');
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

/** Open (unpaid) balance of each posted payment request for a vendor. */
export async function openRequests(tx: Tx, party?: string) {
  return tx<{ id: string; no: string; date: string; net: number; paid: number; open: number }[]>`
    select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.net,
      coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' where a.invoice_id = i.id),0) paid,
      i.net - coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' where a.invoice_id = i.id),0) open
    from invoices i where i.kind = 'purchase' and i.status = 'posted' and (${party ?? null}::text is null or i.party_id = ${party ?? null})
    order by i.date, i.no`;
}

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
    await tx`update payments set status = 'posted', entry_id = ${eid} where id = ${id}`;
    await audit(tx, user, 'payment', id, 'Posted', `Journal entry ${jno}`);
    return id;
  });
}

/** Payment requests waiting for this user's step, and (for Finance) entries waiting for approval. */
export async function waitingForUser(user: User) {
  const [steps, prs, entries] = await Promise.all([
    getSteps(),
    sql<{ id: string; no: string; date: string; memo: string; who: string | null; amount: number; signed: number }[]>`
      select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, p.name memo, coalesce(i.requester, u.name) who, i.net amount,
        (select count(*)::int from invoice_approvals a where a.invoice_id = i.id) signed
      from invoices i join parties p on p.id = i.party_id left join users u on u.id = i.created_by
      where i.kind = 'purchase' and i.status = 'pending' order by i.date`,
    sql<{ id: string; no: string; date: string; memo: string; who: string | null; amount: number }[]>`
      select e.id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, u.name who, coalesce(sum(l.dr),0) amount
      from journal_entries e left join journal_lines l on l.entry_id = e.id left join users u on u.id = e.created_by
      where e.status = 'pending' group by e.id, u.name order by e.date`,
  ]);
  return [
    ...prs.filter(p => canSign(user, steps[p.signed])).map(p => ({ ...p, href: `/payment-requests/${p.id}`, type: `Payment request · ${steps[p.signed].name}` })),
    ...(hasRole(user, 'finance') ? entries.map(e => ({ ...e, href: `/entries/${e.id}`, type: 'Entry' })) : []),
  ];
}

