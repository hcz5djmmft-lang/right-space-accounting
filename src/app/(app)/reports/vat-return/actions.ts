'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { prepareVatReturn, unprepareVatReturn } from '@/lib/tax-returns';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const back = (m: string, q: Record<string, string>): never => { revalidatePath('/', 'layout'); redirect(`/reports/vat-return?${new URLSearchParams({ m, ...q })}`); };

export async function prepareAction(period: string) {
  const user = await requireUser('finance');
  try { await prepareVatReturn(user, period); } catch (e) { back(period, { error: msg(e) }); }
  back(period, { ok: 'VAT return marked as prepared. It is ticked on the month-end close.' });
}
export async function unprepareAction(period: string) {
  const user = await requireUser('finance');
  try { await unprepareVatReturn(user, period); } catch (e) { back(period, { error: msg(e) }); }
  back(period, { ok: 'VAT return marked as not prepared.' });
}
