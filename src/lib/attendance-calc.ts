import { r2 } from './money';

// Attendance maths without a database: where the office is, when the day starts, how late is late and what an hour costs.
// Pure functions so the clock page and the tests share them.

export type HrSettings = {
  office_lat: number | null; office_lng: number | null; office_radius_m: number;
  work_start: string; work_end: string; grace_min: number; min_overtime_min: number;
  weekend: number[];              // JS weekdays, 0 = Sunday … 6 = Saturday; Egypt: Friday (5) and Saturday (6)
  hours_per_day: number; days_per_month: number; overtime_rate: number; late_deduction: boolean;
};
export const DEFAULT_HR: HrSettings = {
  office_lat: null, office_lng: null, office_radius_m: 200,
  work_start: '09:00', work_end: '17:00', grace_min: 15, min_overtime_min: 30, weekend: [5, 6],
  hours_per_day: 8, days_per_month: 22, overtime_rate: 1.35, late_deduction: true,
};
const num = (v: unknown, d: number) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
export function hrSettings(j: Record<string, unknown> | null | undefined): HrSettings {
  const s = { ...DEFAULT_HR };
  if (!j) return s;
  s.office_lat = j.office_lat === null || j.office_lat === undefined || j.office_lat === '' ? null : num(j.office_lat, 0);
  s.office_lng = j.office_lng === null || j.office_lng === undefined || j.office_lng === '' ? null : num(j.office_lng, 0);
  s.office_radius_m = num(j.office_radius_m, s.office_radius_m);
  if (typeof j.work_start === 'string' && /^\d\d:\d\d$/.test(j.work_start)) s.work_start = j.work_start;
  if (typeof j.work_end === 'string' && /^\d\d:\d\d$/.test(j.work_end)) s.work_end = j.work_end;
  s.grace_min = num(j.grace_min, s.grace_min); s.min_overtime_min = num(j.min_overtime_min, s.min_overtime_min);
  if (Array.isArray(j.weekend)) s.weekend = j.weekend.map(Number).filter(n => n >= 0 && n <= 6);
  s.hours_per_day = num(j.hours_per_day, s.hours_per_day); s.days_per_month = num(j.days_per_month, s.days_per_month);
  s.overtime_rate = num(j.overtime_rate, s.overtime_rate);
  if (typeof j.late_deduction === 'boolean') s.late_deduction = j.late_deduction;
  return s;
}
export const officeSet = (s: HrSettings) => s.office_lat !== null && s.office_lng !== null;

