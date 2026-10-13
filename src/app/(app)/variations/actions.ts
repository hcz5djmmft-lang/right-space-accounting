'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import * as cl from '@/lib/claims';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const go = (path: string, err?: string, ok?: string, extra = '') => { revalidatePath('/', 'layout'); redirect(`${path}?${new URLSearchParams(err ? { error: err } : ok ? { ok } : {})}${extra}`); };
async function run(path: string, fn: () => Promise<unknown>, ok: string) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  go(path, err || undefined, err ? undefined : ok);
}

export async function variationAction(f: FormData) {
  const u = await requireUser();
  const lines = Array.from({ length: cl.VO_ROWS }, (_, i) => ({ description: s(f, `desc_${i}`), unit: s(f, `unit_${i}`), qty: parseAmount(f.get(`qty_${i}`)), rate: parseAmount(f.get(`rate_${i}`)), account: s(f, `acc_${i}`) || null }));
  const submit = f.get('submit') === '1';
  const editId = s(f, 'id') || undefined;
  let id = '', err = '';
  try {
    id = await cl.saveVariation(u, { id: editId, project: s(f, 'project'), title: s(f, 'title'), date: s(f, 'date'), client_ref: s(f, 'client_ref'), notes: s(f, 'notes'), lines });
    if (submit) await cl.sendVariation(u, id);
  } catch (e) { err = msg(e); }
  if (err && !id) go('/variations/new', err, undefined, editId ? `&edit=${editId}` : `&project=${encodeURIComponent(s(f, 'project'))}`);
  go(`/variations/${id}`, err || undefined, err ? undefined : submit ? 'Sent to the client.' : 'Draft saved.');
}
export async function sendVariationAction(id: string) { const u = await requireUser(); await run(`/variations/${id}`, () => cl.sendVariation(u, id), 'Sent to the client.'); }
export async function decideVariationAction(id: string, approved: boolean, f: FormData) {
  const u = await requireUser();
  await run(`/variations/${id}`, () => cl.decideVariation(u, id, approved, s(f, 'note'), s(f, 'client_ref')), approved ? 'Approved: the lines joined the BOQ and the contract.' : 'Recorded as declined.');
}
export async function cancelVariationAction(id: string) { const u = await requireUser(); await run(`/variations/${id}`, () => cl.cancelVariation(u, id), 'Cancelled.'); }
