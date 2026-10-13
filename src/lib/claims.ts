import 'server-only';
import { sql, type Tx } from './db';
import { r2, fmt } from './money';
import { RuleError } from './ledger';
import { type User, hasRole } from './roles';
import { audit, nextNo } from './books';
import { holdersOf } from './org';
import { TZ, today } from './dates';
import { isProcurement } from './purchasing';
import { savePaymentRequest } from './documents';
import { saveSalesInvoice } from './sales';
import { projectAccounts } from './boq';
import { onSiteTeam } from './planning';
import { committedVsBudget } from './procurement';
import { saveTask } from './tasks';

// Progress claims and cost control (Adel's item 20 and the Technical Office proposal of 2026-10-13).
// A subcontractor's claim follows his form (نموذج مستخلص): the site engineer certifies the quantities (previous, current,
// cumulative, execution %), Procurement prices the items, Finance raises the payment request, which then takes the usual
// approvals and is paid by bank transfer. A client claim certifies the work done per BOQ line and Finance invoices the period.
// Variation orders the client approves join the BOQ and the contract. Budget alerts are tasks for Cost control.

const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d\d-\d\d$/.test(s);
const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const pct = (v: number | string | null | undefined, name: string, dflt: number) => {
  const n = v === '' || v == null ? dflt : Number(v);
  if (!(n >= 0 && n <= 100)) throw new RuleError(`${name} is a percentage from 0 to 100.`);
  return n;
};
export const canEngineer = (u: User) => hasRole(u, 'engineering', 'projects');
/** Rows on the claim form (his sheet has six; twelve leave room). */
export const CLAIM_ROWS = 12;
/** Rows on the variation order form. */
export const VO_ROWS = 8;
/** Who certifies a project's claims: the engineers, or the project's own site engineer and manager. */
export const canCertify = async (u: User, projectId: string, tx: Tx = sql) => canEngineer(u) || (await onSiteTeam(projectId, u.id, tx));

// ---------------------------------------------------------------- the figures of a claim (his form, columns D to I and rows 12 to 17)
export type ClaimLineFig = { rate: number; current_qty: number; previous_qty: number; pct: number };
/** G = E + F: the cumulative quantity. */
export const cumQty = (l: ClaimLineFig) => r3(Number(l.current_qty) + Number(l.previous_qty));
/** I = H × G × D: the amount of a line. */
export const claimLineAmount = (l: ClaimLineFig) => r2(Number(l.pct) / 100 * cumQty(l) * Number(l.rate));
/** What the earlier claims of the same subcontractor on the same work add up to: cumulative gross, retention held, advance recovered, net paid. */
export type Previous = { gross: number; retention: number; advance: number; net: number; claimId: string | null };
export const NO_PREVIOUS: Previous = { gross: 0, retention: 0, advance: 0, net: 0, claimId: null };
export type ClaimFigures = { gross: number; previously_paid: number; advance: number; advance_cum: number; retention: number; deductions: number; net: number; period_work: number; period_retention: number };
/**
 * The totals: gross (I12) is the cumulative work; less what the earlier claims paid (I13), the advance recovered to date (I14) and
 * the retention on the cumulative work (I15); the net (I17) is what this claim pays. It equals this period's work less its retention
 * and this claim's advance recovery, which is how the payment request is built.
 */
export function claimFigures(lines: ClaimLineFig[], c: { retention_pct: number; advance: number }, prev: Previous = NO_PREVIOUS): ClaimFigures {
  const gross = r2(lines.reduce((s, l) => s + claimLineAmount(l), 0));
  const retention = r2(gross * Number(c.retention_pct) / 100);
  const advance = r2(c.advance), advance_cum = r2(prev.advance + advance);
  const previously_paid = r2(prev.net);
  const deductions = r2(previously_paid + advance_cum + retention);
  return { gross, previously_paid, advance, advance_cum, retention, deductions, net: r2(gross - deductions), period_work: r2(gross - prev.gross), period_retention: r2(retention - prev.retention) };
}

// ---------------------------------------------------------------- subcontractor claims
export type SubClaimRow = {
  id: string; no: string; project_id: string; code: string; project_name: string; vendor_id: string; vendor: string; work_order_id: string | null; wo_no: string | null; wo_title: string | null;
  trade: string; claim_no: number; date: string; status: string; retention_pct: number; advance: number; vat_rate: number; account: string | null; account_name: string | null; notes: string;
  certified_by: string | null; certified_by_name: string | null; certified_at: string | null; priced_by_name: string | null; priced_at: string | null;
  request_id: string | null; request_no: string | null; request_status: string | null; request_net: number | null; request_paid: number | null;
  created_by: string | null; created_by_name: string | null; created_at: string; gross: number;
};
const claimSelect = sql`
  select c.id, c.no, c.project_id, p.code, p.name project_name, c.vendor_id, v.name vendor, c.work_order_id, w.no wo_no, w.title wo_title, c.trade, c.claim_no, to_char(c.date,'YYYY-MM-DD') date, c.status,
    c.retention_pct::float retention_pct, c.advance::float advance, c.vat_rate::float vat_rate, c.account, a.name account_name, c.notes,
    c.certified_by, ce.name certified_by_name, to_char(c.certified_at at time zone ${TZ},'YYYY-MM-DD') certified_at, pr.name priced_by_name, to_char(c.priced_at at time zone ${TZ},'YYYY-MM-DD') priced_at,
    c.request_id, i.no request_no, i.status request_status, i.net::float request_net, case when i.id is null then null else invoice_paid(i.id)::float end request_paid,
    c.created_by, u.name created_by_name, to_char(c.created_at at time zone ${TZ},'YYYY-MM-DD') created_at,
    coalesce((select sum(round(l.pct / 100 * (l.current_qty + l.previous_qty) * l.rate, 2)) from sub_claim_lines l where l.claim_id = c.id), 0)::float gross
  from sub_claims c join projects p on p.id = c.project_id join parties v on v.id = c.vendor_id left join work_orders w on w.id = c.work_order_id left join accounts a on a.code = c.account
  left join users ce on ce.id = c.certified_by left join users pr on pr.id = c.priced_by left join users u on u.id = c.created_by left join invoices i on i.id = c.request_id`;
export const listSubClaims = (f: { project?: string; vendor?: string; status?: string } = {}) => sql<SubClaimRow[]>`${claimSelect}
  where (${f.project || null}::text is null or c.project_id = ${f.project || null}) and (${f.vendor || null}::text is null or c.vendor_id = ${f.vendor || null}) and (${f.status || null}::text is null or c.status = ${f.status || null})
  order by c.date desc, c.no desc limit 500`;
export const getSubClaim = async (id: string, tx: Tx = sql) => (await tx<SubClaimRow[]>`${claimSelect} where c.id = ${id}`)[0] ?? null;
export type SubClaimLine = { id: string; line_no: number; wo_line_id: string | null; item: string; unit: string; rate: number; current_qty: number; previous_qty: number; pct: number; notes: string };
export const getSubClaimLines = (id: string, tx: Tx = sql) => tx<SubClaimLine[]>`
  select id::text id, line_no, wo_line_id::text wo_line_id, item, unit, rate::float rate, current_qty::float current_qty, previous_qty::float previous_qty, pct::float pct, notes
  from sub_claim_lines where claim_id = ${id} order by line_no`;
