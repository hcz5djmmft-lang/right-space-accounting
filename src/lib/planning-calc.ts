import { MASTER } from './qs-data';

// Schedule maths: planned progress to date, delays, the expected finish and the Gantt bars. Pure functions over activities;
// dates are 'YYYY-MM-DD' strings, durations in calendar days, both ends counted.

export type Activity = {
  id: string; category: string; name: string; position: number; start_date: string | null; end_date: string | null; base_start: string | null; base_end: string | null;
  progress: number; progress_at: string | null; note: string;
};

/** The default work categories of a schedule: the Master BOQ's ten sections. */
export const CATEGORIES = MASTER.sections.map(s => ({ no: s.no, title: s.title }));
export const categoryTitle = (no: string) => CATEGORIES.find(c => c.no === no)?.title ?? '';
/** Which schedule category each calculator's materials belong to (for the needed-by dates). */
export const CALCULATOR_CATEGORY: Record<string, string> = { bathroom: '2', kitchen: '2', electrical: '3', sanitary: '10', elecfin: '10' };
/** Materials are wanted on site this many days before the work starts. */
export const LEAD_DAYS = 7;
/** An activity is behind when its progress trails the plan by this many points. */
export const BEHIND_POINTS = 10;

const DAY = 86400000;
export const toDate = (s: string) => new Date(s + 'T00:00:00Z');
export const fromDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fromDate(new Date(toDate(s).getTime() + n * DAY));
/** Calendar days from a to b, both counted (1 when they are the same day; 0 when b is before a). */
export const daysBetween = (a: string, b: string) => Math.max(0, Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY) + 1);
export const duration = (a: Pick<Activity, 'start_date' | 'end_date'>) => (a.start_date && a.end_date ? daysBetween(a.start_date, a.end_date) : 0);

/** What the plan expected to be done by today: 0 before the start, 100 after the end, the elapsed share in between. */
export function plannedPct(a: Pick<Activity, 'start_date' | 'end_date'>, today: string): number {
  if (!a.start_date || !a.end_date) return 0;
  if (today < a.start_date) return 0;
  if (today >= a.end_date) return 100;
  return Math.round((daysBetween(a.start_date, today) / daysBetween(a.start_date, a.end_date)) * 100);
}
export const isDone = (a: Pick<Activity, 'progress'>) => Number(a.progress) >= 100;
/** Days past the planned end with work still open. */
export const overdueDays = (a: Pick<Activity, 'end_date' | 'progress'>, today: string) => (!a.end_date || isDone(a) || today <= a.end_date ? 0 : daysBetween(a.end_date, today) - 1);
/** Behind the plan: late, or trailing the planned progress by BEHIND_POINTS or more. */
export const isBehind = (a: Pick<Activity, 'start_date' | 'end_date' | 'progress'>, today: string) => !isDone(a) && (overdueDays(a, today) > 0 || plannedPct(a, today) - Number(a.progress) >= BEHIND_POINTS);

/** When the activity will finish at the planned pace: the remaining share of its duration from today (never before the plan). */
export function expectedEnd(a: Pick<Activity, 'start_date' | 'end_date' | 'progress'>, today: string): string | null {
  if (!a.start_date || !a.end_date) return null;
  if (isDone(a)) return a.end_date <= today ? a.end_date : today;
  if (today < a.start_date) return a.end_date;
  const remaining = Math.ceil(((100 - Number(a.progress)) / 100) * duration(a));
  const fromToday = addDays(today, Math.max(remaining - 1, 0));
  return fromToday > a.end_date ? fromToday : a.end_date;
}

export type Summary = { start: string | null; end: string | null; base_end: string | null; planned_pct: number; actual_pct: number; behind: number; expected_end: string | null; slip_days: number; activities: number; dated: number; done: number };
/** The project's schedule in one line: duration-weighted planned and actual %, how many activities are behind, the expected finish and its slip against the baseline. */
export function summarize(acts: Activity[], today: string): Summary {
  const dated = acts.filter(a => a.start_date && a.end_date);
  const w = (a: Activity) => duration(a) || 1;
  const tw = dated.reduce((t, a) => t + w(a), 0);
  const planned = tw ? Math.round(dated.reduce((t, a) => t + plannedPct(a, today) * w(a), 0) / tw) : 0;
  const actual = tw ? Math.round(dated.reduce((t, a) => t + Number(a.progress) * w(a), 0) / tw) : 0;
  const start = dated.map(a => a.start_date!).sort()[0] ?? null;
  const end = dated.map(a => a.end_date!).sort().at(-1) ?? null;
  const base_end = acts.map(a => a.base_end).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const expected = dated.map(a => expectedEnd(a, today)!).sort().at(-1) ?? null;
  const ref = base_end ?? end;
  return {
    start, end, base_end, planned_pct: planned, actual_pct: actual, behind: dated.filter(a => isBehind(a, today)).length, expected_end: expected,
    slip_days: expected && ref ? (expected > ref ? daysBetween(ref, expected) - 1 : 0) : 0, activities: acts.length, dated: dated.length, done: acts.filter(isDone).length,
  };
}

/** The Gantt's week columns from the earliest start to the latest end (planned or baseline), at least four weeks. */
export function weeks(acts: Activity[], today: string): string[] {
  const dates = acts.flatMap(a => [a.start_date, a.end_date, a.base_start, a.base_end]).filter((x): x is string => !!x);
  const first = (dates.length ? dates.sort()[0] : today), last = dates.length ? dates.sort().at(-1)! : addDays(today, 27);
  const monday = addDays(first, -((toDate(first).getUTCDay() + 6) % 7));
  const out: string[] = [];
  for (let d = monday; d <= last || out.length < 4; d = addDays(d, 7)) out.push(d);
  return out;
}
/** Left offset and width of a bar as a percentage of the chart's span. */
export function bar(from: string | null, to: string | null, first: string, spanDays: number) {
  if (!from || !to || spanDays <= 0) return null;
  const left = (daysBetween(first, from) - 1) / spanDays, width = daysBetween(from, to) / spanDays;
  return { left: Math.max(0, Math.round(left * 1000) / 10), width: Math.max(0.5, Math.round(Math.min(width, 1 - left) * 1000) / 10) };
}
export const weekLabel = (monday: string) => monday.slice(5).replace('-', '/');