/** Metres between two GPS positions (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, rad = (d: number) => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** A moment as the company sees it: the day, minutes since midnight and the weekday, in the company time zone. */
export function localParts(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(at);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { day: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')), weekday: wd, time: `${g('hour')}:${g('minute')}` };
}

/** Lateness in minutes for a clock-in: after the day's start plus the grace; nothing on a weekend day. */
export function lateMinutes(inAt: Date, tz: string, s: HrSettings) {
  const l = localParts(inAt, tz);
  if (s.weekend.includes(l.weekday)) return 0;
  return Math.max(0, l.minutes - (hhmm(s.work_start) + s.grace_min));
}

/** Worked and overtime minutes once the person clocks out. On a weekend the whole stay is overtime; on a work day only what is beyond the day's end, and only from the minimum up. */
export function workedAndOvertime(inAt: Date, outAt: Date, tz: string, s: HrSettings) {
  const worked = Math.max(0, Math.round((outAt.getTime() - inAt.getTime()) / 60000));
  const li = localParts(inAt, tz), lo = localParts(outAt, tz);
  let overtime: number;
  if (s.weekend.includes(li.weekday)) overtime = worked;
  else {
    const end = hhmm(s.work_end);
    // a stay that crosses midnight counts its minutes after the day's end on the same day
    const outMin = lo.day === li.day ? lo.minutes : 24 * 60 + lo.minutes;
    overtime = Math.max(0, outMin - Math.max(end, li.minutes));
  }
  if (overtime < s.min_overtime_min) overtime = 0;
  return { worked, overtime };
}

export type Place = 'office' | 'site' | 'away' | 'unknown';
/** A project's location pin with its allowed distance, or null when the project has none yet. */
export type Pin = { lat: number; lng: number; radius_m: number } | null;

/** Where a clock-in happened. Rule 'site' (Site on a project): inside the project's pin is "site", outside is "away". Rule 'office' (Office, Design…):
 *  inside the office radius is "office", outside "away". Nothing to compare with (no pin on the project, no office set) or no GPS at all is "unknown": recorded, not checked. */
export function placeOf(rule: 'office' | 'site', pos: { lat: number; lng: number } | null, s: HrSettings, pin: Pin = null): { place: Place; distance: number | null } {
  if (!pos) return { place: 'unknown', distance: null };
  if (rule === 'site') {
    if (!pin) return { place: 'unknown', distance: null };
    const d = distanceM(pos.lat, pos.lng, pin.lat, pin.lng);
    return { place: d <= pin.radius_m ? 'site' : 'away', distance: d };
  }
  if (!officeSet(s)) return { place: 'unknown', distance: null };
  const d = distanceM(pos.lat, pos.lng, s.office_lat!, s.office_lng!);
  return { place: d <= s.office_radius_m ? 'office' : 'away', distance: d };
}

/** The place as a short pill: "at the office", "on site", "away", or why there is nothing to say. */
export const placeLabel = (place: string | null, hasPos: boolean) =>
  place === 'office' ? 'at the office' : place === 'site' ? 'on site' : place === 'away' ? 'away' : hasPos ? 'position recorded' : 'no location';

export const LOCATION_HELP = 'Allow the location for this site: in Safari tap aA next to the address, then Website Settings, Location, Allow.';
export type Where = { place: Place; distance: number | null; acc: number | null; hasPos: boolean; rule: 'office' | 'site'; compared: boolean };
/** The sentence the phone shows after a clock-in or clock-out: where the system saw the person, or why it could not compare. */
export function whereText(kind: 'in' | 'out', what: string, w: Where): string {
  const head = `${kind === 'in' ? 'Clocked in' : 'Clocked out'}${what ? ` ${what}` : ''}`;
  if (!w.hasPos) return `${head} without a location: your phone did not give one. ${LOCATION_HELP}`;
  const acc = w.acc ? ` (accurate to about ${w.acc} m)` : '';
  if (!w.compared) return `${head}. Your position was recorded${acc}; ${w.rule === 'site' ? 'this project has no location pin yet' : 'the office location is not set yet'}, so it was not compared.`;
  const target = w.rule === 'site' ? 'the project pin' : 'the office';
  if (w.place === 'away') return `${head} about ${w.distance} m from ${target}, outside the allowed distance; HR will see it.`;
  return w.rule === 'site' ? `${head}, ${w.distance} m from ${target}${acc}.` : `${head} at the office, ${w.distance} m from its pin${acc}.`;
}

/** What an hour of a person costs: the monthly pay over the standard monthly hours (HR sets hours a day and days a month). */
export const hourlyRate = (basic: number, allowances: number, s: HrSettings) => {
  const hours = (s.hours_per_day || 8) * (s.days_per_month || 22);
  return hours > 0 ? r2(((+basic || 0) + (+allowances || 0)) / hours) : 0;
};

/** The month's overtime pay and lateness deduction for one person, from the timesheet totals. */
export function timesheetAmounts(t: { overtime_min: number; late_min: number }, rate: number, s: HrSettings) {
  return {
    overtime: r2(t.overtime_min / 60 * rate * (s.overtime_rate || 1)),
    late: s.late_deduction ? r2(t.late_min / 60 * rate) : 0,
  };
}

export const fmtMin = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
