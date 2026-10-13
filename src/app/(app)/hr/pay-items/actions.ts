'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import * as pi from '@/lib/pay-items';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (month: string, err?: string) => redirect(`/hr/pay-items?month=${month}${err ? `&error=${encodeURIComponent(err)}` : '&saved=1'}`);

export async function addPayItemAction(f: FormData) {
  const user = await requireUser('hr', 'finance');
  const period = s(f, 'period');
  try { await pi.addPayItem(user, { employee_id: s(f, 'employee_id'), period, kind: s(f, 'kind') as pi.Kind, amount: parseAmount(f.get('amount')), note: s(f, 'note') }); }
  catch (e) { back(period, msg(e)); }
  revalidatePath('/hr/pay-items');
  back(period);
}
export async function removePayItemAction(month: string, id: string) {
  const user = await requireUser('hr', 'finance');
  try { await pi.removePayItem(user, id); } catch (e) { back(month, msg(e)); }
  revalidatePath('/hr/pay-items');
  back(month);
}
export async function addLoanAction(month: string, f: FormData) {
  const user = await requireUser('hr', 'finance');
  try { await pi.addLoan(user, { employee_id: s(f, 'employee_id'), amount: parseAmount(f.get('amount')), monthly: parseAmount(f.get('monthly')), start_period: s(f, 'start_period'), note: s(f, 'note') }); }
  catch (e) { back(month, msg(e)); }
  revalidatePath('/hr/pay-items');
  back(month);
}
export async function instalmentsAction(month: string) {
  const user = await requireUser('hr', 'finance');
  try { await pi.dueInstalments(user, month); } catch (e) { back(month, msg(e)); }
  revalidatePath('/hr/pay-items');
  back(month);
}
