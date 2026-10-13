import 'server-only';
import { sql, type Tx } from './db';
import { r2 } from './money';
import { type DocInput, RuleError, docLines, docTotals, lineAmount } from './ledger';
import { type User, hasRole } from './roles';
import { audit, checkLock, getSettings, nextNo, postEntry, reverseEntry, validateLines, writeLines } from './books';
import { approverFor, canSign, getSteps } from './documents';
import { today } from './dates';

// Purchasing: the material list, purchase requests (PRQ) that become purchase orders (PO), and the vendor's invoice
// received against a PO (VI), which posts straight to the items' GL codes and the vendor's account.
// Flow: anyone raises a request for a project or a department → Procurement prices it and picks the vendor → the
// department head approves (a project's: the head of Engineering) → Management gives the final approval → PO.

export type Material = { id: string; code: string; name: string; name_ar: string | null; unit: string; account_base: string; account_name: string | null; last_price: number | null; active: boolean };
export const listMaterials = (all = false) => sql<Material[]>`
  select m.id, m.code, m.name, m.name_ar, m.unit, m.account_base,
    coalesce(a.name, (select c.name from accounts c where c.code like m.account_base || '-%' order by c.code limit 1)) account_name, m.last_price, m.active
  from materials m left join accounts a on a.code = m.account_base
  where ${all} or m.active order by m.code`;

/** Procurement: members and the head of the Purchasing department; Management may stand in. */
export async function isProcurement(user: User, tx: Tx = sql) {
  if (hasRole(user, 'management')) return true;
  const [d] = await tx<{ ok: boolean }[]>`select true ok from departments where code = 'PUR' and (head_user_id = ${user.id} or id = ${user.dept_id ?? ''})`;
  return !!d;
}
const mayKeepMaterials = async (user: User) => hasRole(user, 'finance') || (await isProcurement(user));

