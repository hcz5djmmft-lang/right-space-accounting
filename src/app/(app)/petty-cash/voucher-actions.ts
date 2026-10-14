'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/dates';
import { issuePettyCash, voidVoucher } from '@/lib/petty-vouchers';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (q: Record<string, string>): never => { revalidatePath('/', 'layout'); redirect(`/petty-cash?${new URLSearchParams(q)}`); };

export async function voucherAction(f: FormData) {
  const user = await requireUser('finance');
  const assign = s(f, 'assign');
  let id = '';
  try {
    id = await issuePettyCash(user, { date: s(f, 'date'), amount: parseAmount(s(f, 'amount')), paidTo: s(f, 'paid_to'), purpose: s(f, 'purpose'),
      project: assign.startsWith('p:') ? assign.slice(2) : null, dept: assign.startsWith('d:') ? assign.slice(2) : null, acc: s(f, 'account') });
  } catch (e) { back({ error: msg(e) }); }
  back({ ok: 'Petty cash paid from the office cash.', voucher: id });
}
export async function voidVoucherAction(id: string, f: FormData) {
  const user = await requireUser('finance');
  try { await voidVoucher(user, id, s(f, 'reason'), today()); } catch (e) { back({ error: msg(e) }); }
  back({ ok: 'Voided: the cash is back in the office cash.' });
}
