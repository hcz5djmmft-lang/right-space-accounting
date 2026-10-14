'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import * as tasks from '@/lib/tasks';
import { resolveAssignee } from '@/lib/hr';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function saveTaskAction(f: FormData) {
  const user = await requireUser();
  const id = str(f, 'id') || undefined;
  let next = '';
  try {
    const saved = await tasks.saveTask(user, {
      id, title: str(f, 'title'), details: str(f, 'details'), priority: str(f, 'priority') as tasks.Priority,
      due: str(f, 'due') || null, ...(await resolveAssignee(str(f, 'assignee'))), project_id: str(f, 'project') || null,
      link_type: str(f, 'link_type') || null, link_id: str(f, 'link_id') || null, link_label: str(f, 'link_label') || null,
    });
    next = `/tasks/${saved}`;
  } catch (e) {
    revalidatePath('/tasks');
    redirect(`${id ? `/tasks/${id}` : '/tasks/new'}?error=${encodeURIComponent(msg(e))}`);
  }
  revalidatePath('/', 'layout');
  redirect(next);
}

/** Start (a task with no project), Submit for review, Approve and Send back: the only ways a task changes column by hand. */
async function step(id: string, fn: () => Promise<void>, back: string, ok: string) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  revalidatePath('/', 'layout');
  redirect(err ? `/tasks/${id}?error=${encodeURIComponent(err)}` : `${back}${back.includes('?') ? '&' : '?'}ok=${encodeURIComponent(ok)}`);
}
export async function startAction(id: string, back: string) {
  const user = await requireUser();
  await step(id, () => tasks.startTask(user, id), back, 'Started: the task is In progress.');
}
export async function submitAction(id: string, f: FormData) {
  const user = await requireUser();
  await step(id, () => tasks.submitTask(user, id, str(f, 'note')), `/tasks/${id}`, 'Submitted: the task is in Review until it is approved.');
}
export async function reviewAction(id: string, approve: boolean, f: FormData) {
  const user = await requireUser();
  await step(id, () => tasks.reviewTask(user, id, approve, str(f, 'note')), `/tasks/${id}`, approve ? 'Approved: the task is Done.' : 'Sent back: the task is In progress again.');
}
export async function commentAction(id: string, f: FormData) {
  const user = await requireUser();
  await tasks.addComment(user, id, str(f, 'text'));
  revalidatePath(`/tasks/${id}`);
  redirect(`/tasks/${id}`);
}
export async function deleteTaskAction(id: string) {
  const user = await requireUser();
  try { await tasks.deleteTask(user, id); } catch (e) { redirect(`/tasks/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect('/tasks');
}
