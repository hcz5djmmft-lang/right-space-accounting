import 'server-only';
import { sql, type Tx } from './db';
import { r2 } from './money';
import { RuleError, lineAmount } from './ledger';
import { type User, hasRole } from './roles';
import { audit, nextNo } from './books';
import { approverFor, canSign, getSteps } from './documents';
import { holdersOf } from './org';
import { today } from './dates';
import { CATEGORIES, addDays, daysBetween } from './planning-calc';
import { type PRQLine, getPurchaseLines, isProcurement, savePurchaseRequest } from './purchasing';
import { projectAccounts } from './boq';
import { onSiteTeam } from './planning';

// Procurement on top of purchasing (Adel's item 19): vendors with categories, documents, price history and a rating;
// purchase requests assigned to a procurement engineer; quotations compared side by side, the chosen offer going to the
// procurement head then Management; deliveries on a PO (partial, late ones flagged as tasks) and site stock per project;
// subcontractors' work orders per work category with retention and advance, approved like POs; the material plan raised
// into requests; committed cost against the BOQ budget; and the reports.

/** A vendor's rating as stars, for the lists. */
export const stars = (n: number | null) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
export const VENDOR_CATEGORIES = ['Plumbing', 'Electrical', 'Tiles and marble', 'Paint and decoration', 'Gypsum and ceilings', 'Carpentry and doors', 'Aluminium and glass', 'Sanitary ware', 'Lighting', 'Demolition and building', 'Furniture', 'Subcontractor', 'General supplies'];
const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d\d-\d\d$/.test(s);
const canSite = (u: User) => hasRole(u, 'finance', 'engineering', 'projects');

// ---------------------------------------------------------------- vendors
export type VendorRow = { id: string; code: string | null; name: string; full_name: string | null; phone: string | null; email: string | null; categories: string[]; rating: number | null; rating_note: string; rated_by: string | null; rated_at: string | null; open_pos: number; work_orders: number; spend: number; last_order: string | null };
const vendorSelect = sql`
  select p.id, p.code, p.name, p.full_name, p.phone, p.email, p.categories, p.rating, p.rating_note, rb.name rated_by, to_char(p.rated_at,'YYYY-MM-DD') rated_at,
    (select count(*)::int from purchase_requests r where r.vendor_id = p.id and r.status = 'approved' and not r.closed) open_pos,
    (select count(*)::int from work_orders w where w.vendor_id = p.id and w.status in ('approved', 'closed')) work_orders,
    coalesce((select sum(i.subtotal) from invoices i where i.party_id = p.id and i.kind = 'purchase' and i.status = 'posted'), 0)::float spend,
    (select to_char(max(r.po_date),'YYYY-MM-DD') from purchase_requests r where r.vendor_id = p.id and r.status = 'approved') last_order
  from parties p left join users rb on rb.id = p.rated_by where p.type = 'vendor'`;
export const listVendors = (category?: string) => sql<VendorRow[]>`${vendorSelect} and (${category || null}::text is null or ${category || null} = any(p.categories)) order by p.name`;
export const getVendor = async (id: string) => (await sql<VendorRow[]>`${vendorSelect} and p.id = ${id}`)[0] ?? null;

/** Categories and the rating of a vendor (Procurement, Finance or the engineers). */
export async function saveVendorProfile(user: User, id: string, i: { categories: string[]; rating: number | string | null; rating_note?: string }) {
  if (!(await isProcurement(user)) && !canSite(user)) throw new RuleError('Only Procurement, Finance or the engineers rate a vendor.');
  const cats = i.categories.filter(c => VENDOR_CATEGORIES.includes(c));
  const rating = i.rating === null || i.rating === '' ? null : Number(i.rating);
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new RuleError('The rating is from 1 to 5 stars.');
  await sql.begin(async tx => {
    const [v] = await tx<{ name: string; rating: number | null }[]>`select name, rating from parties where id = ${id} and type = 'vendor'`;
    if (!v) throw new RuleError('Vendor not found.');
    await tx`update parties set categories = ${cats}, rating = ${rating}, rating_note = ${(i.rating_note ?? '').trim()},
      rated_by = case when ${rating}::int is distinct from rating then ${user.id} else rated_by end, rated_at = case when ${rating}::int is distinct from rating then now() else rated_at end where id = ${id}`;
    await audit(tx, user, 'vendor', id, 'Vendor profile saved', `${cats.join(', ') || 'no category'}${rating ? ` · ${rating} stars` : ''}`);
  });
}

export type VendorOrder = { kind: 'PO' | 'WO'; id: string; no: string; date: string; cc: string | null; title: string; amount: number; state: string; href: string };
/** A vendor's purchase orders and work orders, newest first. */
export const vendorOrders = (vendorId: string) => sql<VendorOrder[]>`
  select * from (
    select 'PO' kind, r.id, r.po_no no, to_char(r.po_date,'YYYY-MM-DD') date, coalesce(p.code, d.name) cc, r.notes title,
      coalesce((select sum(round(l.qty * l.price, 2)) from purchase_request_lines l where l.request_id = r.id), 0)::float amount,
      case when r.closed then 'closed' else 'open' end state, '/purchasing/' || r.id href
    from purchase_requests r left join projects p on p.id = r.project_id left join departments d on d.id = r.dept_id where r.vendor_id = ${vendorId} and r.status = 'approved'
    union all
    select 'WO', w.id, w.no, to_char(w.date,'YYYY-MM-DD'), p.code, w.title, coalesce((select sum(round(l.qty * l.rate, 2)) from work_order_lines l where l.work_order_id = w.id), 0)::float, w.status, '/purchasing/work-orders/' || w.id
    from work_orders w join projects p on p.id = w.project_id where w.vendor_id = ${vendorId} and w.status in ('approved', 'closed')
  ) x order by date desc nulls last, no desc`;