export type MaterialInput = { id?: string; name: string; name_ar?: string; unit: string; account_base: string; active?: boolean };
/** Adds or changes a material (Procurement or Finance). The GL code is the base code, without a project suffix. */
export async function saveMaterial(user: User, m: MaterialInput) {
  if (!(await mayKeepMaterials(user))) throw new RuleError('Only Procurement or Finance can change the material list.');
  if (!m.name.trim()) throw new RuleError('Enter the material name.');
  const base = m.account_base.trim().replace(/-\d+$/, '');
  const [acc] = await sql<{ code: string }[]>`select code from accounts where (code = ${base} or code ~ ${'^' + base + '-[0-9]+$'}) and postable and type = 'expense' limit 1`;
  if (!acc) throw new RuleError(`GL code ${base} is not an expense code in the chart of accounts.`);
  return sql.begin(async tx => {
    const vals = { name: m.name.trim(), name_ar: m.name_ar?.trim() || null, unit: m.unit.trim() || 'pc', account_base: base, active: m.active ?? true };
    if (m.id) {
      const r = await tx`update materials set ${tx(vals)} where id = ${m.id}`;
      if (!r.count) throw new RuleError('Material not found.');
      await audit(tx, user, 'material', m.id, 'Edited', vals.name);
      return m.id;
    }
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(substring(code from '^MAT-(\\d+)$')::int), 0) + 1 n from materials`;
    const [{ id }] = await tx<{ id: string }[]>`insert into materials ${tx({ ...vals, code: 'MAT-' + String(n).padStart(3, '0') })} returning id`;
    await audit(tx, user, 'material', id, 'Added', vals.name);
    return id;
  });
}

/** The GL code a material posts to for a cost center: the project's copy of its code, or the Office code for a department. */
export async function materialAccount(tx: Tx, base: string, cc: { project?: string | null; dept?: string | null }) {
  let code = base;
  if (cc.project) {
    const [p] = await tx<{ gl_suffix: number | null; is_office: boolean; code: string }[]>`select gl_suffix, is_office, code from projects where id = ${cc.project}`;
    if (!p) throw new RuleError('Project not found.');
    if (!p.is_office) code = `${base}-${p.gl_suffix}`;
  }
  const [a] = await tx<{ code: string }[]>`select code from accounts where code = ${code} and postable`;
  return a?.code ?? null;
}

export type PRQLineInput = { material: string; qty: number; description?: string };
export type PRQInput = { id?: string; date: string; neededBy?: string | null; project?: string | null; dept?: string | null; notes?: string; lines: PRQLineInput[] };

type Head = { id: string; no: string; status: string; date: string; project_id: string | null; dept_id: string | null; vendor_id: string | null; vat_rate: number;
  approver_id: string | null; approver_label: string | null; po_no: string | null; closed: boolean; created_by: string | null };
async function loadHead(tx: Tx, id: string) {
  const [h] = await tx<Head[]>`select id, no, status, to_char(date,'YYYY-MM-DD') date, project_id, dept_id, vendor_id, vat_rate, approver_id, approver_label, po_no, closed, created_by
    from purchase_requests where id = ${id} for update`;
  if (!h) throw new RuleError('Purchase request not found.');
  return h;
}

/** Saves a purchase request as a draft, or submits it to Procurement (anyone). */
export async function savePurchaseRequest(user: User, input: PRQInput, submit: boolean) {
  return sql.begin(async tx => {
    const project = input.project || null, dept = project ? null : input.dept || null;
    if (!project && !dept) throw new RuleError('Choose the project or department the request is for.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new RuleError('Pick the date.');
    const lines = input.lines.filter(l => l.material && Number(l.qty) > 0);
    if (!lines.length) throw new RuleError('Add at least one material with a quantity.');
    const mats = new Map((await tx<{ id: string; name: string; unit: string; account_base: string; last_price: number | null }[]>`
      select id, name, unit, account_base, last_price from materials where id = any(${lines.map(l => l.material)})`).map(m => [m.id, m]));
    const resolved = [];
    for (const l of lines) {
      const m = mats.get(l.material);
      if (!m) throw new RuleError('A material on the request is not in the material list.');
      const account = await materialAccount(tx, m.account_base, { project, dept });
      if (!account) throw new RuleError(`${m.name} has no GL code for this ${project ? 'project' : 'department'} (code ${m.account_base}). Pick another material or ask Finance.`);
      resolved.push({ ...l, unit: m.unit, account, price: m.last_price ?? 0 });
    }
    let id = input.id;
    const status = submit ? 'procurement' : 'draft';
    const vals = { date: input.date, needed_by: input.neededBy || null, project_id: project, dept_id: dept, notes: (input.notes ?? '').trim(), status };
    if (id) {
      const h = await loadHead(tx, id);
      if (!['draft', 'rejected'].includes(h.status)) throw new RuleError('Only drafts and returned requests can be edited.');
      if (h.created_by !== user.id && !(await isProcurement(user, tx))) throw new RuleError('Only the person who raised it, or Procurement, can edit it.');
      await tx`update purchase_requests set ${tx(vals)} where id = ${id}`;
      await tx`delete from purchase_request_lines where request_id = ${id}`;
      await tx`delete from purchase_request_approvals where request_id = ${id}`;
    } else {
      const no = await nextNo(tx, 'PRQ-');
      [{ id }] = await tx<{ id: string }[]>`insert into purchase_requests ${tx({ ...vals, no, created_by: user.id })} returning id`;
    }
    for (const [k, l] of resolved.entries())
      await tx`insert into purchase_request_lines (request_id, line_no, material_id, description, unit, qty, price, account)
        values (${id!}, ${k + 1}, ${l.material}, ${(l.description ?? '').trim()}, ${l.unit}, ${l.qty}, ${l.price}, ${l.account})`;
    await audit(tx, user, 'purchase', id!, submit ? 'Submitted to Procurement' : input.id ? 'Edited' : 'Created');
    return id!;
  });
}

/** Procurement prices the lines and picks the vendor; `send` passes it on to the department head. */
export async function pricePurchaseRequest(user: User, id: string, p: { vendor: string; vatRate: number; prices: Record<string, number>; send: boolean }) {
  return sql.begin(async tx => {
    if (!(await isProcurement(user, tx))) throw new RuleError('Only Procurement can price a purchase request.');
    const h = await loadHead(tx, id);
    if (h.status !== 'procurement') throw new RuleError('This request is not with Procurement.');
    const lines = await tx<{ id: string }[]>`select id::text id from purchase_request_lines where request_id = ${id}`;
    for (const l of lines) {
      const price = r2(p.prices[l.id]);
      if (price < 0) throw new RuleError('Prices cannot be negative.');
      await tx`update purchase_request_lines set price = ${price} where id = ${l.id}`;
    }
    await tx`update purchase_requests set vendor_id = ${p.vendor || null}, vat_rate = ${p.vatRate || 0}, buyer_id = coalesce(buyer_id, ${user.id}) where id = ${id}`;
    if (!p.send) { await audit(tx, user, 'purchase', id, 'Prices saved'); return; }
    if (!p.vendor) throw new RuleError('Choose the vendor before sending it on.');
    const [v] = await tx`select 1 from parties where id = ${p.vendor} and type = 'vendor'`;
    if (!v) throw new RuleError('Choose a vendor from the vendor list.');
    const [zero] = await tx`select 1 from purchase_request_lines where request_id = ${id} and price <= 0`;
    if (zero) throw new RuleError('Price every line before sending it on.');
    const approver = await approverFor(tx, { dept: h.dept_id, project: h.project_id });
    await tx`update purchase_requests set status = 'head', approver_id = ${approver.id}, approver_label = ${approver.label} where id = ${id}`;
    await tx`insert into purchase_request_approvals (request_id, step, step_name, user_id) values (${id}, 'procurement', 'Procurement', ${user.id})`;
    await audit(tx, user, 'purchase', id, 'Priced and sent to ' + approver.label);
  });
}

/** Who may act on a request now. */
export async function canActOn(user: User, h: Pick<Head, 'status' | 'approver_id'>, tx: Tx = sql) {
  if (h.status === 'procurement') return isProcurement(user, tx);
  const steps = await getSteps(tx);
  if (h.status === 'head') return canSign(user, steps[0], h);
  if (h.status === 'management') return canSign(user, steps[steps.length - 1]);
  return false;
}

/** The department head's approval, then Management's; Management's makes it a purchase order. */
export async function approvePurchaseRequest(user: User, id: string) {
  return sql.begin(async tx => {
    const h = await loadHead(tx, id);
    if (!['head', 'management'].includes(h.status)) throw new RuleError('This request is not waiting for approval.');
    if (!(await canActOn(user, h, tx))) throw new RuleError(`This request is waiting for ${h.status === 'head' ? h.approver_label ?? 'the department head' : 'Management'}, and you are not that approver.`);
    if (h.status === 'head') {
      await tx`insert into purchase_request_approvals (request_id, step, step_name, user_id) values (${id}, 'head', ${h.approver_label ?? 'Department head'}, ${user.id})`;
      await tx`update purchase_requests set status = 'management' where id = ${id}`;
      await audit(tx, user, 'purchase', id, (h.approver_label ?? 'Department head') + ' approved');
      return null;
    }
    const po = await nextNo(tx, 'PO-');
    await tx`insert into purchase_request_approvals (request_id, step, step_name, user_id) values (${id}, 'management', 'Management', ${user.id})`;
    await tx`update purchase_requests set status = 'approved', po_no = ${po}, po_date = ${today()}, delivery_date = coalesce(delivery_date, needed_by) where id = ${id}`;
    await audit(tx, user, 'purchase', id, 'Management approved', 'Purchase order ' + po);
    return po;
  });
}

/** Back to the requester for changes (Procurement, or the approver of the current step). */
export async function returnPurchaseRequest(user: User, id: string, reason: string) {
  await sql.begin(async tx => {
    const h = await loadHead(tx, id);
    if (!['procurement', 'head', 'management'].includes(h.status)) throw new RuleError('This request is not waiting for anyone.');
    if (!(await canActOn(user, h, tx))) throw new RuleError('Only the person the request is waiting for can return it.');
    await tx`update purchase_requests set status = 'rejected' where id = ${id}`;
    await audit(tx, user, 'purchase', id, 'Returned for changes', reason);
  });
}

/** Cancels a request (the requester or Procurement), or a PO nothing was received on (Procurement or Finance). */
export async function cancelPurchaseRequest(user: User, id: string) {
  await sql.begin(async tx => {
    const h = await loadHead(tx, id);
    const proc = await isProcurement(user, tx);
    if (h.status === 'cancelled') return;
    if (h.status === 'approved') {
      if (!proc && !hasRole(user, 'finance')) throw new RuleError('Only Procurement or Finance can cancel a purchase order.');
      const [b] = await tx`select 1 from invoices where po_id = ${id} and status = 'posted'`;
      if (b) throw new RuleError('Invoices were received on this PO; close it instead.');
    } else if (h.created_by !== user.id && !proc) throw new RuleError('Only the person who raised it, or Procurement, can cancel it.');
    await tx`update purchase_requests set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'purchase', id, 'Cancelled');
  });
}

