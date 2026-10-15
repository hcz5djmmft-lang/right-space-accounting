'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/dates';
import { voidVoucher } from '@/lib/petty-vouchers';
import { type PaidToKind, approvePetty, createPetty, payPetty, returnPetty, voidPetty } from '@/lib/petty-docs';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (q: Record<string, string>, to = '/petty-cash'): never => { revalidatePath('/', 'layout'); redirect(`${to}?${new URLSearchParams(q)}`); };

/** A new petty cash, sent for approval (update 20). */
export async function voucherAction(f: FormData) {
  const user = await requireUser('finance');
  const assign = s(f, 'assign');
  const accs = f.getAll('account').map(String), descs = f.getAll('desc').map(String), amts = f.getAll('amount').map(String);
  let id = '';
  try {
    id = await createPetty(user, { date: s(f, 'date'), kind: s(f, 'kind') as PaidToKind, paidTo: s(f, 'paid_to'), purpose: s(f, 'purpose'),
      project: assign.startsWith('p:') ? assign.slice(2) : null, dept: assign.startsWith('d:') ? assign.slice(2) : null,
      lines: accs.map((acc, k) => ({ acc, desc: descs[k] ?? '', amount: parseAmount(amts[k] ?? '') })) });
  } catch (e) { back({ error: msg(e) }); }
  back({ ok: 'Petty cash sent for approval.' }, `/petty-cash/${id}`);
}
export async function approvePettyAction(id: string) {
  const user = await requireUser();
  try { await approvePetty(user, id); } catch (e) { back({ error: msg(e) }, `/petty-cash/${id}`); }
  back({ ok: 'Approved.' }, `/petty-cash/${id}`);
}
export async function returnPettyAction(id: string, f: FormData) {
  const user = await requireUser();
  try { await returnPetty(user, id, s(f, 'note')); } catch (e) { back({ error: msg(e) }, `/petty-cash/${id}`); }
  back({ ok: 'Returned.' }, `/petty-cash/${id}`);
}
export async function payPettyAction(id: string) {
  const user = await requireUser('finance');
  try { await payPetty(user, id, today()); } catch (e) { back({ error: msg(e) }, `/petty-cash/${id}`); }
  back({ ok: 'Paid from the office cash.' }, `/petty-cash/${id}`);
}
export async function voidPettyAction(id: string, f: FormData) {
  const user = await requireUser('finance');
  try { await voidPetty(user, id, s(f, 'reason'), today()); } catch (e) { back({ error: msg(e) }, `/petty-cash/${id}`); }
  back({ ok: 'Voided.' }, `/petty-cash/${id}`);
}
/** A petty cash made before update 20 (one line, posted at once). */
export async function voidVoucherAction(id: string, f: FormData) {
  const user = await requireUser('finance');
  try { await voidVoucher(user, id, s(f, 'reason'), today()); } catch (e) { back({ error: msg(e) }); }
  back({ ok: 'Voided: the cash is back in the office cash.' });
}
