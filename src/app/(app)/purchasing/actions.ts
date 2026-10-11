'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { MAX_BYTES, addAttachment, sniff } from '@/lib/attachments';
import * as pur from '@/lib/purchasing';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));

const Input = z.object({
  id: z.string().optional(), submit: z.boolean(), date: z.string(), neededBy: z.string().nullish(),
  project: z.string().nullish(), dept: z.string().nullish(), notes: z.string().default(''),
  lines: z.array(z.object({ material: z.string(), qty: z.number(), description: z.string().optional() })),
});
export async function savePurchaseAction(raw: unknown): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const p = Input.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const { submit, ...input } = p.data;
  try {
    const id = await pur.savePurchaseRequest(user, input, submit);
    revalidatePath('/', 'layout');
    return { id };
  } catch (e) { return { error: msg(e) }; }
}

async function act(id: string, fn: () => Promise<unknown>, ok = '') {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  revalidatePath('/', 'layout');
  redirect(`/purchasing/${id}?` + new URLSearchParams(err ? { error: err } : ok ? { ok } : {}));
}

export async function priceAction(id: string, f: FormData) {
  const user = await requireUser();
  const prices = Object.fromEntries([...f.keys()].filter(k => k.startsWith('price_')).map(k => [k.slice(6), parseAmount(f.get(k))]));
  const send = f.get('send') === '1';
  await act(id, () => pur.pricePurchaseRequest(user, id, { vendor: String(f.get('vendor') ?? ''), vatRate: parseAmount(f.get('vat')), prices, send }), send ? 'Sent for approval.' : 'Prices saved.');
}
export async function approveAction(id: string) {
  const user = await requireUser();
  await act(id, () => pur.approvePurchaseRequest(user, id), 'Approved.');
}
export async function returnAction(id: string, f: FormData) { const u = await requireUser(); await act(id, () => pur.returnPurchaseRequest(u, id, String(f.get('reason') ?? ''))); }
export async function cancelAction(id: string) { const u = await requireUser(); await act(id, () => pur.cancelPurchaseRequest(u, id), 'Cancelled.'); }
export async function closeAction(id: string, closed: boolean) { const u = await requireUser(); await act(id, () => pur.closePurchaseOrder(u, id, closed), closed ? 'PO closed.' : 'PO reopened.'); }

/** Receive and invoice: the vendor's invoice for a PO, with the invoice file attached (Finance). */
export async function receiveAction(poId: string, f: FormData) {
  const user = await requireUser('finance');
  const file = f.get('file');
  const back = (error: string) => redirect(`/purchasing/${poId}/receive?error=${encodeURIComponent(error)}`);
  let body: Buffer | null = null, name = '';
  if (file instanceof File && file.size) { body = Buffer.from(await file.arrayBuffer()); name = file.name; }
  if (!body) back("Attach the vendor's invoice (a photo or a PDF).");
  if (body!.length > MAX_BYTES) back('That file is over 4 MB. Take a smaller photo or send a smaller PDF.');
  if (!sniff(body!)) back('Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.');
  const lines = [...f.keys()].filter(k => k.startsWith('qty_')).map(k => ({ lineId: k.slice(4), qty: parseAmount(f.get(k)), price: parseAmount(f.get('price_' + k.slice(4))) }));
  let id = '', err = '';
  try {
    id = await pur.receiveInvoice(user, poId, {
      date: String(f.get('date') ?? ''), ref: String(f.get('ref') ?? ''), vatRate: parseAmount(f.get('vat')), whtRate: parseAmount(f.get('wht')), lines,
    });
  } catch (e) { err = msg(e); }
  if (err) back(err);
  let attachErr = '';
  try { await addAttachment(user, 'invoice', id, name, body!); } catch (e) { attachErr = msg(e); }
  revalidatePath('/', 'layout');
  redirect(`/purchasing/invoices/${id}?` + new URLSearchParams(attachErr ? { error: `The invoice is posted, but the file was not attached: ${attachErr} Add it below.` } : { ok: 'Invoice received and posted to the vendor\'s account.' }));
}

export async function materialAction(f: FormData) {
  const user = await requireUser();
  let err = '';
  try {
    await pur.saveMaterial(user, {
      id: String(f.get('id') ?? '') || undefined, name: String(f.get('name') ?? ''), name_ar: String(f.get('name_ar') ?? ''),
      unit: String(f.get('unit') ?? ''), account_base: String(f.get('account') ?? ''), active: f.get('active') !== '0',
    });
  } catch (e) { err = msg(e); }
  revalidatePath('/purchasing/materials');
  redirect('/purchasing/materials?' + new URLSearchParams(err ? { error: err } : { ok: 'Material list saved.' }));
}

export async function voidInvoiceAction(id: string, f: FormData) {
  const user = await requireUser('finance');
  let err = '';
  try { await pur.voidVendorInvoice(user, id, String(f.get('reason') ?? '').trim(), String(f.get('date') ?? '')); } catch (e) { err = msg(e); }
  revalidatePath('/', 'layout');
  redirect(`/purchasing/invoices/${id}?` + new URLSearchParams(err ? { error: err } : { ok: 'Invoice voided; its entry is reversed.' }));
}
