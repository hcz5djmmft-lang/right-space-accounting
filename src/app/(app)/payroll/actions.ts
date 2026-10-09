'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import * as pay from '@/lib/payroll';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';

const Emp = z.object({
  id: z.string().optional(), code: z.string().default(''), name: z.string().min(1, 'Enter the employee name'), job_title: z.string().default(''),
  dept_id: z.string().nullish(), project_id: z.string().nullish(), hire_date: z.string().nullish(),
  basic: z.number().min(0), allowances: z.number().min(0), insurable: z.number().min(0), bank_account: z.string().default(''), active: z.boolean(),
});

function msg(e: unknown) {
  if (e instanceof RuleError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  if (/locked|balanced|posted|cannot|duplicate key/.test(m)) return m.includes('duplicate key') ? 'That employee code is already used.' : m;
  console.error(e);
  return 'Something went wrong. Nothing was changed.';
}

export async function saveEmployeeAction(raw: unknown): Promise<{ error?: string; id?: string }> {
  const user = await requireUser('finance');
  const p = Emp.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Check the form.' };
  try { const id = await pay.saveEmployee(user, p.data); revalidatePath('/payroll'); return { id }; } catch (e) { return { error: msg(e) }; }
}
export async function deleteEmployeeAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser('finance');
  try { await pay.deleteEmployee(user, id); revalidatePath('/payroll'); return {}; } catch (e) { return { error: msg(e) }; }
}

async function act(period: string, fn: () => Promise<unknown>, done = `/payroll/runs/${period}`) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  revalidatePath('/', 'layout');
  redirect(err ? `/payroll/runs/${period}?error=${encodeURIComponent(err)}` : done);
}
export async function createRunAction(f: FormData) {
  const user = await requireUser('finance');
  const period = String(f.get('period') ?? '');
  let err = '';
  try { await pay.createRun(user, period, String(f.get('date') ?? '')); } catch (e) { err = msg(e); }
  revalidatePath('/payroll');
  redirect(err ? `/payroll?tab=runs&error=${encodeURIComponent(err)}` : `/payroll/runs/${period}`);
}
export async function saveRunAction(period: string, f: FormData) {
  const user = await requireUser('finance');
  const edits = [...f.keys()].filter(k => k.startsWith('ot_')).map(k => {
    const emp = k.slice(3);
    return { employee_id: emp, overtime: parseAmount(f.get(k)), deductions: parseAmount(f.get('ded_' + emp)) };
  });
  await act(period, () => pay.saveRun(user, period, edits, f.get('refresh') === '1'));
}
export async function postRunAction(period: string) { const u = await requireUser('finance'); await act(period, () => pay.postRun(u, period)); }
export async function deleteRunAction(period: string) { const u = await requireUser('finance'); await act(period, () => pay.deleteRun(u, period), '/payroll?tab=runs'); }
export async function payRunAction(period: string, f: FormData) {
  const u = await requireUser('finance');
  await act(period, () => pay.paySalaries(u, period, String(f.get('bank') ?? ''), String(f.get('date') ?? '')));
}