export type PriceRow = { date: string; material_id: string | null; material: string; vendor_id: string | null; vendor: string | null; price: number; source: string; ref: string; href: string };
/** Every price paid or quoted per material: vendor invoices and quotations, newest first. */
export const priceHistory = (f: { material?: string; vendor?: string } = {}) => sql<PriceRow[]>`
  select * from (
    select to_char(i.date,'YYYY-MM-DD') date, pl.material_id, coalesce(m.name, pl.description) material, i.party_id vendor_id, v.name vendor, il.price::float price, 'Invoice' source, i.no ref, '/purchasing/invoices/' || i.id href
    from invoice_lines il join invoices i on i.id = il.invoice_id and i.kind = 'purchase' and i.status = 'posted' join purchase_request_lines pl on pl.id = il.po_line_id
    left join materials m on m.id = pl.material_id left join parties v on v.id = i.party_id
    union all
    select to_char(q.date,'YYYY-MM-DD'), pl.material_id, coalesce(m.name, pl.description), q.vendor_id, v.name, ql.price::float, case when q.chosen then 'Quotation · chosen' else 'Quotation' end, r.no, '/purchasing/' || r.id
    from quotation_lines ql join quotations q on q.id = ql.quotation_id join purchase_request_lines pl on pl.id = ql.line_id join purchase_requests r on r.id = q.request_id
    left join materials m on m.id = pl.material_id left join parties v on v.id = q.vendor_id where ql.price > 0
  ) h where (${f.material || null}::text is null or h.material_id = ${f.material || null}) and (${f.vendor || null}::text is null or h.vendor_id = ${f.vendor || null})
  order by h.material, h.date desc, h.source desc, h.vendor limit 500`;

// ---------------------------------------------------------------- the buyer a request is assigned to
/** The people who buy: the Purchasing department, its head, and the org chart's procurement positions. */
export const procurementPeople = () => sql<{ id: string; name: string }[]>`
  select distinct u.id, u.name from users u left join departments d on d.id = u.dept_id left join user_positions p on p.user_id = u.id
  where u.active and (d.code = 'PUR' or p.position in ('procurement', 'procurement_head') or exists (select 1 from departments x where x.code = 'PUR' and x.head_user_id = u.id)) order by u.name`;

export async function assignBuyer(user: User, requestId: string, buyerId: string | null) {
  await sql.begin(async tx => {
    if (!(await isProcurement(user, tx))) throw new RuleError('Only Procurement assigns purchase requests.');
    const [r] = await tx<{ status: string; no: string }[]>`select status, no from purchase_requests where id = ${requestId}`;
    if (!r) throw new RuleError('Purchase request not found.');
    let name = 'nobody';
    if (buyerId) {
      const b = (await procurementPeople()).find(x => x.id === buyerId);
      if (!b) throw new RuleError('Pick a person from the list: the Purchasing department or the procurement positions of the org chart.');
      name = b.name;
    }
    await tx`update purchase_requests set buyer_id = ${buyerId} where id = ${requestId}`;
    await audit(tx, user, 'purchase', requestId, 'Assigned to ' + name);
  });
}

// ---------------------------------------------------------------- quotations
export type Quotation = { id: string; request_id: string; vendor_id: string; vendor: string; date: string; ref: string; valid_until: string | null; delivery_days: number | null; vat_rate: number; notes: string; chosen: boolean; who: string | null; lines: Record<string, number>; total: number; complete: boolean };

export async function listQuotations(requestId: string, tx: Tx = sql): Promise<Quotation[]> {
  const [qs, ls, lines] = await Promise.all([
    tx<Omit<Quotation, 'lines' | 'total' | 'complete'>[]>`select q.id, q.request_id, q.vendor_id, v.name vendor, to_char(q.date,'YYYY-MM-DD') date, q.ref, to_char(q.valid_until,'YYYY-MM-DD') valid_until, q.delivery_days, q.vat_rate, q.notes, q.chosen, u.name who
      from quotations q join parties v on v.id = q.vendor_id left join users u on u.id = q.created_by where q.request_id = ${requestId} order by q.created_at`,
    tx<{ quotation_id: string; line_id: string; price: number }[]>`select ql.quotation_id, ql.line_id::text line_id, ql.price::float price from quotation_lines ql join quotations q on q.id = ql.quotation_id where q.request_id = ${requestId}`,
    getPurchaseLines(requestId, tx),
  ]);
  return qs.map(q => {
    const prices = Object.fromEntries(ls.filter(l => l.quotation_id === q.id).map(l => [l.line_id, l.price]));
    const complete = lines.every(l => (prices[l.id] ?? 0) > 0);
    return { ...q, lines: prices, complete, total: r2(lines.reduce((t, l) => t + Number(l.qty) * (prices[l.id] ?? 0), 0)) };
  });
}

export type QuotationInput = { vendor: string; date: string; ref?: string; valid_until?: string; delivery_days?: string | number; vat_rate?: string | number; notes?: string; prices: Record<string, number | string> };
/** Procurement records a vendor's offer on a request still with Procurement: a price per line. */
export async function addQuotation(user: User, requestId: string, i: QuotationInput) {
  return sql.begin(async tx => {
    if (!(await isProcurement(user, tx))) throw new RuleError('Only Procurement records quotations.');
    const [r] = await tx<{ status: string }[]>`select status from purchase_requests where id = ${requestId}`;
    if (!r) throw new RuleError('Purchase request not found.');
    if (r.status !== 'procurement') throw new RuleError('Quotations are collected while the request is with Procurement.');
    const [v] = await tx`select 1 from parties where id = ${i.vendor} and type = 'vendor'`;
    if (!v) throw new RuleError('Choose the vendor from the vendor list.');
    if (!isDate(i.date)) throw new RuleError('Give the quotation date.');
    if (i.valid_until && !isDate(i.valid_until)) throw new RuleError('Give "valid until" as a date.');
    const days = i.delivery_days === '' || i.delivery_days == null ? null : Number(i.delivery_days);
    if (days !== null && !(Number.isInteger(days) && days >= 0)) throw new RuleError('Delivery is a number of days.');
    const lines = await getPurchaseLines(requestId, tx);
    const priced = lines.map(l => ({ id: l.id, price: r2(Number(i.prices[l.id] ?? 0)) }));
    if (priced.some(p => !(p.price >= 0))) throw new RuleError('Prices are numbers, zero or more.');
    if (!priced.some(p => p.price > 0)) throw new RuleError('Give a price on at least one line.');
    const [q] = await tx<{ id: string }[]>`insert into quotations (request_id, vendor_id, date, ref, valid_until, delivery_days, vat_rate, notes, created_by)
      values (${requestId}, ${i.vendor}, ${i.date}, ${(i.ref ?? '').trim()}, ${i.valid_until || null}, ${days}, ${Number(i.vat_rate) || 0}, ${(i.notes ?? '').trim()}, ${user.id}) returning id`;
    for (const p of priced) await tx`insert into quotation_lines (quotation_id, line_id, price) values (${q.id}, ${p.id}, ${p.price})`;
    const [vn] = await tx<{ name: string }[]>`select name from parties where id = ${i.vendor}`;
    const total = r2(lines.reduce((t, l) => t + Number(l.qty) * (priced.find(p => p.id === l.id)?.price ?? 0), 0));
    await audit(tx, user, 'purchase', requestId, 'Quotation recorded', `${vn.name} · ${total.toFixed(2)}`);
    return q.id;
  });
}

