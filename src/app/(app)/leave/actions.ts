'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import * as leave from '@/lib/leave';
import type { LeaveType } from '@/lib/leave-calc';
import { RuleError } from '@/lib/ledger';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function requestLeaveAction(f: FormData) {
  const user = await requireUser();
  const employee = s(f, 'employee_id') || undefined;
  let id = '';
  try { id = await leave.requestLeave(user, { employee_id: employee, type: s(f, 'type') as LeaveType, from: s(f, 'from'), to: s(f, 'to'), reason: s(f, 'reason') }); }
  catch (e) { redirect(`/leave?${employee ? 'tab=all&' : ''}error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/leave/${id}?saved=1`);
}
export async function decideLeaveAction(id: string, approve: boolean, f: FormData) {
  const user = await requireUser();
  try { await leave.decideLeave(user, id, approve, s(f, 'note')); } catch (e) { redirect(`/leave/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/leave/${id}?saved=1`);
}
export async function cancelLeaveAction(id: string) {
  const user = await requireUser();
  try { await leave.cancelLeave(user, id); } catch (e) { redirect(`/leave/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/leave/${id}?saved=1`);
}
