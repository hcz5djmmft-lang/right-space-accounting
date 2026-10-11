'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { postDeposit, postWithdrawal, shareProfit } from '@/lib/partners';

function back(partner: string, msg: { error?: string; ok?: string }) {
  const q = new URLSearchParams({ ...(partner ? { partner } : {}), ...(msg.error ? { error: msg.error } : {}), ...(msg.ok ? { ok: msg.ok } : {}) });
  revalidatePath('/', 'layout');
  redirect('/partners?' + q);
}
const err = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
async function posted(id: string) {
  const [e] = await sql<{ no: string; payment_ref: string | null }[]>`select no, payment_ref from journal_entries where id = ${id}`;
  return `${e.no}${e.payment_ref ? ` · ref ${e.payment_ref}` : ''}`;
}
const money = (f: FormData) => ({
  partner: String(f.get('partner') ?? ''), bank: String(f.get('bank') ?? ''), date: String(f.get('date') ?? ''),
  amount: parseAmount(f.get('amount')), memo: String(f.get('memo') ?? '').trim(),
});

export async function depositAction(f: FormData) {
  const user = await requireUser('finance');
  const p = money(f);
  let id = '';
  try { id = await postDeposit(user, p); } catch (e) { back(p.partner, { error: err(e) }); }
  back(p.partner, { ok: `Money put in recorded (${await posted(id)}).` });
}

export async function withdrawalAction(f: FormData) {
  const user = await requireUser('finance');
  const p = money(f);
  let id = '';
  try { id = await postWithdrawal(user, p); } catch (e) { back(p.partner, { error: err(e) }); }
  back(p.partner, { ok: `Withdrawal recorded (${await posted(id)}).` });
}

export async function shareAction(f: FormData) {
  const user = await requireUser('management');
  let id = '';
  try { id = await shareProfit(user, { from: String(f.get('from') ?? ''), to: String(f.get('to') ?? ''), date: String(f.get('date') ?? '') }); }
  catch (e) { back('', { error: err(e) }); }
  back('', { ok: `Profit shared out (${await posted(id)}).` });
}