const STATE: Record<string, string> = { draft: 'Draft', pricing: 'With Procurement for pricing', finance: 'With Finance', requested: 'Payment request raised', returned: 'Returned to the engineer', cancelled: 'Cancelled' };
export const claimState = (c: Pick<SubClaimRow, 'status' | 'request_status' | 'request_net' | 'request_paid'>) =>
  c.status === 'requested' && c.request_status === 'posted' && (c.request_paid ?? 0) >= (c.request_net ?? 0) - 0.004 ? 'Paid'
  : c.status === 'requested' && c.request_status === 'posted' ? 'Approved, awaiting payment'
  : c.status === 'requested' && c.request_status === 'pending' ? 'Payment request in approval'
  : STATE[c.status] ?? c.status;

/** The earlier certified claims of the same subcontractor on the same work order (or the same project when none): the figures the deductions need. */
async function previousFor(tx: Tx, c: { project_id: string; vendor_id: string; work_order_id: string | null; claim_no: number }): Promise<Previous> {
  const rows = await tx<{ id: string; retention_pct: number; advance: number; gross: number }[]>`
    select c.id, c.retention_pct::float retention_pct, c.advance::float advance,
      coalesce((select sum(round(l.pct / 100 * (l.current_qty + l.previous_qty) * l.rate, 2)) from sub_claim_lines l where l.claim_id = c.id), 0)::float gross
    from sub_claims c where c.project_id = ${c.project_id} and c.vendor_id = ${c.vendor_id} and coalesce(c.work_order_id, '') = ${c.work_order_id ?? ''}
      and c.status in ('pricing', 'finance', 'requested') and c.claim_no < ${c.claim_no} order by c.claim_no`;
  if (!rows.length) return NO_PREVIOUS;
  const last = rows[rows.length - 1];
  const advance = r2(rows.reduce((s, r) => s + r.advance, 0));
  const retention = r2(last.gross * last.retention_pct / 100);
  return { gross: last.gross, retention, advance, net: r2(last.gross - retention - advance), claimId: last.id };
}
/** A claim with its lines, its figures and what the earlier claims settled. */
export async function subClaimFull(id: string) {
  const c = await getSubClaim(id);
  if (!c) return null;
  const lines = await getSubClaimLines(id);
  const prev = await previousFor(sql, c);
  return { c, lines, prev, fig: claimFigures(lines, c, prev) };
}

export type SubClaimLineInput = { wo_line_id?: string | null; item: string; unit?: string; rate?: number | string; current_qty: number | string; previous_qty?: number | string; pct?: number | string; notes?: string };
export type SubClaimInput = { id?: string; project: string; vendor?: string; work_order?: string | null; trade?: string; date: string; retention_pct?: number | string; advance?: number | string; vat_rate?: number | string; account?: string | null; notes?: string; lines: SubClaimLineInput[] };

/**
 * What a new claim starts from: the subcontractor's work order items with their rates (or the previous claim's items), the
 * previous quantities already certified, the retention and VAT of the work order, and the next claim number.
 */
export async function claimTemplate(projectId: string, vendorId: string, workOrderId: string | null) {
  const [wo] = workOrderId ? await sql<{ id: string; vendor_id: string | null; title: string; category: string; retention_pct: number; advance_pct: number; vat_rate: number; account: string | null; amount: number }[]>`
    select w.id, w.vendor_id, w.title, w.category, w.retention_pct::float retention_pct, w.advance_pct::float advance_pct, w.vat_rate::float vat_rate, w.account,
      coalesce((select sum(round(l.qty * l.rate, 2)) from work_order_lines l where l.work_order_id = w.id), 0)::float amount from work_orders w where w.id = ${workOrderId}` : [];
  const [{ next }] = await sql<{ next: number }[]>`select coalesce(max(claim_no), 0)::int + 1 next from sub_claims where project_id = ${projectId} and vendor_id = ${vendorId} and coalesce(work_order_id, '') = ${workOrderId ?? ''} and status <> 'cancelled'`;
  const prev = await previousFor(sql, { project_id: projectId, vendor_id: vendorId, work_order_id: workOrderId, claim_no: next });
  const prevLines = prev.claimId ? await getSubClaimLines(prev.claimId) : [];
  let lines: SubClaimLineInput[];
  if (prevLines.length) {
    lines = prevLines.map(l => ({ wo_line_id: l.wo_line_id, item: l.item, unit: l.unit, rate: l.rate, current_qty: 0, previous_qty: cumQty(l), pct: l.pct, notes: '' }));
  } else if (wo) {
    const wl = await sql<{ id: string; item: string; unit: string; rate: number }[]>`select id::text id, item, unit, rate::float rate from work_order_lines where work_order_id = ${wo.id} order by line_no`;
    lines = wl.map(l => ({ wo_line_id: l.id, item: l.item, unit: l.unit, rate: l.rate, current_qty: 0, previous_qty: 0, pct: 100, notes: '' }));
  } else lines = [];
  return { wo: wo ?? null, claim_no: next, prev, lines, retention_pct: wo?.retention_pct ?? 5, vat_rate: wo?.vat_rate ?? 0, account: wo?.account ?? null, trade: wo?.title ?? '' };
}

