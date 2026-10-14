'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { parseAmount } from '@/lib/money';
import { addAsset, postDepreciation, saveAssetCodes, stopAsset, voidDepreciation } from '@/lib/assets';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const back = (path: string, q: Record<string, string>): never => { revalidatePath('/', 'layout'); redirect(`${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams(q)}`); };
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function addAssetAction(f: FormData) {
  const user = await requireUser('finance');
  let id = '';
  try {
    id = await addAsset(user, { name: s(f, 'name'), category: s(f, 'category'), cc: s(f, 'cc'), in_service: s(f, 'in_service'), cost: parseAmount(s(f, 'cost')),
      salvage: parseAmount(s(f, 'salvage')), life_months: Number(s(f, 'life_months')), paid_from: s(f, 'paid_from') || undefined, notes: s(f, 'notes') });
  } catch (e) { back('/fixed-assets', { error: msg(e) }); }
  back(`/fixed-assets/${id}`, { ok: 'Asset added to the register.' });
}
export async function stopAssetAction(id: string, f: FormData) {
  const user = await requireUser('finance');
  try { await stopAsset(user, id, s(f, 'date'), s(f, 'note')); } catch (e) { back(`/fixed-assets/${id}`, { error: msg(e) }); }
  back(`/fixed-assets/${id}`, { ok: 'Depreciation stopped.' });
}
export async function postDepreciationAction(period: string) {
  const user = await requireUser('finance');
  try { await postDepreciation(user, period); } catch (e) { back(`/fixed-assets?m=${period}`, { error: msg(e) }); }
  back(`/fixed-assets?m=${period}`, { ok: `Depreciation for ${period} posted.` });
}
export async function voidDepreciationAction(period: string, f: FormData) {
  const user = await requireUser('finance');
  try { await voidDepreciation(user, period, s(f, 'reason')); } catch (e) { back(`/fixed-assets?m=${period}`, { error: msg(e) }); }
  back(`/fixed-assets?m=${period}`, { ok: `Depreciation for ${period} voided. Post it again when ready.` });
}
export async function saveCodesAction(f: FormData) {
  const user = await requireUser('finance');
  try { await saveAssetCodes(user, { fixedAssets: s(f, 'fixedAssets'), accDep: s(f, 'accDep'), depExp: s(f, 'depExp') }); } catch (e) { back('/fixed-assets', { error: msg(e) }); }
  back('/fixed-assets', { ok: 'GL codes saved.' });
}
