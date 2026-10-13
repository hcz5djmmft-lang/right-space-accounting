'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import * as att from '@/lib/attendance';
import { RuleError } from '@/lib/ledger';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was recorded.'));
const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));

/** Clock in or out from the phone: the selfie and the GPS position come in the form; the server decides the place and the minutes. */
export async function clockAction(kind: 'in' | 'out', form: FormData): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser();
  const lat = num(form.get('lat')), lng = num(form.get('lng')), acc = num(form.get('acc'));
  const pos = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng) ? { lat, lng, acc: acc !== null && !isNaN(acc) ? Math.round(acc) : null } : null;
  const f = form.get('photo');
  const photo = f instanceof File && f.size > 0 ? { name: f.name || 'selfie.jpg', body: Buffer.from(await f.arrayBuffer()) } : null;
  try {
    if (kind === 'in') await att.clockIn(user, pos, photo); else await att.clockOut(user, pos, photo);
  } catch (e) { return { error: msg(e) }; }
  revalidatePath('/clock'); revalidatePath('/attendance');
  return { ok: kind === 'in' ? 'Clocked in.' : 'Clocked out.' };
}

export async function startDesignAction(f: FormData) {
  const user = await requireUser();
  try { await att.startDesign(user, String(f.get('project') ?? ''), String(f.get('note') ?? '')); } catch (e) { redirect(`/clock?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/clock');
  redirect('/clock');
}
export async function stopDesignAction() {
  const user = await requireUser();
  try { await att.stopDesign(user); } catch (e) { redirect(`/clock?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/clock');
  redirect('/clock');
}
