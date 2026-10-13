'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { FIELDS, parseAnswers } from '@/lib/project-form';
import { completeForm, phaseLabel, saveInfo, setPhase } from '@/lib/projects';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (id: string, err?: string, extra = '') => redirect(`/cost-centers/${id}/form?${err ? `error=${encodeURIComponent(err)}` : `saved=1${extra}`}`);

async function save(id: string, f: FormData) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { data, errors } = parseAnswers(k => (f.get(k) === null ? null : String(f.get(k))), k => f.getAll(k).map(String));
  if (errors.length) throw new RuleError(errors.join(' '));
  const notes = Object.fromEntries(FIELDS.map(x => [x.key, s(f, `n_${x.key}`)]));
  await saveInfo(user, id, { rev: s(f, 'rev'), data, notes });
  return user;
}

export async function saveFormAction(id: string, f: FormData) {
  try { await save(id, f); } catch (e) { back(id, msg(e)); }
  revalidatePath('/', 'layout');
  back(id);
}
export async function completeFormAction(id: string, f: FormData) {
  let next: string | null = null;
  try { const user = await save(id, f); next = await completeForm(user, id); } catch (e) { back(id, msg(e)); }
  revalidatePath('/', 'layout');
  redirect(`/cost-centers/${id}?saved=1${next ? `&moved=${encodeURIComponent(phaseLabel(next))}` : ''}`);
}
export async function setPhaseAction(id: string, f: FormData) {
  const user = await requireUser('finance', 'engineering', 'projects');
  try { await setPhase(user, id, s(f, 'phase'), s(f, 'note')); } catch (e) { redirect(`/cost-centers/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/cost-centers/${id}?saved=1&moved=${encodeURIComponent(phaseLabel(s(f, 'phase')))}`);
}
