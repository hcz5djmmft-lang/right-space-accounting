'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { voidCustomerReceipt } from '@/lib/sales';
import { RuleError } from '@/lib/ledger';

function msg(e: unknown) {
  if (e instanceof RuleError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  if (/locked|balanced|posted|cannot/.test(m)) return m;
  console.error(e);
  return 'Something went wrong. Nothing was changed.';
}

export async function voidReceipt(id: string, f: FormData) {
  const user = await requireUser('finance');
  let err = '';
  try { await voidCustomerReceipt(user, id, String(f.get('reason') ?? ''), String(f.get('date') ?? '')); } catch (e) { err = msg(e); }
  revalidatePath('/', 'layout');
  redirect(err ? `/receipts/${id}?error=${encodeURIComponent(err)}` : `/receipts/${id}`);
}
