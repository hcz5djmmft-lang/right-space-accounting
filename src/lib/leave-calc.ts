// Leave maths without a database: Egyptian labour law as Adel stated it (21 days a year, 30 after ten years of service or from age 50).

export const LEAVE_TYPES = [
  ['annual', 'Annual leave'], ['casual', 'Casual leave (from the annual balance, 2 days at a time)'], ['sick', 'Sick leave'], ['unpaid', 'Unpaid leave'], ['other', 'Other (mission, training…)'],
] as const;
export type LeaveType = typeof LEAVE_TYPES[number][0];
/** Types that use up the annual balance. */
export const FROM_BALANCE: readonly LeaveType[] = ['annual', 'casual'];

const d = (s: string) => new Date(s + 'T00:00:00Z');
const yearsBetween = (from: string, to: string) => {
  const a = d(from), b = d(to);
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return y;
};

/** Days of annual leave for a year: 30 with ten years of service or age 50 by the end of the year, else 21; the hire year is pro rata by whole months left. */
export function entitlement(hire: string | null, birth: string | null, year: number): number {
  const end = `${year}-12-31`;
  const full = (hire && yearsBetween(hire, end) >= 10) || (birth && yearsBetween(birth, end) >= 50) ? 30 : 21;
  if (hire && d(hire).getUTCFullYear() === year) {
    const months = 12 - d(hire).getUTCMonth();  // hired in March: ten months of the year
    return Math.floor(full * months / 12);
  }
  if (hire && d(hire).getUTCFullYear() > year) return 0;
  return full;
}

/** Working days from one date to another, both included, skipping the weekend days (JS weekdays). */
export function workingDays(from: string, to: string, weekend: number[]): number {
  const a = d(from), b = d(to);
  if (b < a) return 0;
  let n = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += 864e5) if (!weekend.includes(new Date(t).getUTCDay())) n++;
  return n;
}

/** What a request must satisfy before it is filed. */
export function checkRequest(r: { type: LeaveType; from: string; to: string; days: number; balance: number }): string | null {
  if (!/^\d{4}-\d\d-\d\d$/.test(r.from) || !/^\d{4}-\d\d-\d\d$/.test(r.to)) return 'Choose the first and the last day.';
  if (r.to < r.from) return 'The last day is before the first day.';
  if (r.from.slice(0, 4) !== r.to.slice(0, 4)) return 'A request stays within one year; make two requests.';
  if (r.days <= 0) return 'Those days are all weekend days.';
  if (r.type === 'casual' && r.days > 2) return 'Casual leave is at most 2 days at a time.';
  if (FROM_BALANCE.includes(r.type) && r.days > r.balance) return `Only ${r.balance} days of annual leave are left this year.`;
  return null;
}
