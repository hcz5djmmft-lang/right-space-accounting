'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import * as d from '@/lib/design';
import type { Kind } from '@/lib/design-calc';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (setId: string, err?: string) => redirect(`/design/${setId}?${err ? `error=${encodeURIComponent(err)}` : 'saved=1'}`);
const done = (setId: string) => { revalidatePath('/', 'layout'); back(setId); };

export async function createSetAction(projectId: string, kind: Kind) {
  const user = await requireUser();
  let id = '';
  try { id = await d.createSet(user, projectId, kind); } catch (e) { redirect(`/design?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/design/${id}?saved=1`);
}
export async function addDrawingAction(setId: string, f: FormData) {
  const user = await requireUser();
  try { await d.addDrawing(user, setId, { no: s(f, 'no'), title: s(f, 'title'), note: s(f, 'note') }); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function removeDrawingAction(setId: string, drawingId: string) {
  const user = await requireUser();
  try { await d.removeDrawing(user, drawingId); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function newRevisionAction(setId: string, drawingId: string) {
  const user = await requireUser();
  try { await d.newRevision(user, drawingId); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function submitSetAction(setId: string) {
  const user = await requireUser();
  try { await d.submitSet(user, setId); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function decideSetAction(setId: string, approve: boolean, f: FormData) {
  const user = await requireUser();
  try { await d.decideSet(user, setId, approve, s(f, 'note')); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function reopenSetAction(setId: string, f: FormData) {
  const user = await requireUser();
  try { await d.reopenSet(user, setId, s(f, 'note')); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function sendToClientAction(setId: string) {
  const user = await requireUser();
  try { await d.sendToClient(user, setId); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function clientDecisionAction(setId: string, approve: boolean, f: FormData) {
  const user = await requireUser();
  try { await d.clientDecision(user, setId, approve, s(f, 'note')); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function ifcAction(setId: string) {
  const user = await requireUser();
  try { await d.issueForConstruction(user, setId); } catch (e) { back(setId, msg(e)); }
  done(setId);
}
export async function postMessageAction(setId: string, f: FormData) {
  const user = await requireUser();
  try { await d.postMessage(user, setId, s(f, 'text')); } catch (e) { back(setId, msg(e)); }
  revalidatePath(`/design/${setId}`);
  redirect(`/design/${setId}#chat`);
}

const fin = (projectId: string, err?: string) => redirect(`/design/finishes?project=${projectId}${err ? `&error=${encodeURIComponent(err)}` : '&saved=1'}`);
export async function addFinishAction(projectId: string, f: FormData) {
  const user = await requireUser();
  try { await d.addFinish(user, projectId, { area: s(f, 'area'), item: s(f, 'item'), material: s(f, 'material'), ref: s(f, 'ref'), note: s(f, 'note') }); } catch (e) { fin(projectId, msg(e)); }
  revalidatePath('/design/finishes');
  fin(projectId);
}
export async function decideFinishAction(projectId: string, id: string, approve: boolean) {
  const user = await requireUser();
  try { await d.decideFinish(user, id, approve); } catch (e) { fin(projectId, msg(e)); }
  revalidatePath('/design/finishes');
  fin(projectId);
}
export async function removeFinishAction(projectId: string, id: string) {
  const user = await requireUser();
  try { await d.removeFinish(user, id); } catch (e) { fin(projectId, msg(e)); }
  revalidatePath('/design/finishes');
  fin(projectId);
}