/** Marks a PO closed: nothing more will be received on it (Procurement or Finance). */
export async function closePurchaseOrder(user: User, id: string, closed = true) {
  await sql.begin(async tx => {
    if (!hasRole(user, 'finance') && !(await isProcurement(user, tx))) throw new RuleError('Only Procurement or Finance can close a purchase order.');
    const h = await loadHead(tx, id);
    if (h.status !== 'approved') throw new RuleError('Only a purchase order can be closed.');
    await tx`update purchase_requests set closed = ${closed} where id = ${id}`;
    await audit(tx, user, 'purchase', id, closed ? 'PO closed' : 'PO reopened');
  });
}

export type PurchaseRow = {
  id: string; no: string; date: string; needed_by: string | null; status: string; project_id: string | null; dept_id: string | null; cc: string | null;
  notes: string; vendor_id: string | null; vendor: string | null; vendor_full: string | null; vat_rate: number; approver_id: string | null; approver_label: string | null; approver_name: string | null;
  po_no: string | null; po_date: string | null; closed: boolean; created_by: string | null; created_by_name: string | null;
  subtotal: number; received: number; buyer_id: string | null; buyer: string | null; delivery_date: string | null; delivered: number; quotes: number;
};
const rowSelect = sql`
  select r.id, r.no, to_char(r.date,'YYYY-MM-DD') date, to_char(r.needed_by,'YYYY-MM-DD') needed_by, r.status, r.project_id, r.dept_id,
    coalesce(p.code, d.name) cc, r.notes, r.vendor_id, v.name vendor, v.full_name vendor_full, r.vat_rate, r.approver_id, r.approver_label, ap.name approver_name,
    r.po_no, to_char(r.po_date,'YYYY-MM-DD') po_date, r.closed, r.created_by, u.name created_by_name,
    coalesce((select sum(round(l.qty * l.price, 2)) from purchase_request_lines l where l.request_id = r.id), 0) subtotal,
    coalesce((select sum(i.subtotal) from invoices i where i.po_id = r.id and i.status = 'posted'), 0) received,
    r.buyer_id, b.name buyer, to_char(r.delivery_date,'YYYY-MM-DD') delivery_date,
    coalesce((select sum(round(dl.qty * l.price, 2)) from delivery_lines dl join purchase_request_lines l on l.id = dl.line_id where l.request_id = r.id), 0) delivered,
    (select count(*)::int from quotations q where q.request_id = r.id) quotes
  from purchase_requests r left join projects p on p.id = r.project_id left join departments d on d.id = r.dept_id left join parties v on v.id = r.vendor_id
  left join users u on u.id = r.created_by left join users ap on ap.id = r.approver_id left join users b on b.id = r.buyer_id`;

