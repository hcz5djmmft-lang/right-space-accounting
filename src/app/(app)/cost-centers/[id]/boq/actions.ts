'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { deleteBoq, setBoqAccounts, uploadBoq } from '@/lib/boq';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
function back(id: string, m: { error?: string; ok?: string }) {
  revalidatePath(`/cost-centers/${id}/boq`);
  redirect(`/cost-centers/${id}/boq?` + new URLSearchParams(m as Record<string, string>));
}

export async function uploadBoqAction(id: string, f: FormData) {
  const user = await requireUser();
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) back(id, { error: 'Choose the BOQ file (Excel .xlsx or CSV).' });
  const fl = file as File;
  if (fl.size > 8 * 1024 * 1024) back(id, { error: 'That file is over 8 MB.' });
  let ok = '';
  try {
    const r = await uploadBoq(user, id, fl.name, Buffer.from(await fl.arrayBuffer()));
    ok = `BOQ uploaded: ${r.lines} lines, ${r.matched} matched to a GL code${r.lines - r.matched ? `; match the other ${r.lines - r.matched} below` : ''}.`;
  } catch (e) { back(id, { error: msg(e) }); }
  back(id, { ok });
}

export async function boqCodesAction(id: string, f: FormData) {
  const user = await requireUser();
  const codes = Object.fromEntries([...f.keys()].filter(k => k.startsWith('acc_')).map(k => [k.slice(4), String(f.get(k) ?? '')]));
  try { await setBoqAccounts(user, id, codes); } catch (e) { back(id, { error: msg(e) }); }
  back(id, { ok: 'GL codes saved.' });
}

export async function deleteBoqAction(id: string) {
  const user = await requireUser();
  try { await deleteBoq(user, id); } catch (e) { back(id, { error: msg(e) }); }
  back(id, { ok: 'BOQ removed.' });
}
