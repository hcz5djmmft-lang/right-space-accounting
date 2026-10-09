'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { saveStatement, setCleared } from '@/lib/banks';

function back(code: string, from: string, to: string, msg: { error?: string; ok?: string }) {
  const q = new URLSearchParams({ account: code, from, to, ...(msg.error ? { error: msg.error } : {}), ...(msg.ok ? { ok: msg.ok } : {}) });
  revalidatePath('/banks');
  redirect('/banks?' + q);
}
const err = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));

export async function statementAction(f: FormData) {
  const user = await requireUser('finance');
  const code = String(f.get('account') ?? ''), from = String(f.get('from') ?? ''), to = String(f.get('to') ?? '');
  const bal = String(f.get('balance') ?? '').trim();
  try { await saveStatement(user, code, String(f.get('date') ?? '') || null, bal === '' ? null : parseAmount(bal)); }
  catch (e) { back(code, from, to, { error: err(e) }); }
  back(code, from, to, { ok: 'Statement saved.' });
}

export async function clearedAction(f: FormData) {
  const user = await requireUser('finance');
  const code = String(f.get('account') ?? ''), from = String(f.get('from') ?? ''), to = String(f.get('to') ?? '');
  const shown = String(f.get('shown') ?? '').split(',').filter(Boolean).map(Number);
  const on = [...f.keys()].filter(k => k.startsWith('line_')).map(k => Number(k.slice(5)));
  try { await setCleared(user, code, shown, on); }
  catch (e) { back(code, from, to, { error: err(e) }); }
  back(code, from, to, { ok: 'Cleared lines saved.' });
}