const STATE: Record<string, string> = { draft: 'Draft', procurement: 'Procurement', head: 'Department head', management: 'Management', approved: 'Purchase order', rejected: 'Returned', cancelled: 'Cancelled' };
/** What a request is waiting for, or where its PO stands. */
export const stateOf = (r: Pick<PurchaseRow, 'status' | 'approver_label' | 'closed' | 'received' | 'subtotal'>) =>
  r.status === 'head' ? `Waiting for ${r.approver_label ?? 'the department head'}`
  : r.status === 'approved' ? (r.closed ? 'PO closed' : r.received > 0 ? 'PO part received' : 'PO open')
  : r.status === 'procurement' || r.status === 'management' ? `Waiting for ${STATE[r.status]}` : STATE[r.status] ?? r.status;

export async function getPurchaseRequest(id: string) {
  const [r] = await sql<PurchaseRow[]>`${rowSelect} where r.id = ${id}`;
  return r;
}
export const listPurchaseRequests = () => sql<PurchaseRow[]>`${rowSelect} order by r.date desc, r.no desc limit 500`;

export type PRQLine = { id: string; line_no: number; material_id: string | null; code: string | null; name: string | null; name_ar: string | null; description: string; unit: string;
  qty: number; price: number; account: string | null; account_name: string | null; received_qty: number; received_amount: number; delivered_qty: number };