/** The engineer saves a claim (new, draft or returned): the items, the quantities of this period, the execution % and the notes. */
export async function saveSubClaim(user: User, i: SubClaimInput) {
  return sql.begin(async tx => {
    const [p] = await tx<{ id: string; code: string; is_office: boolean }[]>`select id, code, is_office from projects where id = ${i.project}`;
    if (!p || p.is_office) throw new RuleError('Choose the project.');
    if (!(await canCertify(user, p.id, tx)) && !(await isProcurement(user, tx))) throw new RuleError('Only the engineers or Procurement raise progress claims.');
    const wo = i.work_order ? (await tx<{ id: string; vendor_id: string | null; project_id: string; status: string; account: string | null }[]>`select id, vendor_id, project_id, status, account from work_orders where id = ${i.work_order}`)[0] : null;
    if (i.work_order && !wo) throw new RuleError('Work order not found.');
    if (wo && wo.project_id !== p.id) throw new RuleError('That work order belongs to another project.');
    if (wo && !['approved', 'closed'].includes(wo.status)) throw new RuleError('Claims are made against issued work orders only.');
    const vendorId = wo?.vendor_id ?? i.vendor ?? '';
    const [v] = await tx`select 1 from parties where id = ${vendorId} and type = 'vendor'`;
    if (!v) throw new RuleError('Choose the subcontractor from the vendor list.');
    if (!isDate(i.date)) throw new RuleError('Pick the date of the claim.');
    const retention = pct(i.retention_pct, 'Retention', 5), vat = pct(i.vat_rate, 'VAT', 0);
    const advance = r2(Number(i.advance) || 0);
    if (advance < 0) throw new RuleError('The advance recovered cannot be negative.');
    const account = i.account || wo?.account || null; // the work order's code unless the engineer or Procurement picked one
    if (account) { const codes = await projectAccounts(p.id); if (!codes.some(c => c.code === account)) throw new RuleError(`GL code ${account} is not one of ${p.code}'s codes.`); }
    const lines = i.lines.map(l => ({
      wo_line_id: l.wo_line_id || null, item: (l.item ?? '').trim(), unit: (l.unit ?? '').trim(), rate: r2(Number(l.rate) || 0),
      current_qty: r3(Number(l.current_qty) || 0), previous_qty: r3(Number(l.previous_qty) || 0), pct: pct(l.pct, 'Execution %', 100), notes: (l.notes ?? '').trim(),
    })).filter(l => l.item || l.current_qty || l.previous_qty);
    if (!lines.length) throw new RuleError('Add at least one item with a quantity.');
    for (const l of lines) {
      if (!l.item) throw new RuleError('Every item needs a description.');
      if (l.current_qty < 0 || l.previous_qty < 0) throw new RuleError(`${l.item}: quantities cannot be negative.`);
      if (l.rate < 0) throw new RuleError(`${l.item}: the rate cannot be negative.`);
    }
    let id = i.id, no: string, claim_no: number;
    if (id) {
      const [old] = await tx<{ status: string; no: string; claim_no: number; created_by: string | null }[]>`select status, no, claim_no, created_by from sub_claims where id = ${id} for update`;
      if (!old) throw new RuleError('Claim not found.');
      if (!['draft', 'returned'].includes(old.status)) throw new RuleError('Only a draft or a returned claim can be edited.');
      no = old.no; claim_no = old.claim_no;
    } else {
      no = await nextNo(tx, 'SC-');
      [{ claim_no }] = await tx<{ claim_no: number }[]>`select coalesce(max(claim_no), 0)::int + 1 claim_no from sub_claims where project_id = ${p.id} and vendor_id = ${vendorId} and coalesce(work_order_id, '') = ${wo?.id ?? ''} and status <> 'cancelled'`;
    }
    const vals = { project_id: p.id, vendor_id: vendorId, work_order_id: wo?.id ?? null, trade: (i.trade ?? '').trim(), date: i.date, retention_pct: retention, advance, vat_rate: vat, account, notes: (i.notes ?? '').trim() };
    if (id) {
      await tx`update sub_claims set ${tx(vals)}, status = 'draft' where id = ${id}`;
      await tx`delete from sub_claim_lines where claim_id = ${id}`;
    } else {
      [{ id }] = await tx<{ id: string }[]>`insert into sub_claims ${tx({ ...vals, no, claim_no, created_by: user.id })} returning id`;
    }
    for (const [k, l] of lines.entries()) await tx`insert into sub_claim_lines ${tx({ ...l, claim_id: id!, line_no: k + 1 })}`;
    await audit(tx, user, 'claim', id!, i.id ? 'Edited' : 'Created', `claim ${claim_no} · ${lines.length} items`);
    return id!;
  });
}

/** The engineer certifies the quantities and sends the claim to Procurement for pricing. */
export async function submitSubClaim(user: User, id: string) {
  await sql.begin(async tx => {
    const c = await getSubClaim(id, tx);
    if (!c) throw new RuleError('Claim not found.');
    if (!['draft', 'returned'].includes(c.status)) throw new RuleError('This claim was already sent.');
    if (!(await canCertify(user, c.project_id, tx))) throw new RuleError('Only the engineers certify the quantities.');
    const lines = await getSubClaimLines(id, tx);
    if (!lines.some(l => l.current_qty > 0)) throw new RuleError('Nothing was done this period: enter the current quantity on at least one item.');
    await tx`update sub_claims set status = 'pricing', certified_by = ${user.id}, certified_at = now() where id = ${id}`;
    await audit(tx, user, 'claim', id, 'Quantities certified', 'sent to Procurement for pricing');
  });
}

/** Procurement prices the items (the rates) and the GL code, then sends the claim to Finance. */
export async function priceSubClaim(user: User, id: string, p: { rates: Record<string, number | string>; account?: string | null; vat_rate?: number | string; retention_pct?: number | string; advance?: number | string; send: boolean }) {
  await sql.begin(async tx => {
    if (!(await isProcurement(user, tx))) throw new RuleError('Only Procurement prices the claims.');
    const c = await getSubClaim(id, tx);
    if (!c) throw new RuleError('Claim not found.');
    if (c.status !== 'pricing') throw new RuleError('This claim is not with Procurement.');
    const lines = await getSubClaimLines(id, tx);
    for (const l of lines) {
      if (!(l.id in p.rates)) continue;
      const rate = r2(Number(p.rates[l.id]));
      if (!(rate >= 0)) throw new RuleError(`${l.item}: the rate must be a number.`);
      await tx`update sub_claim_lines set rate = ${rate} where id = ${l.id}`;
    }
    const account = p.account === undefined ? c.account : p.account || null;
    if (account) { const codes = await projectAccounts(c.project_id); if (!codes.some(x => x.code === account)) throw new RuleError(`GL code ${account} is not one of ${c.code}'s codes.`); }
    const vat = pct(p.vat_rate ?? c.vat_rate, 'VAT', c.vat_rate), retention = pct(p.retention_pct ?? c.retention_pct, 'Retention', c.retention_pct);
    const advance = p.advance === undefined || p.advance === '' ? c.advance : r2(Number(p.advance) || 0);
    if (advance < 0) throw new RuleError('The advance recovered cannot be negative.');
    await tx`update sub_claims set account = ${account}, vat_rate = ${vat}, retention_pct = ${retention}, advance = ${advance} where id = ${id}`;
    if (p.send) {
      const after = await getSubClaimLines(id, tx);
      if (after.some(l => l.current_qty > 0 && !l.rate)) throw new RuleError('Every item done this period needs a rate before the claim goes to Finance.');
      if (!account) throw new RuleError("Pick the project's GL code the work posts to.");
      const fig = claimFigures(after, { retention_pct: retention, advance }, await previousFor(tx, c));
      if (fig.net <= 0) throw new RuleError(`Nothing is payable on this claim (net ${fmt(fig.net)}): check the rates, the advance and the retention.`);
      await tx`update sub_claims set status = 'finance', priced_by = ${user.id}, priced_at = now() where id = ${id}`;
      await audit(tx, user, 'claim', id, 'Priced', `net ${fmt(fig.net)} · sent to Finance`);
    } else await audit(tx, user, 'claim', id, 'Rates saved');
  });
}

