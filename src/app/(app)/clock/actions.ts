'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import * as att from '@/lib/attendance';
import { RuleError } from '@/lib/ledger';
import { trClockMessage } from '@/lib/i18n';
import { getLang } from '@/lib/lang';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was recorded.'));
const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));
const pickOf = (f: FormData) => ({ category: String(f.get('category') ?? ''), projectId: String(f.get('project') ?? '') || null, note: String(f.get('note') ?? '') });

/** Clock in or out from the phone: the selfie, the GPS position and what the day is for come in the form; the server decides the place and the minutes
 *  and sends back the sentence the phone shows (where it saw the person, or why it could not compare). */
export async function clockAction(kind: 'in' | 'out', form: FormData): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser();
  const lat = num(form.get('lat')), lng = num(form.get('lng')), acc = num(form.get('acc'));
  const pos = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng) ? { lat, lng, acc: acc !== null && !isNaN(acc) ? Math.round(acc) : null } : null;
  const f = form.get('photo');
  const photo = f instanceof File && f.size > 0 ? { name: f.name || 'selfie.jpg', body: Buffer.from(await f.arrayBuffer()) } : null;
  let message: string;
  try {
    message = (kind === 'in' ? await att.clockIn(user, pos, photo, new Date(), pickOf(form)) : await att.clockOut(user, pos, photo)).message;
  } catch (e) { return { error: msg(e) }; }
  revalidatePath('/clock'); revalidatePath('/attendance');
  return { ok: trClockMessage(await getLang(), message) };
}

/** The person moves to something else during the day (Office to Design on a project…): the stretch so far is closed, a new one starts. */
export async function switchAction(f: FormData) {
  const user = await requireUser();
  try { await att.switchTo(user, pickOf(f)); } catch (e) { redirect(`/clock?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/clock');
  redirect('/clock');
}
