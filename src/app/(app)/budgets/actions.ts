'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import { copyBudgets, importBudgets, raiseBudgetAlerts, saveBudgets } from '@/lib/budgets';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const back = (m: string, q: Record<string, string>): never => { revalidatePath('/', 'layout'); redirect(`/budgets?${new URLSearchParams({ m, ...q })}`); };
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** The table's amounts (amt_<cc>|<account>) plus the new line, if one was typed. */
export async function saveBudgetsAction(period: string, f: FormData) {
  const user = await requireUser('finance');
  const lines = [...f.keys()].filter(k => k.startsWith('amt_')).map(k => {
    const [cc, account] = k.slice(4).split('|');
    return { period, cc, account: account || null, amount: parseAmount(f.get(k)) };
  });
  if (s(f, 'new_cc') && s(f, 'new_amount')) lines.push({ period, cc: s(f, 'new_cc'), account: s(f, 'new_account') || null, amount: parseAmount(s(f, 'new_amount')) });
  let n = 0;
  try { n = await saveBudgets(user, lines); await raiseBudgetAlerts(); } catch (e) { back(period, { error: msg(e) }); }
  back(period, { ok: `${n} budget lines saved.` });
}
export async function copyBudgetsAction(period: string) {
  const user = await requireUser('finance');
  let n = 0;
  try { n = await copyBudgets(user, period); } catch (e) { back(period, { error: msg(e) }); }
  back(period, { ok: `${n} budget lines copied from the month before.` });
}
export async function uploadBudgetsAction(period: string, f: FormData) {
  const user = await requireUser('finance');
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) back(period, { error: 'Choose the Excel or CSV file.' });
  const fl = file as File;
  if (fl.size > 4 * 1024 * 1024) back(period, { error: 'The file is larger than 4 MB.' });
  let n = 0;
  try { n = await importBudgets(user, Buffer.from(await fl.arrayBuffer()), fl.name); await raiseBudgetAlerts(); } catch (e) { back(period, { error: msg(e) }); }
  back(period, { ok: `${n} budget lines uploaded.` });
}