/** Procurement or Finance return a claim to the engineer with a reason. */
export async function returnSubClaim(user: User, id: string, reason: string) {
  await sql.begin(async tx => {
    const c = await getSubClaim(id, tx);
    if (!c) throw new RuleError('Claim not found.');
    if (!['pricing', 'finance'].includes(c.status)) throw new RuleError('This claim is not waiting for anyone.');
    if (c.status === 'pricing' ? !(await isProcurement(user, tx)) : !hasRole(user, 'finance')) throw new RuleError('Only the person the claim is waiting for can return it.');
    await tx`update sub_claims set status = 'returned' where id = ${id}`;
    await audit(tx, user, 'claim', id, 'Returned for changes', reason.trim());
  });
}
export async function cancelSubClaim(user: User, id: string) {
  await sql.begin(async tx => {
    const c = await getSubClaim(id, tx);
    if (!c) throw new RuleError('Claim not found.');
    if (c.status === 'requested') throw new RuleError('A payment request was raised from this claim: void that first.');
    if (c.status === 'cancelled') return;
    if (c.created_by !== user.id && !hasRole(user, 'finance') && !(await isProcurement(user, tx))) throw new RuleError('Only the person who raised it, Procurement or Finance can cancel it.');
    await tx`update sub_claims set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'claim', id, 'Cancelled');
  });
}

/**
 * Finance raises the payment request from a priced claim: one line per item for this period's work (this claim's amount less the
 * previous claim's on the same item), the retention % and this claim's advance recovery as deductions, the VAT of the work order.
 * It is saved as a draft for Finance to check (withholding tax, due date) and submit into the usual approvals.
 */
export async function raisePaymentRequest(user: User, id: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance raises the payment request.');
  const full = await subClaimFull(id);
  if (!full) throw new RuleError('Claim not found.');
  const { c, lines, prev, fig } = full;
  if (c.status !== 'finance') throw new RuleError('Only a priced claim with Finance can be raised.');
  if (!c.account) throw new RuleError('The claim has no GL code: return it to Procurement.');
  if (fig.net <= 0) throw new RuleError('Nothing is payable on this claim.');
  const prevLines = prev.claimId ? await getSubClaimLines(prev.claimId) : [];
  const key = (l: SubClaimLine) => l.wo_line_id ?? l.item.trim().toLowerCase();
  const before = new Map(prevLines.map(l => [key(l), claimLineAmount(l)]));
  const items = lines.map(l => ({ acc: c.account!, desc: `${c.no} · ${l.item}${l.unit ? ` · ${cumQty(l)} ${l.unit} to date` : ''}`, qty: 1, price: r2(claimLineAmount(l) - (before.get(key(l)) ?? 0)), project: c.project_id })).filter(l => l.price !== 0);
  const reqId = await savePaymentRequest(user, {
    date: today(), party: c.vendor_id, project: c.project_id, ref: `${c.no} · claim ${c.claim_no}${c.wo_no ? ` · ${c.wo_no}` : ''}`, requester: c.certified_by_name,
    vatRate: c.vat_rate, whtRate: 0, siRate: 0, retRate: c.retention_pct, dpAmount: fig.advance, lines: items,
  }, false);
  await sql.begin(async tx => {
    await tx`update sub_claims set status = 'requested', request_id = ${reqId} where id = ${id}`;
    await audit(tx, user, 'claim', id, 'Payment request raised', `net ${fmt(fig.net)}`);
  });
  return reqId;
}

/** The claims waiting for this person: with Procurement for pricing, or with Finance for the payment request. */
export async function claimsWaitingFor(user: User) {
  const proc = await isProcurement(user);
  const fin = hasRole(user, 'finance');
  if (!proc && !fin) return [];
  const rows = await sql<SubClaimRow[]>`${claimSelect} where c.status in ('pricing', 'finance') order by c.date`;
  return rows.filter(r => (r.status === 'pricing' ? proc : fin));
}
/** Open work orders a claim can be made against, with the subcontractor. */
export const claimableWorkOrders = (projectId?: string) => sql<{ id: string; no: string; title: string; project_id: string; code: string; vendor_id: string | null; vendor: string | null }[]>`
  select w.id, w.no, w.title, w.project_id, p.code, w.vendor_id, v.name vendor from work_orders w join projects p on p.id = w.project_id left join parties v on v.id = w.vendor_id
  where w.status = 'approved' and (${projectId || null}::text is null or w.project_id = ${projectId || null}) order by p.code, w.no`;

// ---------------------------------------------------------------- client claims against the BOQ
export type BoqClaimLine = { id: string; item_no: string; description: string; unit: string; qty: number; rate: number; amount: number; account: string | null; vo_id: string | null; vo_no: string | null; prev_pct: number; pct: number };
/** The project's BOQ lines (variation orders included) with the % certified on the last claim and on the given claim. */
export async function boqForClaim(projectId: string, claimId: string | null, tx: Tx = sql): Promise<BoqClaimLine[]> {
  return tx<BoqClaimLine[]>`
    with last as (select c.id from client_claims c where c.project_id = ${projectId} and c.status in ('certified', 'invoiced') and c.id <> ${claimId ?? ''} order by c.claim_no desc limit 1)
    select l.id::text id, l.item_no, l.description, l.unit, l.qty::float qty, l.rate::float rate, l.amount::float amount, l.account, l.vo_id, vo.no vo_no,
      coalesce((select x.pct::float from client_claim_lines x where x.boq_line_id = l.id and x.claim_id = (select id from last)), 0) prev_pct,
      coalesce((select y.pct::float from client_claim_lines y where y.boq_line_id = l.id and y.claim_id = ${claimId ?? ''}), 0) pct
    from boq_lines l join boqs b on b.id = l.boq_id left join variation_orders vo on vo.id = l.vo_id where b.project_id = ${projectId} order by l.line_no`;
}
export type ClientClaimRow = {
  id: string; no: string; project_id: string; code: string; project_name: string; client_id: string | null; client: string | null; contract: number | null; claim_no: number; date: string; status: string;
  retention_pct: number; advance: number; notes: string; certified_by_name: string | null; certified_at: string | null; invoice_id: string | null; invoice_no: string | null; invoice_status: string | null; invoice_total: number | null; collected: number | null;
  created_by: string | null; created_by_name: string | null; gross: number;
};
const ccSelect = sql`
  select c.id, c.no, c.project_id, p.code, p.name project_name, p.client_id, coalesce(k.full_name, k.name) client, p.contract::float contract, c.claim_no, to_char(c.date,'YYYY-MM-DD') date, c.status,
    c.retention_pct::float retention_pct, c.advance::float advance, c.notes, ce.name certified_by_name, to_char(c.certified_at at time zone ${TZ},'YYYY-MM-DD') certified_at,
    c.invoice_id, i.no invoice_no, i.status invoice_status, i.total::float invoice_total, case when i.id is null then null else invoice_paid(i.id)::float end collected, c.created_by, u.name created_by_name,
    coalesce((select sum(round(x.pct / 100 * l.amount, 2)) from client_claim_lines x join boq_lines l on l.id = x.boq_line_id where x.claim_id = c.id), 0)::float gross
  from client_claims c join projects p on p.id = c.project_id left join parties k on k.id = p.client_id left join users ce on ce.id = c.certified_by left join users u on u.id = c.created_by left join invoices i on i.id = c.invoice_id`;
export const listClientClaims = (f: { project?: string } = {}) => sql<ClientClaimRow[]>`${ccSelect} where (${f.project || null}::text is null or c.project_id = ${f.project || null}) order by c.date desc, c.no desc limit 500`;
export const getClientClaim = async (id: string, tx: Tx = sql) => (await tx<ClientClaimRow[]>`${ccSelect} where c.id = ${id}`)[0] ?? null;
const CC_STATE: Record<string, string> = { draft: 'Draft', certified: 'Certified, with Finance', invoiced: 'Invoiced', cancelled: 'Cancelled' };
export const clientClaimState = (c: Pick<ClientClaimRow, 'status' | 'invoice_status' | 'invoice_total' | 'collected'>) =>
  c.status === 'invoiced' && c.invoice_status === 'posted' && (c.collected ?? 0) >= (c.invoice_total ?? 0) - 0.004 ? 'Collected' : c.status === 'invoiced' && c.invoice_status === 'draft' ? 'Invoice drafted' : CC_STATE[c.status] ?? c.status;

async function clientPrevious(tx: Tx, c: { project_id: string; claim_no: number }): Promise<Previous> {
  const rows = await tx<{ id: string; retention_pct: number; advance: number; gross: number }[]>`
    select c.id, c.retention_pct::float retention_pct, c.advance::float advance,
      coalesce((select sum(round(x.pct / 100 * l.amount, 2)) from client_claim_lines x join boq_lines l on l.id = x.boq_line_id where x.claim_id = c.id), 0)::float gross
    from client_claims c where c.project_id = ${c.project_id} and c.status in ('certified', 'invoiced') and c.claim_no < ${c.claim_no} order by c.claim_no`;
  if (!rows.length) return NO_PREVIOUS;
  const last = rows[rows.length - 1];
  const advance = r2(rows.reduce((s, r) => s + r.advance, 0)), retention = r2(last.gross * last.retention_pct / 100);
  return { gross: last.gross, retention, advance, net: r2(last.gross - retention - advance), claimId: last.id };
}
const asFig = (l: Pick<BoqClaimLine, 'amount' | 'pct'>): ClaimLineFig => ({ rate: l.amount, current_qty: 1, previous_qty: 0, pct: l.pct });
export async function clientClaimFull(id: string) {
  const c = await getClientClaim(id);
  if (!c) return null;
  const lines = await boqForClaim(c.project_id, id);
  const prev = await clientPrevious(sql, c);
  return { c, lines, prev, fig: claimFigures(lines.map(asFig), c, prev) };
}
/** The defaults of a project's next client claim: the retention % of the project form (else 5), the next number, the BOQ with the % certified so far. */
export async function clientClaimTemplate(projectId: string) {
  const [info] = await sql<{ data: Record<string, string> }[]>`select data from project_info where project_id = ${projectId}`;
  const [{ next }] = await sql<{ next: number }[]>`select coalesce(max(claim_no), 0)::int + 1 next from client_claims where project_id = ${projectId} and status <> 'cancelled'`;
  const ret = Number(info?.data?.retention_pct);
  const lines = await boqForClaim(projectId, null);
  return { claim_no: next, retention_pct: ret >= 0 && ret <= 100 && info?.data?.retention_pct !== '' && info?.data?.retention_pct != null ? ret : 5, lines: lines.map(l => ({ ...l, pct: l.prev_pct })), prev: await clientPrevious(sql, { project_id: projectId, claim_no: next }) };
}
export type ClientClaimInput = { id?: string; project: string; date: string; retention_pct?: number | string; advance?: number | string; notes?: string; pcts: Record<string, number | string> };
/** The engineer saves the work done per BOQ line as a cumulative %; it cannot fall below the previous claim's. */
export async function saveClientClaim(user: User, i: ClientClaimInput) {
  return sql.begin(async tx => {
    const [p] = await tx<{ id: string; code: string; is_office: boolean }[]>`select id, code, is_office from projects where id = ${i.project}`;
    if (!p || p.is_office) throw new RuleError('Choose the project.');
    if (!(await canCertify(user, p.id, tx)) && !hasRole(user, 'finance')) throw new RuleError('Only the engineers or Finance raise client claims.');
    if (!isDate(i.date)) throw new RuleError('Pick the date of the claim.');
    const retention = pct(i.retention_pct, 'Retention', 5), advance = r2(Number(i.advance) || 0);
    if (advance < 0) throw new RuleError('The advance recovered cannot be negative.');
    let id = i.id, no: string, claim_no: number;
    if (id) {
      const [old] = await tx<{ status: string; no: string; claim_no: number }[]>`select status, no, claim_no from client_claims where id = ${id} for update`;
      if (!old) throw new RuleError('Claim not found.');
      if (old.status !== 'draft') throw new RuleError('Only a draft claim can be edited.');
      no = old.no; claim_no = old.claim_no;
    } else {
      no = await nextNo(tx, 'CC-');
      [{ claim_no }] = await tx<{ claim_no: number }[]>`select coalesce(max(claim_no), 0)::int + 1 claim_no from client_claims where project_id = ${p.id} and status <> 'cancelled'`;
    }
    const boq = await boqForClaim(p.id, id ?? null, tx);
    if (!boq.length) throw new RuleError(`${p.code} has no BOQ yet: accept the estimate or upload the BOQ first.`);
    const vals = { project_id: p.id, date: i.date, retention_pct: retention, advance, notes: (i.notes ?? '').trim() };
    if (id) {
      await tx`update client_claims set ${tx(vals)} where id = ${id}`;
      await tx`delete from client_claim_lines where claim_id = ${id}`;
    } else [{ id }] = await tx<{ id: string }[]>`insert into client_claims ${tx({ ...vals, no, claim_no, created_by: user.id })} returning id`;
    let n = 0;
    for (const l of boq) {
      const v = i.pcts[l.id];
      const x = v === undefined || v === '' ? l.prev_pct : Number(v);
      if (!(x >= 0 && x <= 100)) throw new RuleError(`${l.item_no || l.description}: the % done is from 0 to 100.`);
      if (x < l.prev_pct - 0.001) throw new RuleError(`${l.item_no || l.description}: ${x} % is less than the ${l.prev_pct} % already certified on the previous claim.`);
      if (x > l.prev_pct) n++;
      await tx`insert into client_claim_lines (claim_id, boq_line_id, pct) values (${id!}, ${l.id}, ${x})`;
    }
    await audit(tx, user, 'client-claim', id!, i.id ? 'Edited' : 'Created', `claim ${claim_no} · ${n} lines progressed`);
    return id!;
  });
}
/** The engineer certifies the claim: it goes to Finance to invoice. */
export async function certifyClientClaim(user: User, id: string) {
  await sql.begin(async tx => {
    const c = await getClientClaim(id, tx);
    if (!c) throw new RuleError('Claim not found.');
    if (c.status !== 'draft') throw new RuleError('This claim was already certified.');
    if (!(await canCertify(user, c.project_id, tx))) throw new RuleError('Only the engineers certify the work done.');
    const fig = claimFigures((await boqForClaim(c.project_id, id, tx)).map(asFig), c, await clientPrevious(tx, c));
    if (fig.period_work <= 0) throw new RuleError('Nothing new is certified on this claim: raise the % done on the lines progressed.');
    await tx`update client_claims set status = 'certified', certified_by = ${user.id}, certified_at = now() where id = ${id}`;
    await audit(tx, user, 'client-claim', id, 'Certified', `work this period ${fmt(fig.period_work)} · net ${fmt(fig.net)}`);
  });
}
/**
 * Finance invoices the client for the work certified this period (a draft sales invoice to check and post). The retention the client
 * holds and the advance it recovers stay on the invoice as what remains to collect, so the claim shows the amount due now.
 */
export async function invoiceClientClaim(user: User, id: string, p: { category: string; vatRate: number | string; date?: string }) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance invoices the client.');
  const full = await clientClaimFull(id);
  if (!full) throw new RuleError('Claim not found.');
  const { c, fig } = full;
  if (c.status !== 'certified') throw new RuleError('Only a certified claim is invoiced.');
  if (!c.client_id) throw new RuleError(`${c.code} has no customer: set the client on the project first.`);
  if (fig.period_work <= 0) throw new RuleError('Nothing to invoice on this claim.');
  const invId = await saveSalesInvoice(user, {
    date: p.date && isDate(p.date) ? p.date : today(), party: c.client_id, project: c.project_id, category: p.category, ref: `${c.no} · progress claim ${c.claim_no}`, vatRate: pct(p.vatRate, 'VAT', 14),
    lines: [{ acc: '', desc: `Progress claim ${c.claim_no} · work certified to ${c.date}`, qty: 1, price: fig.period_work, project: c.project_id }],
  }, false);
  await sql.begin(async tx => {
    await tx`update client_claims set status = 'invoiced', invoice_id = ${invId} where id = ${id}`;
    await audit(tx, user, 'client-claim', id, 'Invoice drafted', `work this period ${fmt(fig.period_work)}`);
  });
  return invId;
}
export async function cancelClientClaim(user: User, id: string) {
  await sql.begin(async tx => {
    const c = await getClientClaim(id, tx);
    if (!c) throw new RuleError('Claim not found.');
    if (c.status === 'invoiced') throw new RuleError('This claim was invoiced: void the invoice first.');
    if (c.status === 'cancelled') return;
    if (c.created_by !== user.id && !hasRole(user, 'finance') && !canEngineer(user)) throw new RuleError('Only the engineers or Finance cancel a claim.');
    await tx`update client_claims set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'client-claim', id, 'Cancelled');
  });
}

