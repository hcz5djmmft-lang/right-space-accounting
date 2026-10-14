'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { closeMonth, reopenMonth, tickItem } from '@/lib/close';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const back = (period: string, q: Record<string, string>): never => { revalidatePath('/', 'layout'); redirect(`/close?${new URLSearchParams({ m: period, ...q })}`); };

export async function tickAction(period: string, key: string, on: boolean) {
  const user = await requireUser('finance');
  try { await tickItem(user, period, key, on); } catch (e) { back(period, { error: msg(e) }); }
  back(period, {});
}
export async function lockAction(period: string, f: FormData) {
  const user = await requireUser('management');
  try { await closeMonth(user, period, f.get('anyway') === 'on'); } catch (e) { back(period, { error: msg(e) }); }
  back(period, { ok: 'Month closed. The books are locked to its last day.' });
}
export async function reopenAction(period: string, f: FormData) {
  const user = await requireUser('management');
  try { await reopenMonth(user, period, String(f.get('reason') ?? '')); } catch (e) { back(period, { error: msg(e) }); }
  back(period, { ok: 'Month reopened. Entries can be posted in it again.' });
}
