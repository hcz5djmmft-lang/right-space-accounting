'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import * as docs from '@/lib/documents';
import { RuleError } from '@/lib/ledger';

const Line = z.object({ acc: z.string(), desc: z.string().optional(), qty: z.number(), price: z.number(), project: z.string().nullish(), dept: z.string().nullish() });
const Input = z.object({
  id: z.string().optional(), submit: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'), due: z.string().nullish(),
  party: z.string(), project: z.string().nullish(), dept: z.string().nullish(), costType: z.string().nullish(),
  ref: z.string().default(''), requester: z.string().nullish(),
  vatRate: z.number().min(0), whtRate: z.number().min(0), siRate: z.number().min(0), retRate: z.number().min(0), dpAmount: z.number().min(0),
  lines: z.array(Line),
});

export async function savePRAction(raw: unknown): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const p = Input.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  const { submit, ...input } = p.data;
  try {
    const id = await docs.savePaymentRequest(user, input, submit);
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

async function act(id: string, fn: () => Promise<unknown>, done = `/payment-requests/${id}`) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  revalidatePath('/', 'layout');
  redirect(err ? `/payment-requests/${id}?error=${encodeURIComponent(err)}` : done);
}
export async function approvePR(id: string) { const u = await requireUser(); await act(id, () => docs.approveRequest(u, id)); }
export async function returnPR(id: string, f: FormData) { const u = await requireUser(); await act(id, () => docs.returnRequest(u, id, String(f.get('reason') ?? ''))); }
export async function deletePR(id: string) { const u = await requireUser(); await act(id, () => docs.deleteRequest(u, id), '/payment-requests'); }