// ---------------------------------------------------------------- variation orders
export type VORow = { id: string; no: string; project_id: string; code: string; project_name: string; title: string; date: string; status: string; client_ref: string; notes: string; decided_by_name: string | null; decided_at: string | null; created_by: string | null; created_by_name: string | null; total: number };
const voSelect = sql`
  select v.id, v.no, v.project_id, p.code, p.name project_name, v.title, to_char(v.date,'YYYY-MM-DD') date, v.status, v.client_ref, v.notes, d.name decided_by_name, to_char(v.decided_at at time zone ${TZ},'YYYY-MM-DD') decided_at,
    v.created_by, u.name created_by_name, coalesce((select sum(round(l.qty * l.rate, 2)) from variation_lines l where l.vo_id = v.id), 0)::float total
  from variation_orders v join projects p on p.id = v.project_id left join users d on d.id = v.decided_by left join users u on u.id = v.created_by`;
export const listVariations = (f: { project?: string } = {}) => sql<VORow[]>`${voSelect} where (${f.project || null}::text is null or v.project_id = ${f.project || null}) order by v.date desc, v.no desc limit 500`;
export const getVariation = async (id: string, tx: Tx = sql) => (await tx<VORow[]>`${voSelect} where v.id = ${id}`)[0] ?? null;
export type VOLine = { id: string; line_no: number; description: string; unit: string; qty: number; rate: number; account: string | null; account_name: string | null; boq_line_id: string | null };
export const getVariationLines = (id: string, tx: Tx = sql) => tx<VOLine[]>`select l.id::text id, l.line_no, l.description, l.unit, l.qty::float qty, l.rate::float rate, l.account, a.name account_name, l.boq_line_id::text boq_line_id from variation_lines l left join accounts a on a.code = l.account where l.vo_id = ${id} order by l.line_no`;
const VO_STATE: Record<string, string> = { draft: 'Draft', sent: 'With the client', approved: 'Approved by the client', rejected: 'Declined by the client', cancelled: 'Cancelled' };
export const voState = (v: Pick<VORow, 'status'>) => VO_STATE[v.status] ?? v.status;
export type VOInput = { id?: string; project: string; title: string; date: string; client_ref?: string; notes?: string; lines: { description: string; unit?: string; qty: number | string; rate: number | string; account?: string | null }[] };
/** The engineers price a change the client asked for; Finance may too. Saved as a draft, edited until it is sent. */
export async function saveVariation(user: User, i: VOInput) {
  return sql.begin(async tx => {
    const [p] = await tx<{ id: string; code: string; is_office: boolean }[]>`select id, code, is_office from projects where id = ${i.project}`;
    if (!p || p.is_office) throw new RuleError('Choose the project.');
    if (!canEngineer(user) && !hasRole(user, 'finance')) throw new RuleError('Only the engineers or Finance raise variation orders.');
    const title = i.title.trim();
    if (!title) throw new RuleError('Give the variation order a title.');
    if (!isDate(i.date)) throw new RuleError('Pick the date.');
    const codes = await projectAccounts(p.id);
    const lines = i.lines.map(l => ({ description: (l.description ?? '').trim(), unit: (l.unit ?? '').trim(), qty: r3(Number(l.qty) || 0), rate: r2(Number(l.rate) || 0), account: l.account || null })).filter(l => l.description || l.qty || l.rate);
    if (!lines.length) throw new RuleError('Add at least one line with a quantity and a rate.');
    for (const l of lines) {
      if (!l.description) throw new RuleError('Every line needs a description.');
      if (!(l.qty !== 0)) throw new RuleError(`${l.description}: the quantity cannot be zero (a negative one takes work out).`);
      if (l.account && !codes.some(c => c.code === l.account)) throw new RuleError(`GL code ${l.account} is not one of ${p.code}'s codes.`);
    }
    let id = i.id, no: string;
    if (id) {
      const [old] = await tx<{ status: string; no: string }[]>`select status, no from variation_orders where id = ${id} for update`;
      if (!old) throw new RuleError('Variation order not found.');
      if (!['draft', 'rejected'].includes(old.status)) throw new RuleError('Only a draft or declined variation order can be edited.');
      no = old.no;
    } else no = await nextNo(tx, 'VO-');
    const vals = { project_id: p.id, title, date: i.date, client_ref: (i.client_ref ?? '').trim(), notes: (i.notes ?? '').trim() };
    if (id) {
      await tx`update variation_orders set ${tx(vals)}, status = 'draft' where id = ${id}`;
      await tx`delete from variation_lines where vo_id = ${id}`;
    } else [{ id }] = await tx<{ id: string }[]>`insert into variation_orders ${tx({ ...vals, no, created_by: user.id })} returning id`;
    for (const [k, l] of lines.entries()) await tx`insert into variation_lines ${tx({ ...l, vo_id: id!, line_no: k + 1 })}`;
    await audit(tx, user, 'variation', id!, i.id ? 'Edited' : 'Created', `${lines.length} lines · ${fmt(lines.reduce((s, l) => s + r2(l.qty * l.rate), 0))}`);
    return id!;
  });
}
export async function sendVariation(user: User, id: string) {
  await sql.begin(async tx => {
    const v = await getVariation(id, tx);
    if (!v) throw new RuleError('Variation order not found.');
    if (v.status !== 'draft') throw new RuleError('This variation order was already sent.');
    if (!canEngineer(user) && !hasRole(user, 'finance')) throw new RuleError('Only the engineers or Finance send variation orders.');
    await tx`update variation_orders set status = 'sent' where id = ${id}`;
    await audit(tx, user, 'variation', id, 'Sent to the client', fmt(v.total));
  });
}
/** The client's answer. Approved: the lines join the project's BOQ (as its budget for the client claims) and the contract grows by their value. */
export async function decideVariation(user: User, id: string, approved: boolean, note = '', clientRef = '') {
  await sql.begin(async tx => {
    const v = await getVariation(id, tx);
    if (!v) throw new RuleError('Variation order not found.');
    if (!['sent', 'draft'].includes(v.status)) throw new RuleError('This variation order was already decided.');
    if (!canEngineer(user) && !hasRole(user, 'finance')) throw new RuleError("Only the engineers or Finance record the client's answer.");
    if (!approved) {
      await tx`update variation_orders set status = 'rejected', decided_by = ${user.id}, decided_at = now(), notes = case when ${note.trim()} = '' then notes else ${note.trim()} end where id = ${id}`;
      await audit(tx, user, 'variation', id, 'Declined by the client', note.trim());
      return;
    }
    const lines = await getVariationLines(id, tx);
    let [boq] = await tx<{ id: string }[]>`select id from boqs where project_id = ${v.project_id}`;
    if (!boq) [boq] = await tx<{ id: string }[]>`insert into boqs (project_id, file_name, uploaded_by) values (${v.project_id}, 'Variation orders', ${user.id}) returning id`;
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(line_no), 0)::int n from boq_lines where boq_id = ${boq.id}`;
    for (const [k, l] of lines.entries()) {
      const [b] = await tx<{ id: string }[]>`insert into boq_lines (boq_id, line_no, item_no, description, unit, qty, rate, amount, account, vo_id)
        values (${boq.id}, ${n + k + 1}, ${`${v.no}.${l.line_no}`}, ${l.description}, ${l.unit}, ${l.qty}, ${l.rate}, ${r2(l.qty * l.rate)}, ${l.account}, ${id}) returning id`;
      await tx`update variation_lines set boq_line_id = ${b.id} where id = ${l.id}`;
    }
    await tx`update projects set contract = coalesce(contract, 0) + ${v.total} where id = ${v.project_id}`;
    await tx`update variation_orders set status = 'approved', decided_by = ${user.id}, decided_at = now(), client_ref = case when ${clientRef.trim()} = '' then client_ref else ${clientRef.trim()} end,
      notes = case when ${note.trim()} = '' then notes else ${note.trim()} end where id = ${id}`;
    await audit(tx, user, 'variation', id, 'Approved by the client', `${fmt(v.total)} added to the BOQ and the contract`);
    await audit(tx, user, 'boq', v.project_id, `Variation order ${v.no} added`, `${lines.length} lines · ${fmt(v.total)}`);
  });
}
export async function cancelVariation(user: User, id: string) {
  await sql.begin(async tx => {
    const v = await getVariation(id, tx);
    if (!v) throw new RuleError('Variation order not found.');
    if (v.status === 'approved') throw new RuleError('An approved variation order is part of the contract and cannot be cancelled.');
    if (v.status === 'cancelled') return;
    if (v.created_by !== user.id && !hasRole(user, 'finance') && !canEngineer(user)) throw new RuleError('Only the engineers or Finance cancel a variation order.');
    await tx`update variation_orders set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'variation', id, 'Cancelled');
  });
}

