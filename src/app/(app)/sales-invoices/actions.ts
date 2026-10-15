'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import * as sales from '@/lib/sales';
import { RuleError } from '@/lib/ledger';

const Line = z.object({ acc: z.string().default(''), desc: z.string().optional(), qty: z.number(), price: z.number() });
const Input = z.object({
  id: z.string().optional(), post: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'), due: z.string().nullish(),
  party: z.string(), project: z.string().nullish(), category: z.string().nullish(), ref: z.string().default(''), vatRate: z.number().min(0),
  lines: z.array(Line),
});

export async function saveInvoiceAction(raw: unknown): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const p = Input.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const { post, ...input } = p.data;
  try {
    // update 20: Finance no longer posts an invoice itself; it goes for approval (Finance, Engineering, Management)
    const id = await sales.saveSalesInvoice(user, input, false);
    if (post) await sales.sendSalesForApproval(user, id);
    revalidatePath('/', 'layout');
    return { id };
  } catch (e) { return { error: msg(e) }; }
}

function msg(e: unknown) {
  if (e instanceof RuleError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  if (/locked|balanced|posted|cannot/.test(m)) return m;
  console.error(e);
  return 'Something went wrong. Nothing was changed.';
}

async function act(id: string, fn: () => Promise<unknown>, done = `/sales-invoices/${id}`) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  revalidatePath('/', 'layout');
  redirect(err ? `/sales-invoices/${id}?error=${encodeURIComponent(err)}` : done);
}
export async function sendInvoice(id: string) { const u = await requireUser(); await act(id, () => sales.sendSalesForApproval(u, id)); }
export async function approveInvoice(id: string, f: FormData) { const u = await requireUser(); await act(id, () => sales.approveSales(u, id, String(f.get('note') ?? ''))); }
export async function returnInvoice(id: string, f: FormData) { const u = await requireUser(); await act(id, () => sales.returnSales(u, id, String(f.get('note') ?? ''))); }
export async function deleteInvoice(id: string) { const u = await requireUser(); await act(id, () => sales.deleteSalesInvoice(u, id), '/sales-invoices'); }
export async function voidInvoice(id: string, f: FormData) {
  const u = await requireUser();
  await act(id, () => sales.voidSalesInvoice(u, id, String(f.get('reason') ?? ''), String(f.get('date') ?? '')));
}
