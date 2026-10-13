'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import * as att from '@/lib/attendance';
import { hrSettings } from '@/lib/attendance-calc';
import { RuleError } from '@/lib/ledger';
import { TZ } from '@/lib/dates';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function checkAction(employeeId: string, period: string, id: string, f: FormData) {
  const user = await requireUser('hr');
  const back = `/attendance/${employeeId}?month=${period}`;
  try { await att.checkRecord(user, id, s(f, 'note')); } catch (e) { redirect(`${back}&error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/attendance');
  redirect(back);
}

/** Closes a day the person forgot to clock out of, at the local time HR types (Cairo). */
export async function closeAction(employeeId: string, period: string, id: string, f: FormData) {
  const user = await requireUser('hr');
  const back = `/attendance/${employeeId}?month=${period}`;
  const local = s(f, 'out_at'); // YYYY-MM-DDTHH:MM in company time
  try {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) throw new RuleError('Type the clock-out time.');
    await att.closeRecord(user, id, fromLocal(local), s(f, 'note'));
  } catch (e) { redirect(`${back}&error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/attendance');
  redirect(back);
}
/** A wall-clock time in the company zone as an instant: the zone's offset at that moment is read back from Intl. */
function fromLocal(local: string): Date {
  const guess = new Date(local + 'Z');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const g = (t: string) => Number(parts.find(x => x.type === t)?.value);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

export async function saveHrAction(f: FormData) {
  const user = await requireUser('hr');
  const weekend = f.getAll('weekend').map(Number);
  const next = hrSettings({
    office_lat: s(f, 'office_lat'), office_lng: s(f, 'office_lng'), office_radius_m: s(f, 'office_radius_m'),
    work_start: s(f, 'work_start'), work_end: s(f, 'work_end'), grace_min: s(f, 'grace_min'), min_overtime_min: s(f, 'min_overtime_min'), weekend,
    hours_per_day: s(f, 'hours_per_day'), days_per_month: s(f, 'days_per_month'), overtime_rate: s(f, 'overtime_rate'), late_deduction: f.get('late_deduction') === 'on',
  });
  try {
    if ((next.office_lat === null) !== (next.office_lng === null)) throw new RuleError('Enter both the latitude and the longitude of the office, or clear both.');
    if (next.office_lat !== null && (Math.abs(next.office_lat) > 90 || Math.abs(next.office_lng!) > 180)) throw new RuleError('That is not a valid position.');
    await att.saveHr(user, next);
  } catch (e) { redirect(`/hr/settings?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect('/hr/settings?saved=1');
}