// ---------------------------------------------------------------- budget alerts
export type BudgetAlert = { project_id: string; code: string; name: string; project_code: string; over_by: number; raised_at: string; task_id: string | null; task_status: string | null; assignee: string | null };
export const budgetAlerts = () => sql<BudgetAlert[]>`
  select b.project_id, b.code, coalesce(a.name, '') name, p.code project_code, b.over_by::float over_by, to_char(b.raised_at at time zone ${TZ},'YYYY-MM-DD') raised_at, b.task_id, t.status task_status, coalesce(e.name, u.name) assignee
  from budget_alerts b join projects p on p.id = b.project_id left join accounts a on a.code = b.code left join tasks t on t.id = b.task_id left join users u on u.id = t.assignee_id left join employees e on e.id = t.assignee_emp_id
  order by b.over_by desc`;
/**
 * Checks every project with a BOQ: a GL code whose committed or actual cost passed its budget gets one high task for Cost control
 * (else the Technical Office head, else the Engineering head) until it is back within budget. Returns how many new alerts were raised.
 */
export async function raiseBudgetAlerts(user: User) {
  const projects = await sql<{ id: string; code: string }[]>`select p.id, p.code from projects p where not p.is_office and exists (select 1 from boqs b where b.project_id = p.id) and p.status = 'Active'`;
  const existing = await sql<{ project_id: string; code: string; task_id: string | null }[]>`select project_id, code, task_id from budget_alerts`;
  const owners = (await holdersOf('cost_control')).length ? await holdersOf('cost_control') : (await holdersOf('to_head')).length ? await holdersOf('to_head')
    : (await sql<{ id: string }[]>`select u.id from departments d join users u on u.id = d.head_user_id and u.active where d.code = 'ENG'`).map(r => r.id);
  let raised = 0;
  for (const p of projects) {
    const { rows } = await committedVsBudget(p.id);
    const over = rows.filter(r => r.over && r.code);
    for (const r of over) {
      const overBy = r2(Math.max(r.committed, r.actual) - r.budget);
      const had = existing.find(e => e.project_id === p.id && e.code === r.code);
      if (had) { await sql`update budget_alerts set over_by = ${overBy} where project_id = ${p.id} and code = ${r.code!}`; continue; }
      const taskId = await saveTask(user, {
        title: `Over budget: ${r.code} ${r.name} on ${p.code} by EGP ${fmt(overBy)}`, details: `Budget ${fmt(r.budget)} · committed on POs and work orders ${fmt(r.committed)} · posted ${fmt(r.actual)}. Review the commitments or raise a variation order.`,
        status: 'todo', priority: 'high', assignee_id: owners[0] ?? null, link_type: 'cost-center', link_id: p.id, link_label: p.code,
      });
      await sql`insert into budget_alerts (project_id, code, over_by, task_id) values (${p.id}, ${r.code!}, ${overBy}, ${taskId})`;
      raised++;
    }
    // back within budget: the alert goes, its task is closed
    for (const e of existing.filter(e => e.project_id === p.id && !over.some(r => r.code === e.code))) {
      await sql`delete from budget_alerts where project_id = ${e.project_id} and code = ${e.code}`;
      if (e.task_id) await sql`update tasks set status = 'done', done_at = coalesce(done_at, now()), updated_at = now() where id = ${e.task_id} and status <> 'done'`;
    }
  }
  return raised;
}

