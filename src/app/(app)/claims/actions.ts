'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { MAX_BYTES, addAttachment, sniff } from '@/lib/attachments';
import * as cl from '@/lib/claims';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const go = (path: string, err?: string, ok?: string, extra = '') => { revalidatePath('/', 'layout'); redirect(`${path}?${new URLSearchParams(err ? { error: err } : ok ? { ok } : {})}${extra}`); };
async function run(path: string, fn: () => Promise<unknown>, ok: string) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  go(path, err || undefined, err ? undefined : ok);
}
// ---- subcontractor claims
export async function subClaimAction(f: FormData) {
  const u = await requireUser();
  const lines = Array.from({ length: cl.CLAIM_ROWS },(_, i) => ({ wo_line_id: s(f, `wol_${i}`) || null, item: s(f, `item_${i}`), unit: s(f, `unit_${i}`), rate: parseAmount(f.get(`rate_${i}`)), current_qty: parseAmount(f.get(`cur_${i}`)), previous_qty: parseAmount(f.get(`prev_${i}`)), pct: s(f, `pct_${i}`), notes: s(f, `notes_${i}`) }));
  const submit = f.get('submit') === '1';
  const editId = s(f, 'id') || undefined;
  const back = `/claims/new`;
  const backExtra = editId ? `&edit=${editId}` : `&wo=${encodeURIComponent(s(f, 'work_order'))}&project=${encodeURIComponent(s(f, 'project'))}&vendor=${encodeURIComponent(s(f, 'vendor'))}`;
  let id = '', err = '';
  try {
    id = await cl.saveSubClaim(u, { id: editId, project: s(f, 'project'), vendor: s(f, 'vendor'), work_order: s(f, 'work_order') || null, trade: s(f, 'trade'), date: s(f, 'date'), retention_pct: s(f, 'retention_pct'), advance: s(f, 'advance'), vat_rate: s(f, 'vat_rate'), account: s(f, 'account') || null, notes: s(f, 'notes'), lines });
    const file = f.get('file');
    if (file instanceof File && file.size) {
      const body = Buffer.from(await file.arrayBuffer());
      if (body.length > MAX_BYTES) throw new RuleError('That file is over 4 MB. Take a smaller photo or send a smaller PDF.');
      if (!sniff(body)) throw new RuleError('Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.');
      await addAttachment(u, 'claim', id, file.name, body);
    }
    if (submit) await cl.submitSubClaim(u, id);
  } catch (e) { err = msg(e); }
  if (err && !id) go(back, err, undefined, backExtra);
  go(`/claims/${id}`, err || undefined, err ? undefined : submit ? 'Quantities certified and sent to Procurement for pricing.' : 'Draft saved.');
}
export async function submitClaimAction(id: string) { const u = await requireUser(); await run(`/claims/${id}`, () => cl.submitSubClaim(u, id), 'Quantities certified and sent to Procurement for pricing.'); }
export async function priceClaimAction(id: string, f: FormData) {
  const u = await requireUser();
  const rates = Object.fromEntries([...f.keys()].filter(k => k.startsWith('rate_')).map(k => [k.slice(5), parseAmount(f.get(k))]));
  const send = f.get('send') === '1';
  await run(`/claims/${id}`, () => cl.priceSubClaim(u, id, { rates, account: s(f, 'account'), vat_rate: s(f, 'vat_rate'), retention_pct: s(f, 'retention_pct'), advance: s(f, 'advance'), send }), send ? 'Priced and sent to Finance.' : 'Rates saved.');
}
export async function returnClaimAction(id: string, f: FormData) { const u = await requireUser(); await run(`/claims/${id}`, () => cl.returnSubClaim(u, id, s(f, 'reason')), 'Returned to the engineer.'); }
export async function cancelClaimAction(id: string) { const u = await requireUser(); await run(`/claims/${id}`, () => cl.cancelSubClaim(u, id), 'Cancelled.'); }
export async function raiseRequestAction(id: string) {
  const u = await requireUser();
  let reqId = '', err = '';
  try { reqId = await cl.raisePaymentRequest(u, id); } catch (e) { err = msg(e); }
  if (err) go(`/claims/${id}`, err);
  go(`/payment-requests/${reqId}`, undefined, 'Payment request drafted from the claim: check the withholding tax and the due date, then submit it for approval.');
}

// ---- client claims
export async function clientClaimAction(f: FormData) {
  const u = await requireUser();
  const pcts = Object.fromEntries([...f.keys()].filter(k => k.startsWith('pct_')).map(k => [k.slice(4), s(f, k)]));
  const submit = f.get('submit') === '1';
  const editId = s(f, 'id') || undefined;
  let id = '', err = '';
  try {
    id = await cl.saveClientClaim(u, { id: editId, project: s(f, 'project'), date: s(f, 'date'), retention_pct: s(f, 'retention_pct'), advance: s(f, 'advance'), notes: s(f, 'notes'), pcts });
    if (submit) await cl.certifyClientClaim(u, id);
  } catch (e) { err = msg(e); }
  if (err && !id) go('/claims/client/new', err, undefined, editId ? `&edit=${editId}` : `&project=${encodeURIComponent(s(f, 'project'))}`);
  go(`/claims/client/${id}`, err || undefined, err ? undefined : submit ? 'Certified and sent to Finance to invoice.' : 'Draft saved.');
}
export async function certifyClientAction(id: string) { const u = await requireUser(); await run(`/claims/client/${id}`, () => cl.certifyClientClaim(u, id), 'Certified and sent to Finance to invoice.'); }
export async function invoiceClientAction(id: string, f: FormData) {
  const u = await requireUser();
  let invId = '', err = '';
  try { invId = await cl.invoiceClientClaim(u, id, { category: s(f, 'category'), vatRate: s(f, 'vat_rate'), date: s(f, 'date') }); } catch (e) { err = msg(e); }
  if (err) go(`/claims/client/${id}`, err);
  go(`/sales-invoices/${invId}`, undefined, 'Invoice drafted from the claim: check it and post it.');
}
export async function cancelClientAction(id: string) { const u = await requireUser(); await run(`/claims/client/${id}`, () => cl.cancelClientClaim(u, id), 'Cancelled.'); }
