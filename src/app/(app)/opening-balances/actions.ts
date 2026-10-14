'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import { postOpening, saveOpening, voidOpening } from '@/lib/opening';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const back = (q: Record<string, string>): never => { revalidatePath('/', 'layout'); redirect('/opening-balances?' + new URLSearchParams(q)); };
const figures = (f: FormData) => [...new Set([...f.keys()].filter(k => /^(dr|cr)_/.test(k)).map(k => k.slice(3)))]
  .map(account => ({ account, dr: parseAmount(f.get('dr_' + account)), cr: parseAmount(f.get('cr_' + account)) }));

export async function saveOpeningAction(f: FormData) {
  const user = await requireUser('finance');
  const post = String(f.get('post') ?? '') === '1';
  try {
    await saveOpening(user, figures(f));
    if (post) await postOpening(user, String(f.get('date') ?? '') || undefined);
  } catch (e) { back({ error: msg(e) }); }
  back({ ok: post ? 'Opening entry posted.' : 'Opening balances saved. Post them when they are complete.' });
}
export async function voidOpeningAction(f: FormData) {
  const user = await requireUser('finance');
  try { await voidOpening(user, String(f.get('reason') ?? '')); } catch (e) { back({ error: msg(e) }); }
  back({ ok: 'Opening entry voided. Correct the figures and post again.' });
}
