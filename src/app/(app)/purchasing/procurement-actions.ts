'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { MAX_BYTES, addAttachment, sniff } from '@/lib/attachments';
import * as pro from '@/lib/procurement';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const go = (path: string, err?: string, ok?: string, anchor = '') => { revalidatePath('/', 'layout'); redirect(`${path}?${new URLSearchParams(err ? { error: err } : ok ? { ok } : {})}${anchor}`); };
async function run(path: string, fn: () => Promise<unknown>, ok: string, anchor = '') {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  go(path, err || undefined, err ? undefined : ok, anchor);
}
/** A photo or PDF from the form, checked like every other attachment; nothing when the field is empty. */
async function fileOf(f: FormData, key = 'file') {
  const file = f.get(key);
  if (!(file instanceof File) || !file.size) return null;
  const body = Buffer.from(await file.arrayBuffer());
  if (body.length > MAX_BYTES) throw new RuleError('That file is over 4 MB. Take a smaller photo or send a smaller PDF.');
  if (!sniff(body)) throw new RuleError('Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.');
  return { name: file.name, body };
}

// ---- the request page
export async function assignAction(id: string, f: FormData) {
  const u = await requireUser();
  await run(`/purchasing/${id}`, () => pro.assignBuyer(u, id, s(f, 'buyer') || null), 'Assigned.');
}
export async function quotationAction(id: string, f: FormData) {
  const u = await requireUser();
  const prices = Object.fromEntries([...f.keys()].filter(k => k.startsWith('qp_')).map(k => [k.slice(3), parseAmount(f.get(k))]));
  let err = '';
  try {
    const file = await fileOf(f);
    const qid = await pro.addQuotation(u, id, { vendor: s(f, 'vendor'), date: s(f, 'date'), ref: s(f, 'ref'), valid_until: s(f, 'valid_until'), delivery_days: s(f, 'delivery_days'), vat_rate: s(f, 'vat_rate'), notes: s(f, 'notes'), prices });
    if (file) await addAttachment(u, 'quotation', qid, file.name, file.body);
  } catch (e) { err = msg(e); }
  go(`/purchasing/${id}`, err || undefined, err ? undefined : 'Quotation recorded.', '#quotations');
}
export async function removeQuotationAction(id: string, quotationId: string) {
  const u = await requireUser();
  await run(`/purchasing/${id}`, () => pro.removeQuotation(u, quotationId), 'Quotation removed.', '#quotations');
}
export async function chooseQuotationAction(id: string, quotationId: string) {
  const u = await requireUser();
  await run(`/purchasing/${id}`, () => pro.chooseQuotation(u, quotationId), 'Offer chosen and sent for approval.');
}
export async function deliveryDateAction(id: string, f: FormData) {
  const u = await requireUser();
  await run(`/purchasing/${id}`, () => pro.setDeliveryDate(u, id, s(f, 'date')), 'Delivery date saved.', '#deliveries');
}
export async function deliveryAction(id: string, f: FormData) {
  const u = await requireUser();
  const lines = [...f.keys()].filter(k => k.startsWith('dq_')).map(k => ({ lineId: k.slice(3), qty: parseAmount(f.get(k)) }));
  let err = '';
  try {
    const file = await fileOf(f);
    const did = await pro.recordDelivery(u, id, { date: s(f, 'date'), ref: s(f, 'ref'), notes: s(f, 'notes'), lines });
    if (file) await addAttachment(u, 'delivery', did, file.name, file.body);
  } catch (e) { err = msg(e); }
  go(`/purchasing/${id}`, err || undefined, err ? undefined : 'Delivery recorded.', '#deliveries');
}

// ---- vendors
export async function vendorProfileAction(id: string, f: FormData) {
  const u = await requireUser();
  await run(`/purchasing/vendors/${id}`, () => pro.saveVendorProfile(u, id, { categories: f.getAll('category').map(String), rating: s(f, 'rating') || null, rating_note: s(f, 'rating_note') }), 'Vendor profile saved.');
}

// ---- site stock and the material plan
export async function stockIssueAction(projectId: string, f: FormData) {
  const u = await requireUser();
  await run('/purchasing/stock', () => pro.recordStockIssue(u, projectId, { material: s(f, 'material'), qty: parseAmount(f.get('qty')), date: s(f, 'date'), note: s(f, 'note') }), 'Site use recorded.', `&project=${projectId}`);
}
export async function planRequestAction(projectId: string, f: FormData) {
  const u = await requireUser();
  let id = '', err = '';
  try { id = await pro.planToRequest(u, projectId, f.getAll('line').map(String)); } catch (e) { err = msg(e); }
  if (err) go('/purchasing/plan', err, undefined, `&project=${projectId}`);
  go(`/purchasing/${id}`, undefined, 'Purchase request raised from the material plan.');
}

// ---- work orders
export async function workOrderAction(f: FormData) {
  const u = await requireUser();
  const lines = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ item: s(f, `item_${i}`), unit: s(f, `unit_${i}`), qty: parseAmount(f.get(`qty_${i}`)), rate: parseAmount(f.get(`rate_${i}`)) }));
  const submit = f.get('submit') === '1';
  const editId = s(f, 'id') || undefined;
  let id = '', err = '';
  try {
    id = await pro.saveWorkOrder(u, { id: editId, project: s(f, 'project'), vendor: s(f, 'vendor'), category: s(f, 'category'), title: s(f, 'title'), date: s(f, 'date'), start: s(f, 'start'), end: s(f, 'end'),
      retention_pct: s(f, 'retention_pct'), advance_pct: s(f, 'advance_pct'), vat_rate: s(f, 'vat_rate'), account: s(f, 'account'), notes: s(f, 'notes'), lines }, submit);
  } catch (e) { err = msg(e); }
  if (err) go('/purchasing/work-orders/new', err, undefined, editId ? `&edit=${editId}` : '');
  go(`/purchasing/work-orders/${id}`, undefined, submit ? 'Sent for approval.' : 'Draft saved.');
}
export async function approveWOAction(id: string) { const u = await requireUser(); await run(`/purchasing/work-orders/${id}`, () => pro.approveWorkOrder(u, id), 'Approved.'); }
export async function returnWOAction(id: string, f: FormData) { const u = await requireUser(); await run(`/purchasing/work-orders/${id}`, () => pro.returnWorkOrder(u, id, s(f, 'reason')), 'Returned for changes.'); }
export async function cancelWOAction(id: string) { const u = await requireUser(); await run(`/purchasing/work-orders/${id}`, () => pro.cancelWorkOrder(u, id), 'Cancelled.'); }
export async function closeWOAction(id: string, closed: boolean) { const u = await requireUser(); await run(`/purchasing/work-orders/${id}`, () => pro.closeWorkOrder(u, id, closed), closed ? 'Work order closed.' : 'Work order reopened.'); }
