'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import * as ex from '@/lib/expenses';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const input = (f: FormData): ex.ExpenseInput => {
  const assign = str(f, 'assign');
  return { id: str(f, 'id') || undefined, date: str(f, 'date'), amount: parseAmount(f.get('amount')), account: str(f, 'account'), description: str(f, 'description'), paidFrom: str(f, 'paid_from'),
    project: assign.startsWith('p:') ? assign.slice(2) : null, dept: assign.startsWith('d:') ? assign.slice(2) : null };
};

/** New expense from the phone; returns an error to show in the form, or goes to the saved expense. */
export async function newExpenseAction(f: FormData): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const file = f.get('receipt');
  try {
    const id = await ex.recordExpense(user, input(f), file instanceof File && file.size ? { name: file.name, body: Buffer.from(await file.arrayBuffer()) } : null);
    revalidatePath('/', 'layout');
    return { id };
  } catch (e) { return { error: msg(e) }; }
}
export async function correctExpenseAction(id: string, f: FormData) {
  const user = await requireUser();
  try { await ex.saveExpense(user, { ...input(f), id }); } catch (e) { redirect(`/expenses/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/expenses/${id}?ok=${encodeURIComponent('Sent for approval again.')}`);
}
export async function approveExpenseAction(id: string) {
  const user = await requireUser();
  try { await ex.approveExpense(user, id); } catch (e) { redirect(`/expenses/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/expenses/${id}?ok=${encodeURIComponent('Approved.')}`);
}
export async function returnExpenseAction(id: string, f: FormData) {
  const user = await requireUser();
  try { await ex.returnExpense(user, id, str(f, 'reason')); } catch (e) { redirect(`/expenses/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/expenses/${id}?ok=${encodeURIComponent('Returned for changes.')}`);
}
export async function cancelExpenseAction(id: string) {
  const user = await requireUser();
  try { await ex.cancelExpense(user, id); } catch (e) { redirect(`/expenses/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/expenses/${id}?ok=${encodeURIComponent('Cancelled.')}`);
}
export async function reimburseExpenseAction(id: string, f: FormData) {
  const user = await requireUser('finance');
  try { await ex.reimburseExpense(user, id, str(f, 'bank'), str(f, 'date')); } catch (e) { redirect(`/expenses/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/expenses/${id}?ok=${encodeURIComponent('Reimbursement recorded.')}`);
}
