'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import { DENOMINATIONS, approveTopup, countCash, rejectTopup, requestTopup, setFloat } from '@/lib/petty';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const back = (box: string, q: Record<string, string>): never => { revalidatePath('/', 'layout'); redirect(`/petty-cash?${new URLSearchParams({ box, ...q })}`); };
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function countAction(box: string, f: FormData) {
  const user = await requireUser('finance');
  let r = { counted: 0, difference: 0 };
  try { r = await countCash(user, box, s(f, 'date'), Object.fromEntries(DENOMINATIONS.map(d => [String(d), Number(s(f, `n_${d}`) || 0)])), s(f, 'remark')); }
  catch (e) { back(box, { error: msg(e) }); }
  back(box, { ok: r.difference ? `Count saved with a difference of ${r.difference.toFixed(2)}.` : 'Count saved. It agrees with the books.' });
}
export async function floatAction(box: string, f: FormData) {
  const user = await requireUser('finance');
  try { await setFloat(user, box, s(f, 'float') ? parseAmount(s(f, 'float')) : null); } catch (e) { back(box, { error: msg(e) }); }
  back(box, { ok: 'Float saved.' });
}
export async function topupAction(box: string, f: FormData) {
  const user = await requireUser('finance');
  try { await requestTopup(user, box, parseAmount(s(f, 'amount')), s(f, 'note')); } catch (e) { back(box, { error: msg(e) }); }
  back(box, { ok: 'Top-up request sent to Finance.' });
}
export async function approveTopupAction(box: string, id: string, f: FormData) {
  const user = await requireUser('finance');
  try { await approveTopup(user, id, s(f, 'bank')); } catch (e) { back(box, { error: msg(e) }); }
  back(box, { ok: 'Top-up approved and the transfer recorded.' });
}
export async function rejectTopupAction(box: string, id: string, f: FormData) {
  const user = await requireUser('finance');
  try { await rejectTopup(user, id, s(f, 'reason')); } catch (e) { back(box, { error: msg(e) }); }
  back(box, { ok: 'Top-up closed.' });
}
