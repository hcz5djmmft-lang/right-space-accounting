'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import * as tasks from '@/lib/tasks';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function saveTaskAction(f: FormData) {
  const user = await requireUser();
  const id = str(f, 'id') || undefined;
  let next = '';
  try {
    const saved = await tasks.saveTask(user, {
      id, title: str(f, 'title'), details: str(f, 'details'), status: str(f, 'status') as tasks.Status, priority: str(f, 'priority') as tasks.Priority,
      due: str(f, 'due') || null, assignee_id: str(f, 'assignee_id') || null,
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
export async function statusAction(id: string, status: string) {
  const user = await requireUser();
  try { await tasks.setStatus(user, id, status as tasks.Status); } catch (e) { redirect(`/tasks/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect('/tasks');
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