export async function removeQuotation(user: User, quotationId: string) {
  await sql.begin(async tx => {
    if (!(await isProcurement(user, tx))) throw new RuleError('Only Procurement removes quotations.');
    const [q] = await tx<{ request_id: string; chosen: boolean; status: string; vendor: string }[]>`select q.request_id, q.chosen, r.status, v.name vendor from quotations q join purchase_requests r on r.id = q.request_id join parties v on v.id = q.vendor_id where q.id = ${quotationId}`;
    if (!q) return;
    if (q.chosen || q.status !== 'procurement') throw new RuleError('This offer was chosen; the request is past Procurement.');
    await tx`delete from quotations where id = ${quotationId}`;
    await audit(tx, user, 'purchase', q.request_id, 'Quotation removed', q.vendor);
  });
}

export type Comparison = { lines: PRQLine[]; quotes: Quotation[]; lowest: Record<string, string>; best: string | null };
/** The offers side by side: the lowest price per line and the lowest complete total. */
export async function compareQuotations(requestId: string): Promise<Comparison> {
  const [lines, quotes] = await Promise.all([getPurchaseLines(requestId), listQuotations(requestId)]);
  const lowest: Record<string, string> = {};
  for (const l of lines) {
    const priced = quotes.filter(q => (q.lines[l.id] ?? 0) > 0).sort((a, b) => a.lines[l.id] - b.lines[l.id]);
    if (priced[0]) lowest[l.id] = priced[0].id;
  }
  const complete = quotes.filter(q => q.complete).sort((a, b) => a.total - b.total);
  return { lines, quotes, lowest, best: complete[0]?.id ?? null };
}

/** The chosen offer becomes the request's vendor and prices; it goes to the procurement head, then Management (a PO). */
export async function chooseQuotation(user: User, quotationId: string) {
  await sql.begin(async tx => {
    if (!(await isProcurement(user, tx))) throw new RuleError('Only Procurement chooses an offer.');
    const [q] = await tx<{ id: string; request_id: string; vendor_id: string; vendor: string; date: string; delivery_days: number | null; vat_rate: number; status: string }[]>`
      select q.id, q.request_id, q.vendor_id, v.name vendor, to_char(q.date,'YYYY-MM-DD') date, q.delivery_days, q.vat_rate, r.status from quotations q join purchase_requests r on r.id = q.request_id join parties v on v.id = q.vendor_id where q.id = ${quotationId} for update of q`;
    if (!q) throw new RuleError('Quotation not found.');
    if (q.status !== 'procurement') throw new RuleError('This request is past Procurement.');
    const quotes = await listQuotations(q.request_id, tx);
    const me = quotes.find(x => x.id === quotationId)!;
    if (!me.complete) throw new RuleError(`${q.vendor}'s offer does not price every line.`);
    for (const [lineId, price] of Object.entries(me.lines)) await tx`update purchase_request_lines set price = ${price} where id = ${lineId} and request_id = ${q.request_id}`;
    await tx`update quotations set chosen = (id = ${quotationId}) where request_id = ${q.request_id}`;
    const delivery = q.delivery_days != null ? addDays(today(), q.delivery_days) : null;
    await tx`update purchase_requests set vendor_id = ${q.vendor_id}, vat_rate = ${q.vat_rate}, delivery_date = ${delivery}, buyer_id = coalesce(buyer_id, ${user.id}) where id = ${q.request_id}`;
    await tx`insert into purchase_request_approvals (request_id, step, step_name, user_id) values (${q.request_id}, 'procurement', 'Procurement', ${user.id}) on conflict (request_id, step) do update set user_id = ${user.id}, at = now()`;
    const heads = await holdersOf('procurement_head', tx);
    const head = heads.find(h => h !== user.id) ?? null;
    if (head && !heads.includes(user.id)) {
      await tx`update purchase_requests set status = 'head', approver_id = ${head}, approver_label = 'Procurement head' where id = ${q.request_id}`;
      await audit(tx, user, 'purchase', q.request_id, `Offer of ${q.vendor} chosen and sent to the Procurement head`, `${me.total.toFixed(2)} · ${quotes.length} offers compared`);
    } else {
      // the procurement head chose it (or the chart names none): the head's step is their own choice
      await tx`insert into purchase_request_approvals (request_id, step, step_name, user_id) values (${q.request_id}, 'head', 'Procurement head', ${user.id}) on conflict (request_id, step) do update set user_id = ${user.id}, at = now()`;
      await tx`update purchase_requests set status = 'management', approver_id = ${user.id}, approver_label = 'Procurement head' where id = ${q.request_id}`;
      await audit(tx, user, 'purchase', q.request_id, `Offer of ${q.vendor} chosen and sent to Management`, `${me.total.toFixed(2)} · ${quotes.length} offers compared`);
    }
  });
}

// ---------------------------------------------------------------- deliveries
export type Delivery = { id: string; date: string; ref: string; notes: string; who: string | null; lines: { line_id: string; qty: number; name: string }[] };
export async function listDeliveries(poId: string): Promise<Delivery[]> {
  const [ds, ls] = await Promise.all([
    sql<Omit<Delivery, 'lines'>[]>`select d.id, to_char(d.date,'YYYY-MM-DD') date, d.ref, d.notes, u.name who from deliveries d left join users u on u.id = d.received_by where d.po_id = ${poId} order by d.date, d.created_at`,
    sql<{ delivery_id: string; line_id: string; qty: number; name: string }[]>`select dl.delivery_id, dl.line_id::text line_id, dl.qty::float qty, coalesce(m.name, l.description) name from delivery_lines dl join deliveries d on d.id = dl.delivery_id join purchase_request_lines l on l.id = dl.line_id left join materials m on m.id = l.material_id where d.po_id = ${poId}`,
  ]);
  return ds.map(d => ({ ...d, lines: ls.filter(l => l.delivery_id === d.id).map(({ line_id, qty, name }) => ({ line_id, qty, name })) }));
}

export type DeliveryState = 'none' | 'part' | 'full';
export const deliveryState = (lines: Pick<PRQLine, 'qty' | 'delivered_qty'>[]): DeliveryState =>
  lines.every(l => Number(l.delivered_qty) >= Number(l.qty) - 0.0005) ? 'full' : lines.some(l => Number(l.delivered_qty) > 0) ? 'part' : 'none';
export const deliveryLabel: Record<DeliveryState, string> = { none: 'Not delivered', part: 'Part delivered', full: 'Delivered' };
/** Days past the promised date with goods still to come. */
export const lateDays = (r: { delivery_date: string | null; needed_by: string | null; closed: boolean }, state: DeliveryState, now = today()) => {
  const due = r.delivery_date ?? r.needed_by;
  return !due || r.closed || state === 'full' || now <= due ? 0 : daysBetween(due, now) - 1;
};