// ---------------------------------------------------------------- reports
export type ClientRegisterRow = { project_id: string; code: string; name: string; contract: number | null; claims: number; claimed: number; certified: number; invoiced: number; collected: number; retention: number };
/** Per project: what the client claims add up to (cumulative gross of the latest claim), what is certified, invoiced, collected and the retention the client holds. */
export const clientRegister = () => sql<ClientRegisterRow[]>`
  with g as (select c.*, coalesce((select sum(round(x.pct / 100 * l.amount, 2)) from client_claim_lines x join boq_lines l on l.id = x.boq_line_id where x.claim_id = c.id), 0) gross from client_claims c where c.status <> 'cancelled')
  select p.id project_id, p.code, p.name, p.contract::float contract, (select count(*)::int from g where g.project_id = p.id) claims,
    coalesce((select gross from g where g.project_id = p.id order by g.claim_no desc limit 1), 0)::float claimed,
    coalesce((select gross from g where g.project_id = p.id and g.status in ('certified', 'invoiced') order by g.claim_no desc limit 1), 0)::float certified,
    coalesce((select sum(i.total) from g join invoices i on i.id = g.invoice_id where g.project_id = p.id and i.status = 'posted'), 0)::float invoiced,
    coalesce((select sum(invoice_paid(i.id)) from g join invoices i on i.id = g.invoice_id where g.project_id = p.id and i.status = 'posted'), 0)::float collected,
    coalesce((select round(gross * retention_pct / 100, 2) from g where g.project_id = p.id and g.status in ('certified', 'invoiced') order by g.claim_no desc limit 1), 0)::float retention
  from projects p where exists (select 1 from g where g.project_id = p.id) order by p.code`;
