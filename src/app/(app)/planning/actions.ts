'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import * as pl from '@/lib/planning';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (projectId: string, err?: string, anchor = '') => redirect(`/planning/${projectId}?${err ? `error=${encodeURIComponent(err)}` : 'saved=1'}${anchor}`);
const done = (projectId: string, anchor = '') => { revalidatePath('/', 'layout'); back(projectId, undefined, anchor); };

export async function startScheduleAction(projectId: string) {
  const user = await requireUser();
  try { await pl.startSchedule(user, projectId); } catch (e) { redirect(`/planning?error=${encodeURIComponent(msg(e))}`); }
  done(projectId);
}
export async function saveActivitiesAction(projectId: string, f: FormData) {
  const user = await requireUser();
  const ids = f.getAll('id').map(String);
  const rows = ids.map(id => ({ id, name: s(f, `name_${id}`), start: s(f, `start_${id}`), end: s(f, `end_${id}`), note: s(f, `note_${id}`) }));
  try { await pl.saveActivities(user, projectId, rows, s(f, 'note')); } catch (e) { back(projectId, msg(e)); }
  done(projectId);
}
export async function addActivityAction(projectId: string, f: FormData) {
  const user = await requireUser();
  try { await pl.addActivity(user, projectId, { name: s(f, 'name'), category: s(f, 'category'), start: s(f, 'start'), end: s(f, 'end') }); } catch (e) { back(projectId, msg(e)); }
  done(projectId);
}
export async function removeActivityAction(projectId: string, activityId: string) {
  const user = await requireUser();
  try { await pl.removeActivity(user, activityId); } catch (e) { back(projectId, msg(e)); }
  done(projectId);
}
export async function setBaselineAction(projectId: string, f: FormData) {
  const user = await requireUser();
  try { await pl.setBaseline(user, projectId, s(f, 'note')); } catch (e) { back(projectId, msg(e)); }
  done(projectId);
}
export async function recordProgressAction(projectId: string, f: FormData) {
  const user = await requireUser();
  const ids = f.getAll('id').map(String);
  const entries = ids.map(id => ({ id, pct: s(f, `pct_${id}`), note: s(f, `pnote_${id}`) }));
  try { await pl.recordProgress(user, projectId, s(f, 'week'), entries); } catch (e) { back(projectId, msg(e), '#progress'); }
  done(projectId, '#progress');
}