/** Goods received on a PO (Procurement, Finance or the engineers): the delivery note's quantities per line, never more than ordered. */
export async function recordDelivery(user: User, poId: string, i: { date: string; ref?: string; notes?: string; lines: { lineId: string; qty: number | string }[] }) {
  return sql.begin(async tx => {
    if (!(await isProcurement(user, tx)) && !canSite(user)) throw new RuleError('Only Procurement, Finance or the engineers record deliveries.');
    const [h] = await tx<{ status: string; closed: boolean; po_no: string | null; vendor: string | null }[]>`select r.status, r.closed, r.po_no, v.name vendor from purchase_requests r left join parties v on v.id = r.vendor_id where r.id = ${poId} for update of r`;
    if (!h) throw new RuleError('Purchase order not found.');
    if (h.status !== 'approved') throw new RuleError('Deliveries are recorded on approved purchase orders.');
    if (h.closed) throw new RuleError('This PO is closed.');
    if (!isDate(i.date)) throw new RuleError('Give the delivery date.');
    const lines = new Map((await getPurchaseLines(poId, tx)).map(l => [l.id, l]));
    const got = i.lines.map(l => ({ lineId: l.lineId, qty: Number(l.qty) })).filter(l => l.qty > 0);
    if (!got.length) throw new RuleError('Enter the quantity delivered on at least one line.');
    for (const l of got) {
      const pl = lines.get(l.lineId);
      if (!pl) throw new RuleError('A line is not on this PO.');
      const left = Math.round((Number(pl.qty) - Number(pl.delivered_qty)) * 1000) / 1000;
      if (l.qty > left + 0.0005) throw new RuleError(`${pl.name ?? pl.description}: only ${left} ${pl.unit} are still to be delivered.`);
    }
    const [d] = await tx<{ id: string }[]>`insert into deliveries (po_id, date, ref, notes, received_by) values (${poId}, ${i.date}, ${(i.ref ?? '').trim()}, ${(i.notes ?? '').trim()}, ${user.id}) returning id`;
    for (const l of got) await tx`insert into delivery_lines (delivery_id, line_id, qty) values (${d.id}, ${l.lineId}, ${l.qty})`;
    const after = await getPurchaseLines(poId, tx);
    const state = deliveryState(after);
    if (state === 'full') await tx`update tasks set status = 'done', done_at = now(), updated_at = now() where link_type = 'purchase' and link_id = ${poId} and title like 'Late delivery%' and status <> 'done'`;
    await audit(tx, user, 'purchase', poId, state === 'full' ? 'Delivered in full' : 'Delivery recorded', `${i.date}${i.ref ? ` · note ${i.ref.trim()}` : ''} · ${got.length} line${got.length === 1 ? '' : 's'}`);
    return d.id;
  });
}

/** Procurement sets or changes the date the vendor promised. */
export async function setDeliveryDate(user: User, poId: string, date: string) {
  await sql.begin(async tx => {
    if (!(await isProcurement(user, tx))) throw new RuleError('Only Procurement sets the delivery date.');
    if (date && !isDate(date)) throw new RuleError('Give the delivery date as YYYY-MM-DD.');
    const r = await tx`update purchase_requests set delivery_date = ${date || null} where id = ${poId} and status = 'approved'`;
    if (!r.count) throw new RuleError('Delivery dates are set on purchase orders.');
    await audit(tx, user, 'purchase', poId, 'Delivery date set', date || 'cleared');
  });
}