/** The lines with what has been received on each (posted vendor invoices against the PO). */
export const getPurchaseLines = (id: string, tx: Tx = sql) => tx<PRQLine[]>`
  select l.id::text id, l.line_no, l.material_id, m.code, m.name, m.name_ar, l.description, l.unit, l.qty, l.price, l.account, a.name account_name,
    coalesce((select sum(il.qty) from invoice_lines il join invoices i on i.id = il.invoice_id and i.status = 'posted' where il.po_line_id = l.id), 0) received_qty,
    coalesce((select sum(round(il.qty * il.price, 2)) from invoice_lines il join invoices i on i.id = il.invoice_id and i.status = 'posted' where il.po_line_id = l.id), 0) received_amount,
    coalesce((select sum(dl.qty) from delivery_lines dl where dl.line_id = l.id), 0) delivered_qty
  from purchase_request_lines l left join materials m on m.id = l.material_id left join accounts a on a.code = l.account
  where l.request_id = ${id} order by l.line_no`;

export const getPurchaseApprovals = (id: string) => sql<{ step: string; step_name: string; who: string | null; at: string }[]>`
  select a.step, a.step_name, u.name who, to_char(a.at,'YYYY-MM-DD') at from purchase_request_approvals a left join users u on u.id = a.user_id
  where a.request_id = ${id} order by a.at`;

/** The vendor invoices received against a PO. */
export const getPOInvoices = (id: string) => sql<{ id: string; no: string; date: string; ref: string; subtotal: number; vat: number; net: number; status: string; entry_id: string | null; paid: number }[]>`
  select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.ref, i.subtotal, i.vat, i.net, i.status, i.entry_id, invoice_paid(i.id) paid
  from invoices i where i.po_id = ${id} order by i.date, i.no`;

/** PO-level figures: ordered, received (invoiced) and remaining, before VAT. */
export function poFigures(lines: Pick<PRQLine, 'qty' | 'price' | 'received_amount'>[]) {
  const ordered = r2(lines.reduce((s, l) => s + lineAmount(l), 0));
  const received = r2(lines.reduce((s, l) => s + Number(l.received_amount), 0));
  return { ordered, received, remaining: r2(ordered - received), pct: ordered ? Math.round((received / ordered) * 100) : 0 };
}