export type SubRegisterRow = { project_id: string; code: string; vendor_id: string; vendor: string; wo_no: string | null; claims: number; claimed: number; certified: number; paid: number; retention: number };
/** Per subcontractor and work order: the cumulative claimed and certified work, what was paid and the retention held. */
export const subRegister = () => sql<SubRegisterRow[]>`
  with g as (select c.*, coalesce(c.work_order_id, '') wok, coalesce((select sum(round(l.pct / 100 * (l.current_qty + l.previous_qty) * l.rate, 2)) from sub_claim_lines l where l.claim_id = c.id), 0) gross from sub_claims c where c.status <> 'cancelled'),
  k as (select g.*, row_number() over (partition by g.project_id, g.vendor_id, g.wok order by g.claim_no desc) rn,
    row_number() over (partition by g.project_id, g.vendor_id, g.wok order by case when g.status in ('finance', 'requested') then 0 else 1 end, g.claim_no desc) rc from g)
  select p.id project_id, p.code, k.vendor_id, v.name vendor, w.no wo_no, count(*)::int claims,
    coalesce(max(k.gross) filter (where k.rn = 1), 0)::float claimed,
    coalesce(max(k.gross) filter (where k.rc = 1 and k.status in ('finance', 'requested')), 0)::float certified,
    coalesce(sum(invoice_paid(i.id)) filter (where i.status = 'posted'), 0)::float paid,
    coalesce(max(round(k.gross * k.retention_pct / 100, 2)) filter (where k.rc = 1 and k.status in ('finance', 'requested')), 0)::float retention
  from k join projects p on p.id = k.project_id join parties v on v.id = k.vendor_id left join work_orders w on w.id = k.work_order_id left join invoices i on i.id = k.request_id
  group by p.id, p.code, k.vendor_id, v.name, k.wok, w.no order by p.code, v.name, w.no`;
export type VOSummaryRow = { project_id: string; code: string; name: string; contract: number | null; orders: number; approved: number; approved_total: number; pending: number; pending_total: number; declined: number };
export const variationsByProject = () => sql<VOSummaryRow[]>`
  select p.id project_id, p.code, p.name, p.contract::float contract, count(v.id)::int orders,
    count(*) filter (where v.status = 'approved')::int approved, coalesce(sum(t.total) filter (where v.status = 'approved'), 0)::float approved_total,
    count(*) filter (where v.status in ('draft', 'sent'))::int pending, coalesce(sum(t.total) filter (where v.status in ('draft', 'sent')), 0)::float pending_total,
    count(*) filter (where v.status = 'rejected')::int declined
  from variation_orders v join projects p on p.id = v.project_id cross join lateral (select coalesce(sum(round(l.qty * l.rate, 2)), 0) total from variation_lines l where l.vo_id = v.id) t
  group by p.id order by p.code`;
export type WorkloadRow = { user_id: string; name: string; positions: string; open: number; overdue: number; done_90: number; turnaround: number | null; oldest: string | null };
/** The Technical Office's workload: open tasks per engineer (by login or employee file), how many are overdue, and the average days a task took in the last 90 days. */
export const toWorkload = () => sql<WorkloadRow[]>`
  with people as (select u.id, u.name, string_agg(distinct up.position, ', ' order by up.position) positions from users u join user_positions up on up.user_id = u.id
      where u.active and up.position in ('design_head', 'designer', 'to_head', 'planning', 'qs', 'pricing', 'cost_control', 'site_head', 'site_eng', 'procurement_head', 'procurement') group by u.id),
    mine as (select t.*, coalesce(t.assignee_id, e.user_id) uid from tasks t left join employees e on e.id = t.assignee_emp_id)
  select p.id user_id, p.name, p.positions,
    count(m.id) filter (where m.status <> 'done')::int open, count(m.id) filter (where m.status <> 'done' and m.due < current_date)::int overdue,
    count(m.id) filter (where m.status = 'done' and m.done_at > now() - interval '90 days')::int done_90,
    round(avg(extract(epoch from (m.done_at - m.created_at)) / 86400) filter (where m.status = 'done' and m.done_at > now() - interval '90 days'), 1)::float turnaround,
    to_char(min(m.created_at) filter (where m.status <> 'done') at time zone ${TZ}, 'YYYY-MM-DD') oldest
  from people p left join mine m on m.uid = p.id group by p.id, p.name, p.positions order by open desc, p.name`;
