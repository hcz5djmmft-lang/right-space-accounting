'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import * as q from '@/lib/qs';
import type { Part } from '@/lib/qs-calc';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (id: string, tab: string, err?: string) => redirect(`/qs/${id}?tab=${tab}&${err ? `error=${encodeURIComponent(err)}` : 'saved=1'}`);
const done = (id: string, tab: string) => { revalidatePath('/', 'layout'); back(id, tab); };

export async function createEstimateAction(projectId: string) {
  const user = await requireUser();
  let id = '';
  try { id = await q.createEstimate(user, projectId); } catch (e) { redirect(`/qs?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/qs/${id}?saved=1`);
}
export async function saveInputsAction(id: string, part: Part, f: FormData) {
  const user = await requireUser();
  try { await q.saveInputs(user, id, part, name => (f.has(name) ? String(f.get(name)) : null)); } catch (e) { back(id, part, msg(e)); }
  done(id, part);
}
export async function sendEstimateAction(id: string) {
  const user = await requireUser();
  try { await q.sendEstimate(user, id); } catch (e) { back(id, 'master', msg(e)); }
  done(id, 'master');
}
export async function decideEstimateAction(id: string, accepted: boolean, f: FormData) {
  const user = await requireUser();
  try { await q.decideEstimate(user, id, accepted, s(f, 'note')); } catch (e) { back(id, 'master', msg(e)); }
  done(id, 'master');
}
export async function newRevisionAction(id: string) {
  const user = await requireUser();
  let n = '';
  try { n = await q.newRevision(user, id); } catch (e) { back(id, 'master', msg(e)); }
  revalidatePath('/', 'layout');
  redirect(`/qs/${n}?saved=1`);
}
export async function saveRatesAction(f: FormData) {
  const user = await requireUser();
  const prices: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith('rate_') && typeof v === 'string') prices[k.slice(5)] = v;
  try { await q.saveRates(user, prices); } catch (e) { redirect(`/qs?tab=rates&error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect('/qs?tab=rates&saved=1');
}