export type ReceiveInput = { date: string; ref: string; vatRate: number; whtRate: number; lines: { lineId: string; qty: number; price: number }[] };

/**
 * Receive and invoice (Finance): the vendor's invoice for what was delivered on a PO. It posts at once: the items to their
 * GL codes for the PO's cost center, VAT to input VAT, WHT withheld, the net to the vendor's account (payables).
 * A line cannot receive more than remains on it. The invoice file is attached by the caller.
 */
export async function receiveInvoice(user: User, poId: string, input: ReceiveInput) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can receive invoices.');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    checkLock(s, input.date);
    const h = await loadHead(tx, poId);
    if (h.status !== 'approved' || !h.po_no) throw new RuleError('Invoices are received on approved purchase orders only.');
    if (h.closed) throw new RuleError('This PO is closed.');
    if (!h.vendor_id) throw new RuleError('This PO has no vendor.');
    if (!input.ref.trim()) throw new RuleError("Enter the vendor's invoice number.");
    const poLines = new Map((await getPurchaseLines(poId, tx)).map(l => [l.id, l]));
    const lines = input.lines.filter(l => Number(l.qty) > 0);
    if (!lines.length) throw new RuleError('Enter the quantity received on at least one line.');
    for (const l of lines) {
      const pl = poLines.get(l.lineId);
      if (!pl) throw new RuleError('A line is not on this PO.');
      const left = r2(Number(pl.qty) - Number(pl.received_qty));
      if (Number(l.qty) > left + 0.0005) throw new RuleError(`${pl.name ?? pl.description}: only ${left} ${pl.unit} remain on the PO.`);
      if (!(Number(l.price) >= 0)) throw new RuleError('Prices cannot be negative.');
      if (!pl.account) throw new RuleError(`${pl.name ?? pl.description} has no GL code.`);
    }
    const no = await nextNo(tx, 'VI-');
    const doc: DocInput = {
      kind: 'purchase', no, party: h.vendor_id, project: h.project_id, dept: h.dept_id,
      vatRate: input.vatRate || 0, whtRate: input.whtRate || 0, siRate: 0, retRate: 0, dpAmount: 0,
      lines: lines.map(l => { const pl = poLines.get(l.lineId)!; return { acc: pl.account!, desc: pl.name ?? pl.description, qty: Number(l.qty), price: r2(l.price) }; }),
    };
    const t = docTotals(doc);
    const jl = docLines(doc, s.account_map);
    await validateLines(tx, jl, s);
    const [{ id }] = await tx<{ id: string }[]>`insert into invoices ${tx({
      kind: 'purchase', no, date: input.date, party_id: h.vendor_id, project_id: h.project_id, dept_id: h.dept_id, ref: input.ref.trim(), po_id: poId,
      vat_rate: doc.vatRate, wht_rate: doc.whtRate, subtotal: t.subtotal, vat: t.vat, wht: t.wht, total: t.total, net: t.net, status: 'draft', created_by: user.id,
    })} returning id`;
    for (const [k, l] of lines.entries()) {
      const pl = poLines.get(l.lineId)!;
      await tx`insert into invoice_lines (invoice_id, line_no, account, description, qty, price, project_id, dept_id, po_line_id)
        values (${id}, ${k + 1}, ${pl.account}, ${pl.name ?? pl.description}, ${l.qty}, ${r2(l.price)}, ${h.project_id}, ${h.dept_id}, ${l.lineId})`;
      if (pl.material_id) await tx`update materials set last_price = ${r2(l.price)} where id = ${pl.material_id}`;
    }
    const [vendor] = await tx<{ name: string }[]>`select name from parties where id = ${h.vendor_id}`;
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${input.date}, ${`${no} · ${h.po_no} · ${vendor?.name ?? ''}`}, ${input.ref.trim()}, 'payment_request', 'draft', 'invoice', ${id}, ${user.id}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Posted from ' + no);
    await tx`update invoices set status = 'posted', entry_id = ${eid} where id = ${id}`;
    await audit(tx, user, 'invoice', id, `Received on ${h.po_no}`, `Journal entry ${jno}`);
    await audit(tx, user, 'purchase', poId, 'Invoice received', `${no} · vendor invoice ${input.ref.trim()} · ${t.subtotal.toFixed(2)}`);
    // everything received: the PO closes by itself
    const after = await getPurchaseLines(poId, tx);
    if (after.every(l => Number(l.received_qty) >= Number(l.qty) - 0.0005)) await tx`update purchase_requests set closed = true where id = ${poId}`;
    return id;
  });
}