/** One open task per PO whose promised date has passed with goods still to come, for its buyer (else the procurement head, else whoever raised it). */
export async function raiseLateDeliveryTasks(now = today()) {
  const pos = await sql<{ id: string; po_no: string; vendor: string | null; cc: string | null; due: string; buyer_id: string | null; created_by: string | null }[]>`
    select r.id, r.po_no, v.name vendor, coalesce(p.code, d.name) cc, to_char(coalesce(r.delivery_date, r.needed_by),'YYYY-MM-DD') due, r.buyer_id, r.created_by
    from purchase_requests r left join parties v on v.id = r.vendor_id left join projects p on p.id = r.project_id left join departments d on d.id = r.dept_id
    where r.status = 'approved' and not r.closed and coalesce(r.delivery_date, r.needed_by) < ${now}::date
      and exists (select 1 from purchase_request_lines l where l.request_id = r.id and l.qty - coalesce((select sum(dl.qty) from delivery_lines dl where dl.line_id = l.id), 0) > 0.0005)
      and not exists (select 1 from tasks t where t.link_type = 'purchase' and t.link_id = r.id and t.title like 'Late delivery%' and t.status <> 'done')`;
  if (!pos.length) return 0;
  const head = (await holdersOf('procurement_head'))[0] ?? null;
  let n = 0;
  for (const po of pos) {
    const who = po.buyer_id ?? head ?? po.created_by;
    const late = daysBetween(po.due, now) - 1;
    await sql`insert into tasks (title, details, status, priority, due, assignee_id, link_type, link_id, link_label, created_by)
      values (${`Late delivery: ${po.po_no}${po.vendor ? ` · ${po.vendor}` : ''}${po.cc ? ` · ${po.cc}` : ''}`}, ${`Promised for ${po.due}, ${late} day${late === 1 ? '' : 's'} late with goods still to come. Chase the vendor and record the delivery on the PO.`}, 'todo', 'high', ${po.due}, ${who}, 'purchase', ${po.id}, ${po.po_no}, ${who})`;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- site stock
export type StockRow = { material_id: string; name: string; name_ar: string | null; unit: string; delivered: number; used: number; on_hand: number };
/** What each material stands at on a project's site: delivered on its POs less what the site used. */
export const siteStock = (projectId: string, tx: Tx = sql) => tx<StockRow[]>`
  with d as (
    select pl.material_id, sum(dl.qty) qty from delivery_lines dl join deliveries dv on dv.id = dl.delivery_id join purchase_requests r on r.id = dv.po_id and r.project_id = ${projectId}
    join purchase_request_lines pl on pl.id = dl.line_id where pl.material_id is not null group by pl.material_id),
  u as (select material_id, sum(qty) qty from stock_issues where project_id = ${projectId} group by material_id)
  select m.id material_id, m.name, m.name_ar, m.unit, coalesce(d.qty, 0)::float delivered, coalesce(u.qty, 0)::float used, (coalesce(d.qty, 0) - coalesce(u.qty, 0))::float on_hand
  from materials m join (select material_id from d union select material_id from u) x on x.material_id = m.id left join d on d.material_id = m.id left join u on u.material_id = m.id order by m.name`;

/** The site engineer (or the engineers, Procurement, Finance) records what the site used. */
export async function recordStockIssue(user: User, projectId: string, i: { material: string; qty: number | string; date: string; note?: string }) {
  await sql.begin(async tx => {
    if (!(await isProcurement(user, tx)) && !canSite(user) && !(await onSiteTeam(projectId, user.id, tx))) throw new RuleError('Only the site team, the engineers, Procurement or Finance record what the site used.');
    if (!isDate(i.date)) throw new RuleError('Give the date.');
    const qty = Number(i.qty);
    if (!(qty > 0)) throw new RuleError('The quantity used must be more than zero.');
    const row = (await siteStock(projectId, tx)).find(r => r.material_id === i.material);
    if (!row) throw new RuleError('Nothing of that material was delivered to this site.');
    if (qty > row.on_hand + 0.0005) throw new RuleError(`${row.name}: only ${row.on_hand} ${row.unit} on hand.`);
    await tx`insert into stock_issues (project_id, material_id, date, qty, note, user_id) values (${projectId}, ${i.material}, ${i.date}, ${qty}, ${(i.note ?? '').trim()}, ${user.id})`;
    await audit(tx, user, 'stock', projectId, 'Site use recorded', `${row.name} · ${qty} ${row.unit}${i.note ? ` · ${i.note.trim()}` : ''}`);
  });
}
export const stockIssues = (projectId: string) => sql<{ date: string; name: string; qty: number; unit: string; note: string; who: string | null }[]>`
  select to_char(s.date,'YYYY-MM-DD') date, m.name, s.qty::float qty, m.unit, s.note, u.name who from stock_issues s join materials m on m.id = s.material_id left join users u on u.id = s.user_id
  where s.project_id = ${projectId} order by s.date desc, s.at desc limit 50`;
/** Projects with any stock movement, with how many materials are on hand. */
export const stockProjects = () => sql<{ id: string; code: string; name: string; materials: number; on_hand: number }[]>`
  select p.id, p.code, p.name, count(distinct x.material_id)::int materials, count(distinct x.material_id) filter (where x.on_hand > 0.0005)::int on_hand
  from projects p join (
    select r.project_id, pl.material_id, sum(dl.qty) - coalesce((select sum(s.qty) from stock_issues s where s.project_id = r.project_id and s.material_id = pl.material_id), 0) on_hand
    from delivery_lines dl join deliveries dv on dv.id = dl.delivery_id join purchase_requests r on r.id = dv.po_id join purchase_request_lines pl on pl.id = dl.line_id
    where r.project_id is not null and pl.material_id is not null group by r.project_id, pl.material_id
  ) x on x.project_id = p.id group by p.id, p.code, p.name order by p.code`;

// ---------------------------------------------------------------- the material plan
export type PlanRow = { id: number; calculator: string; no: string; description: string; size: string; brand: string; unit: string; qty: number; price: number; amount: number; needed_by: string | null; request_id: string | null; request_no: string | null; po_no: string | null; request_status: string | null };
export const planRows = (projectId: string) => sql<PlanRow[]>`
  select m.id, m.calculator, m.no, m.description, m.size, m.brand, m.unit, m.qty::float qty, m.price::float price, m.amount::float amount, to_char(m.needed_by,'YYYY-MM-DD') needed_by,
    m.request_id, r.no request_no, r.po_no, r.status request_status
  from material_plan m left join purchase_requests r on r.id = m.request_id where m.project_id = ${projectId} order by m.needed_by nulls last, m.calculator, m.no`;
export const planProjects = () => sql<{ id: string; code: string; name: string; lines: number; requested: number; next_needed: string | null; amount: number }[]>`
  select p.id, p.code, p.name, count(*)::int lines, count(m.request_id)::int requested, to_char(min(m.needed_by) filter (where m.request_id is null),'YYYY-MM-DD') next_needed, coalesce(sum(m.amount), 0)::float amount
  from material_plan m join projects p on p.id = m.project_id group by p.id, p.code, p.name order by min(m.needed_by) nulls last, p.code`;

/** The GL code family a calculator's materials are bought on. */
const PLAN_ACCOUNT: Record<string, string> = { bathroom: '24002', kitchen: '24002', sanitary: '24002', electrical: '24001', elecfin: '24001' };
/** Raises one purchase request for the chosen material plan lines (Procurement or the engineers), creating the materials it needs; nothing is retyped. */
export async function planToRequest(user: User, projectId: string, ids: (number | string)[]) {
  if (!(await isProcurement(user)) && !canSite(user)) throw new RuleError('Only Procurement or the engineers raise requests from the material plan.');
  const rows = (await planRows(projectId)).filter(r => ids.map(String).includes(String(r.id)));
  if (!rows.length) throw new RuleError('Tick the material plan lines to order.');
  if (rows.some(r => r.request_id)) throw new RuleError('Some of those lines are already on a request.');
  const materials = await sql.begin(async tx => {
    const out: Record<number, string> = {};
    for (const r of rows) {
      const name = r.description.trim().slice(0, 120);
      const [m] = await tx<{ id: string }[]>`select id from materials where name = ${name} or name_ar = ${name} order by active desc limit 1`;
      if (m) { out[r.id] = m.id; continue; }
      const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(substring(code from '^MAT-(\\d+)$')::int), 0) + 1 n from materials`;
      const [c] = await tx<{ id: string }[]>`insert into materials (code, name, name_ar, unit, account_base) values (${'MAT-' + String(n).padStart(3, '0')}, ${name}, ${name}, ${r.unit.trim() || 'pc'}, ${PLAN_ACCOUNT[r.calculator] ?? '28002'}) returning id`;
      await audit(tx, user, 'material', c.id, 'Added', `${name} (from the material plan)`);
      out[r.id] = c.id;
    }
    return out;
  });
  const needed = rows.map(r => r.needed_by).filter((x): x is string => !!x).sort()[0] ?? null;
  const id = await savePurchaseRequest(user, {
    date: today(), neededBy: needed, project: projectId, notes: `From the material plan: ${rows.map(r => r.no).join(', ')}`,
    lines: rows.map(r => ({ material: materials[r.id], qty: Number(r.qty), description: [r.size, r.brand].filter(Boolean).join(' · ') })),
  }, true);
  await sql.begin(async tx => {
    for (const r of rows) await tx`update material_plan set request_id = ${id}, material_id = ${materials[r.id]} where id = ${r.id}`;
    if (await isProcurement(user, tx)) await tx`update purchase_requests set buyer_id = ${user.id} where id = ${id}`;
    await audit(tx, user, 'purchase', id, 'Raised from the material plan', `${rows.length} lines`);
  });
  return id;
}

// ---------------------------------------------------------------- work orders
export const WO_CATEGORIES = [...CATEGORIES, { no: 'other', title: 'Other' }];
/** The project GL code family a work category's labour usually posts to (a guess the form prefills). */
export const WO_ACCOUNT: Record<string, string> = { '1': '22001', '2': '26002', '3': '26001', '4': '26004', '5': '23001', '6': '26003', '7': '26005', '8': '26007', '9': '23002', '10': '26008', other: '26008' };
export type WOLineInput = { item: string; unit?: string; qty: number | string; rate: number | string };
export type WOInput = { id?: string; project: string; vendor: string; category?: string; title: string; date: string; start?: string; end?: string; retention_pct?: number | string; advance_pct?: number | string; vat_rate?: number | string; account: string; notes?: string; lines: WOLineInput[] };
type WOHead = { id: string; no: string; status: string; project_id: string; vendor_id: string | null; approver_id: string | null; approver_label: string | null; created_by: string | null };
async function loadWO(tx: Tx, id: string) {
  const [h] = await tx<WOHead[]>`select id, no, status, project_id, vendor_id, approver_id, approver_label, created_by from work_orders where id = ${id} for update`;
  if (!h) throw new RuleError('Work order not found.');
  return h;
}

/** A work order to a subcontractor (Procurement or the engineers): saved as a draft, or sent to the department head. */
export async function saveWorkOrder(user: User, i: WOInput, submit: boolean) {
  return sql.begin(async tx => {
    if (!(await isProcurement(user, tx)) && !canSite(user)) throw new RuleError('Only Procurement or the engineers raise work orders.');
    const [p] = await tx<{ id: string; is_office: boolean; code: string }[]>`select id, is_office, code from projects where id = ${i.project}`;
    if (!p || p.is_office) throw new RuleError('Choose the project.');
    const [v] = await tx`select 1 from parties where id = ${i.vendor} and type = 'vendor'`;
    if (!v) throw new RuleError('Choose the subcontractor from the vendor list.');
    const title = i.title.trim();
    if (!title) throw new RuleError('Give the work order a title.');
    if (!isDate(i.date)) throw new RuleError('Pick the date.');
    if ((i.start && !isDate(i.start)) || (i.end && !isDate(i.end))) throw new RuleError('Give the dates as YYYY-MM-DD.');
    if (i.start && i.end && i.end < i.start) throw new RuleError('The end comes before the start.');
    const pct = (v: number | string | undefined, name: string, dflt: number) => { const n = v === '' || v == null ? dflt : Number(v); if (!(n >= 0 && n <= 100)) throw new RuleError(`${name} is a percentage from 0 to 100.`); return n; };
    const retention = pct(i.retention_pct, 'Retention', 5), advance = pct(i.advance_pct, 'Advance', 0), vat = pct(i.vat_rate, 'VAT', 0);
    const codes = await projectAccounts(i.project);
    if (!codes.some(c => c.code === i.account)) throw new RuleError(`GL code ${i.account || '(none)'} is not one of ${p.code}'s codes.`);
    const category = WO_CATEGORIES.some(c => c.no === i.category) ? i.category! : 'other';
    const lines = i.lines.map(l => ({ item: (l.item ?? '').trim(), unit: (l.unit ?? '').trim() || 'lot', qty: Number(l.qty), rate: r2(Number(l.rate)) })).filter(l => l.item || l.qty || l.rate);
    if (!lines.length) throw new RuleError('Add at least one item with a quantity and a rate.');
    for (const l of lines) {
      if (!l.item) throw new RuleError('Every item needs a description.');
      if (!(l.qty > 0)) throw new RuleError(`${l.item}: the quantity must be more than zero.`);
      if (!(l.rate >= 0)) throw new RuleError(`${l.item}: the rate cannot be negative.`);
    }
    const vals = { project_id: i.project, vendor_id: i.vendor, category, title, date: i.date, start_date: i.start || null, end_date: i.end || null, retention_pct: retention, advance_pct: advance, vat_rate: vat, account: i.account, notes: (i.notes ?? '').trim() };
    let id = i.id;
    if (id) {
      const h = await loadWO(tx, id);
      if (!['draft', 'rejected'].includes(h.status)) throw new RuleError('Only drafts and returned work orders can be edited.');
      if (h.created_by !== user.id && !(await isProcurement(user, tx))) throw new RuleError('Only the person who raised it, or Procurement, can edit it.');
      await tx`update work_orders set ${tx(vals)}, status = 'draft' where id = ${id}`;
      await tx`delete from work_order_lines where work_order_id = ${id}`;
      await tx`delete from work_order_approvals where work_order_id = ${id}`;
    } else {
      const no = await nextNo(tx, 'WO-');
      [{ id }] = await tx<{ id: string }[]>`insert into work_orders ${tx({ ...vals, no, created_by: user.id })} returning id`;
    }
    for (const [k, l] of lines.entries()) await tx`insert into work_order_lines (work_order_id, line_no, item, unit, qty, rate) values (${id!}, ${k + 1}, ${l.item}, ${l.unit}, ${l.qty}, ${l.rate})`;
    if (submit) {
      const approver = await approverFor(tx, { project: i.project });
      await tx`update work_orders set status = 'head', approver_id = ${approver.id}, approver_label = ${approver.label} where id = ${id}`;
      await tx`insert into work_order_approvals (work_order_id, step, step_name, user_id) values (${id}, 'procurement', 'Procurement', ${user.id})`;
    }
    const amount = r2(lines.reduce((t, l) => t + l.qty * l.rate, 0));
    await audit(tx, user, 'workorder', id!, submit ? `Sent to ${(await approverFor(tx, { project: i.project })).label}` : i.id ? 'Edited' : 'Created', `${title} · ${amount.toFixed(2)}`);
    return id!;
  });
}

export async function canActOnWO(user: User, h: Pick<WOHead, 'status' | 'approver_id'>, tx: Tx = sql) {
  const steps = await getSteps(tx);
  if (h.status === 'head') return canSign(user, steps[0], h);
  if (h.status === 'management') return canSign(user, steps[steps.length - 1]);
  return false;
}
/** The department head's approval, then Management's, which issues the work order. */
export async function approveWorkOrder(user: User, id: string) {
  return sql.begin(async tx => {
    const h = await loadWO(tx, id);
    if (!['head', 'management'].includes(h.status)) throw new RuleError('This work order is not waiting for approval.');
    if (!(await canActOnWO(user, h, tx))) throw new RuleError(`This work order is waiting for ${h.status === 'head' ? h.approver_label ?? 'the department head' : 'Management'}, and you are not that approver.`);
    if (h.status === 'head') {
      await tx`insert into work_order_approvals (work_order_id, step, step_name, user_id) values (${id}, 'head', ${h.approver_label ?? 'Department head'}, ${user.id})`;
      await tx`update work_orders set status = 'management' where id = ${id}`;
      await audit(tx, user, 'workorder', id, (h.approver_label ?? 'Department head') + ' approved');
      return 'management';
    }
    await tx`insert into work_order_approvals (work_order_id, step, step_name, user_id) values (${id}, 'management', 'Management', ${user.id})`;
    await tx`update work_orders set status = 'approved', approved_at = ${today()} where id = ${id}`;
    await audit(tx, user, 'workorder', id, 'Management approved', `Work order ${h.no} issued`);
    return 'approved';
  });
}
export async function returnWorkOrder(user: User, id: string, reason: string) {
  await sql.begin(async tx => {
    const h = await loadWO(tx, id);
    if (!['head', 'management'].includes(h.status)) throw new RuleError('This work order is not waiting for anyone.');
    if (!(await canActOnWO(user, h, tx))) throw new RuleError('Only the person the work order is waiting for can return it.');
    await tx`update work_orders set status = 'rejected' where id = ${id}`;
    await audit(tx, user, 'workorder', id, 'Returned for changes', reason);
  });
}
export async function cancelWorkOrder(user: User, id: string) {
  await sql.begin(async tx => {
    const h = await loadWO(tx, id);
    const proc = await isProcurement(user, tx);
    if (h.status === 'cancelled') return;
    if (['approved', 'closed'].includes(h.status)) { if (!proc && !hasRole(user, 'finance')) throw new RuleError('Only Procurement or Finance can cancel an issued work order.'); }
    else if (h.created_by !== user.id && !proc) throw new RuleError('Only the person who raised it, or Procurement, can cancel it.');
    await tx`update work_orders set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'workorder', id, 'Cancelled');
  });
}
/** Closed: the work is complete and nothing more is certified on it (Procurement or Finance). */
export async function closeWorkOrder(user: User, id: string, closed = true) {
  await sql.begin(async tx => {
    if (!hasRole(user, 'finance') && !(await isProcurement(user, tx))) throw new RuleError('Only Procurement or Finance close a work order.');
    const h = await loadWO(tx, id);
    if (h.status !== (closed ? 'approved' : 'closed')) throw new RuleError(closed ? 'Only an issued work order can be closed.' : 'Only a closed work order can be reopened.');
    await tx`update work_orders set status = ${closed ? 'closed' : 'approved'} where id = ${id}`;
    await audit(tx, user, 'workorder', id, closed ? 'Work order closed' : 'Work order reopened');
  });
}

export type WORow = { id: string; no: string; status: string; project_id: string; code: string; project_name: string; vendor_id: string | null; vendor: string | null; category: string; title: string; date: string; start_date: string | null; end_date: string | null; retention_pct: number; advance_pct: number; vat_rate: number; account: string | null; account_name: string | null; approver_id: string | null; approver_label: string | null; approver_name: string | null; approved_at: string | null; notes: string; created_by: string | null; created_by_name: string | null; amount: number };
const woSelect = sql`
  select w.id, w.no, w.status, w.project_id, p.code, p.name project_name, w.vendor_id, v.name vendor, w.category, w.title, to_char(w.date,'YYYY-MM-DD') date, to_char(w.start_date,'YYYY-MM-DD') start_date, to_char(w.end_date,'YYYY-MM-DD') end_date,
    w.retention_pct::float retention_pct, w.advance_pct::float advance_pct, w.vat_rate::float vat_rate, w.account, a.name account_name, w.approver_id, w.approver_label, ap.name approver_name, to_char(w.approved_at,'YYYY-MM-DD') approved_at, w.notes, w.created_by, u.name created_by_name,
    coalesce((select sum(round(l.qty * l.rate, 2)) from work_order_lines l where l.work_order_id = w.id), 0)::float amount
  from work_orders w join projects p on p.id = w.project_id left join parties v on v.id = w.vendor_id left join accounts a on a.code = w.account left join users ap on ap.id = w.approver_id left join users u on u.id = w.created_by`;
export const listWorkOrders = (f: { project?: string; vendor?: string } = {}) => sql<WORow[]>`${woSelect} where (${f.project || null}::text is null or w.project_id = ${f.project || null}) and (${f.vendor || null}::text is null or w.vendor_id = ${f.vendor || null}) order by w.date desc, w.no desc limit 500`;
export const getWorkOrder = async (id: string) => (await sql<WORow[]>`${woSelect} where w.id = ${id}`)[0] ?? null;
export const getWOLines = (id: string) => sql<{ id: string; line_no: number; item: string; unit: string; qty: number; rate: number }[]>`select id::text id, line_no, item, unit, qty::float qty, rate::float rate from work_order_lines where work_order_id = ${id} order by line_no`;
export const getWOApprovals = (id: string) => sql<{ step: string; step_name: string; who: string | null; at: string }[]>`
  select a.step, a.step_name, u.name who, to_char(a.at,'YYYY-MM-DD') at from work_order_approvals a left join users u on u.id = a.user_id where a.work_order_id = ${id} order by a.at`;
const WO_STATE: Record<string, string> = { draft: 'Draft', head: 'Department head', management: 'Management', approved: 'Issued', rejected: 'Returned', cancelled: 'Cancelled', closed: 'Closed' };
export const woState = (w: Pick<WORow, 'status' | 'approver_label'>) => w.status === 'head' ? `Waiting for ${w.approver_label ?? 'the department head'}` : w.status === 'management' ? 'Waiting for Management' : WO_STATE[w.status] ?? w.status;
/** The money on a work order: the amount, VAT, the retention held back and the advance paid up front. */
export const woFigures = (w: Pick<WORow, 'amount' | 'vat_rate' | 'retention_pct' | 'advance_pct'>) => ({
  amount: r2(w.amount), vat: r2(w.amount * w.vat_rate / 100), retention: r2(w.amount * w.retention_pct / 100), advance: r2(w.amount * w.advance_pct / 100),
});

// ---------------------------------------------------------------- committed cost against the BOQ budget
export type BudgetRow = { code: string | null; name: string; budget: number; po: number; wo: number; committed: number; actual: number; remaining: number; over: boolean };
/** Per GL code of a project: the BOQ budget, what is committed on POs and work orders, what is posted, and whether it is over. */
export async function committedVsBudget(projectId: string) {
  const rows = await sql<{ code: string | null; name: string | null; budget: number; po: number; wo: number; actual: number }[]>`
    with boq as (select l.account code, sum(l.amount) amount from boq_lines l join boqs b on b.id = l.boq_id where b.project_id = ${projectId} group by l.account),
    po as (select l.account code, sum(round(l.qty * l.price, 2)) amount from purchase_request_lines l join purchase_requests r on r.id = l.request_id and r.status = 'approved' where r.project_id = ${projectId} group by l.account),
    wo as (select w.account code, sum(round(l.qty * l.rate, 2)) amount from work_order_lines l join work_orders w on w.id = l.work_order_id and w.status in ('approved', 'closed') where w.project_id = ${projectId} group by w.account),
    actual as (select l.account code, sum(l.dr - l.cr) amount from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.code = l.account and a.type = 'expense' where l.project_id = ${projectId} group by l.account),
    codes as (select code from boq union select code from po union select code from wo union select code from actual)
    select c.code, a.name, coalesce(boq.amount, 0)::float budget, coalesce(po.amount, 0)::float po, coalesce(wo.amount, 0)::float wo, coalesce(actual.amount, 0)::float actual
    from codes c left join accounts a on a.code = c.code left join boq on boq.code is not distinct from c.code left join po on po.code is not distinct from c.code left join wo on wo.code is not distinct from c.code left join actual on actual.code = c.code
    order by c.code nulls last`;
  const out: BudgetRow[] = rows.map(r => {
    const committed = r2(r.po + r.wo), used = Math.max(committed, r.actual);
    return { code: r.code, name: r.code ? r.name ?? r.code : 'Not matched to a GL code yet', budget: r2(r.budget), po: r2(r.po), wo: r2(r.wo), committed, actual: r2(r.actual), remaining: r2(r.budget - used), over: used > r.budget + 0.004 };
  }).filter(r => r.budget || r.committed || r.actual);
  const sum = (k: 'budget' | 'po' | 'wo' | 'committed' | 'actual' | 'remaining') => r2(out.reduce((t, r) => t + r[k], 0));
  return { rows: out, total: { budget: sum('budget'), po: sum('po'), wo: sum('wo'), committed: sum('committed'), actual: sum('actual'), remaining: sum('remaining'), over: out.filter(r => r.over).length } };
}
/** Every project with a budget or commitments, summarised. */
export async function budgetSummary() {
  const projects = await sql<{ id: string; code: string; name: string }[]>`
    select p.id, p.code, p.name from projects p where not p.is_office and (exists (select 1 from boqs b where b.project_id = p.id) or exists (select 1 from purchase_requests r where r.project_id = p.id and r.status = 'approved') or exists (select 1 from work_orders w where w.project_id = p.id and w.status in ('approved','closed'))) order by p.code`;
  const out = [];
  for (const p of projects) out.push({ ...p, ...(await committedVsBudget(p.id)).total });
  return out;
}

// ---------------------------------------------------------------- reports
export type OpenPO = { id: string; no: string; po_no: string; po_date: string; cc: string | null; vendor: string | null; buyer: string | null; subtotal: number; delivered: number; received: number; due: string | null; state: DeliveryState; late: number };
/** Open purchase orders with where their delivery stands. */
export async function openPOs(now = today()): Promise<OpenPO[]> {
  const rows = await sql<{ id: string; no: string; po_no: string; po_date: string; cc: string | null; vendor: string | null; buyer: string | null; subtotal: number; delivered: number; received: number; due: string | null; full: boolean; any: boolean }[]>`
    select r.id, r.no, r.po_no, to_char(r.po_date,'YYYY-MM-DD') po_date, coalesce(p.code, d.name) cc, v.name vendor, b.name buyer,
      coalesce((select sum(round(l.qty * l.price, 2)) from purchase_request_lines l where l.request_id = r.id), 0)::float subtotal,
      coalesce((select sum(round(dl.qty * l.price, 2)) from delivery_lines dl join purchase_request_lines l on l.id = dl.line_id where l.request_id = r.id), 0)::float delivered,
      coalesce((select sum(i.subtotal) from invoices i where i.po_id = r.id and i.status = 'posted'), 0)::float received,
      to_char(coalesce(r.delivery_date, r.needed_by),'YYYY-MM-DD') due,
      not exists (select 1 from purchase_request_lines l where l.request_id = r.id and l.qty - coalesce((select sum(dl.qty) from delivery_lines dl where dl.line_id = l.id), 0) > 0.0005) "full",
      exists (select 1 from delivery_lines dl join purchase_request_lines l on l.id = dl.line_id where l.request_id = r.id) "any"
    from purchase_requests r left join projects p on p.id = r.project_id left join departments d on d.id = r.dept_id left join parties v on v.id = r.vendor_id left join users b on b.id = r.buyer_id
    where r.status = 'approved' and not r.closed order by coalesce(r.delivery_date, r.needed_by) nulls last, r.po_no`;
  return rows.map(({ full, any, ...r }) => { const state: DeliveryState = full ? 'full' : any ? 'part' : 'none'; return { ...r, state, late: r.due && state !== 'full' && now > r.due ? daysBetween(r.due, now) - 1 : 0 }; });
}
/** Open POs due within the week, the late ones first. */
export const deliveriesDue = async (now = today(), days = 7) => (await openPOs(now)).filter(po => po.state !== 'full' && po.due && po.due <= addDays(now, days));

export type SpendRow = { id: string | null; name: string; invoices: number; amount: number; vat: number };
/** Posted vendor invoices per vendor (before VAT) in a period. */
export const spendByVendor = (from: string, to: string) => sql<SpendRow[]>`
  select v.id, coalesce(v.name, '(no vendor)') name, count(*)::int invoices, coalesce(sum(i.subtotal), 0)::float amount, coalesce(sum(i.vat), 0)::float vat
  from invoices i left join parties v on v.id = i.party_id where i.kind = 'purchase' and i.status = 'posted' and i.date between ${from} and ${to} group by v.id, v.name order by amount desc`;
/** Posted vendor invoices per project or department (before VAT) in a period. */
export const spendByProject = (from: string, to: string) => sql<SpendRow[]>`
  select coalesce(p.id, d.id) id, coalesce(p.code, d.name, '(none)') name, count(*)::int invoices, coalesce(sum(i.subtotal), 0)::float amount, coalesce(sum(i.vat), 0)::float vat
  from invoices i left join projects p on p.id = i.project_id left join departments d on d.id = i.dept_id where i.kind = 'purchase' and i.status = 'posted' and i.date between ${from} and ${to}
  group by p.id, p.code, d.id, d.name order by amount desc`;
export const lineTotal = lineAmount;