/** Voids a vendor invoice that nothing has paid or requested yet (Finance): its entry is reversed and the PO can receive again. */
export async function voidVendorInvoice(user: User, id: string, reason: string, date: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can void invoices.');
  const inv = await sql.begin(async tx => {
    const [inv] = await tx<{ no: string; status: string; entry_id: string; po_id: string | null }[]>`select no, status, entry_id, po_id from invoices where id = ${id} and kind = 'purchase' and po_id is not null for update`;
    if (!inv) throw new RuleError('Vendor invoice not found.');
    if (inv.status !== 'posted') throw new RuleError('Only posted invoices can be voided.');
    if (Number((await tx<{ v: number }[]>`select invoice_paid(${id}) v`)[0].v) > 0) throw new RuleError('A payment is allocated to this invoice. Reverse the payment first.');
    const [rq] = await tx<{ no: string }[]>`select q.no from payment_request_bills b join invoices q on q.id = b.request_id and q.status in ('draft', 'pending', 'posted') where b.bill_id = ${id} limit 1`;
    if (rq) throw new RuleError(`This invoice is on payment request ${rq.no}. Delete or return that request first.`);
    return inv;
  });
  const rid = await reverseEntry(user, inv.entry_id, `Void ${inv.no}${reason ? ': ' + reason : ''}`, date);
  await sql.begin(async tx => {
    await tx`update invoices set status = 'void' where id = ${id}`;
    if (inv.po_id) await tx`update purchase_requests set closed = false where id = ${inv.po_id}`;
    await audit(tx, user, 'invoice', id, 'Voided', reason);
    if (inv.po_id) await audit(tx, user, 'purchase', inv.po_id, 'Invoice voided', inv.no);
  });
  return rid;
}

export type VendorBill = { id: string; no: string; date: string; ref: string; po_no: string | null; cc: string | null; project_id: string | null; dept_id: string | null; net: number; paid: number; open: number; request_no: string | null; request_id: string | null; party_id: string };
/** A vendor's invoices received against POs that are not fully paid, with the payment request that covers each (if any). */
export const unpaidBills = (party?: string, tx: Tx = sql) => tx<VendorBill[]>`
  select * from (
    select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.ref, r.po_no, coalesce(p.code, d.name) cc, i.project_id, i.dept_id, i.net, invoice_paid(i.id) paid,
      i.net - invoice_paid(i.id) open, rq.no request_no, rq.id request_id, i.party_id
    from invoices i left join purchase_requests r on r.id = i.po_id left join projects p on p.id = i.project_id left join departments d on d.id = i.dept_id
    left join lateral (select q.id, q.no from payment_request_bills b join invoices q on q.id = b.request_id and q.status in ('draft', 'pending', 'posted') where b.bill_id = i.id limit 1) rq on true
    where i.kind = 'purchase' and i.po_id is not null and i.status = 'posted' and (${party ?? null}::text is null or i.party_id = ${party ?? null})
  ) x where x.open > 0.004 order by x.date, x.no`;
