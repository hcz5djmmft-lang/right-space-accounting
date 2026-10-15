import { describe, expect, it } from 'vitest';
import { DEFAULT_HR, distanceM, fmtMin, hourlyRate, hrSettings, lateMinutes, localParts, placeLabel, placeOf, timesheetAmounts, whereText, workedAndOvertime } from '@/lib/attendance-calc';
import { CATEGORIES, categoryOf, defaultPick, offeredCategories, whatLabel, whatPhrase } from '@/lib/clock-categories';

const TZ = 'Africa/Cairo'; // UTC+3 in October 2026 (no DST change in these dates)
const at = (iso: string) => new Date(iso);

describe('attendance maths', () => {
  it('reads the company day and time in Cairo, even when the server is on UTC', () => {
    expect(localParts(at('2026-10-13T06:05:00Z'), TZ)).toEqual({ day: '2026-10-13', minutes: 9 * 60 + 5, weekday: 2, time: '09:05' });
    expect(localParts(at('2026-10-13T22:30:00Z'), TZ)).toMatchObject({ day: '2026-10-14', time: '01:30' });
  });
  it('lateness starts after the day start plus the grace; weekends are never late', () => {
    expect(lateMinutes(at('2026-10-13T06:10:00Z'), TZ, DEFAULT_HR)).toBe(0);   // 09:10, within the 15 min grace
    expect(lateMinutes(at('2026-10-13T06:40:00Z'), TZ, DEFAULT_HR)).toBe(25);  // 09:40
    expect(lateMinutes(at('2026-10-16T07:00:00Z'), TZ, DEFAULT_HR)).toBe(0);   // Friday
    expect(lateMinutes(at('2026-10-13T07:00:00Z'), TZ, { ...DEFAULT_HR, work_start: '10:00', grace_min: 0 })).toBe(0);
  });
  it('overtime is what runs past the day end, from the minimum up; a weekend day is all overtime', () => {
    expect(workedAndOvertime(at('2026-10-13T06:00:00Z'), at('2026-10-13T14:20:00Z'), TZ, DEFAULT_HR)).toEqual({ worked: 500, overtime: 0 });    // 09:00–17:20, under 30 min
    expect(workedAndOvertime(at('2026-10-13T06:00:00Z'), at('2026-10-13T15:30:00Z'), TZ, DEFAULT_HR)).toEqual({ worked: 570, overtime: 90 });   // until 18:30
    expect(workedAndOvertime(at('2026-10-13T15:00:00Z'), at('2026-10-13T17:00:00Z'), TZ, DEFAULT_HR)).toEqual({ worked: 120, overtime: 120 });  // came in at 18:00
    expect(workedAndOvertime(at('2026-10-16T07:00:00Z'), at('2026-10-16T11:00:00Z'), TZ, DEFAULT_HR)).toEqual({ worked: 240, overtime: 240 });  // Friday
    expect(workedAndOvertime(at('2026-10-13T06:00:00Z'), at('2026-10-13T22:00:00Z'), TZ, DEFAULT_HR)).toEqual({ worked: 960, overtime: 480 });  // until 01:00 next day
  });
  it('the office radius decides Office staff, Site staff are always "site", no GPS is unknown', () => {
    const s = hrSettings({ office_lat: 31.2001, office_lng: 29.9187, office_radius_m: 150 });
    expect(distanceM(31.2001, 29.9187, 31.2001, 29.9187)).toBe(0);
    expect(distanceM(31.2001, 29.9187, 31.2010, 29.9187)).toBe(100);
    expect(placeOf('office', { lat: 31.2005, lng: 29.9190 }, s)).toMatchObject({ place: 'office' });
    expect(placeOf('office', { lat: 31.2100, lng: 29.9187 }, s)).toMatchObject({ place: 'away', distance: 1101 });
    expect(placeOf('office', null, s)).toEqual({ place: 'unknown', distance: null });
    expect(placeOf('office', { lat: 31.2100, lng: 29.9187 }, DEFAULT_HR)).toEqual({ place: 'unknown', distance: null });
    expect(placeOf('site', { lat: 30.0, lng: 31.0 }, s)).toEqual({ place: 'unknown', distance: null });                    // no pin on the project: recorded, not checked
    const pin = { lat: 30.0444, lng: 31.2357, radius_m: 150 };
    expect(placeOf('site', { lat: 30.0449, lng: 31.2360 }, s, pin)).toEqual({ place: 'site', distance: 63 });
    expect(placeOf('site', { lat: 30.0544, lng: 31.2357 }, s, pin)).toEqual({ place: 'away', distance: 1112 });
    expect(placeOf('site', null, s, pin)).toEqual({ place: 'unknown', distance: null });
    expect(placeLabel('office', true)).toBe('at the office'); expect(placeLabel('site', true)).toBe('on site'); expect(placeLabel('away', true)).toBe('away');
    expect(placeLabel('unknown', true)).toBe('position recorded'); expect(placeLabel('unknown', false)).toBe('no location'); expect(placeLabel(null, false)).toBe('no location');
  });
  it('the phone is told where the system saw the person, or why it could not compare', () => {
    const base = { place: 'office' as const, distance: 40, acc: 8, hasPos: true, rule: 'office' as const, compared: true };
    expect(whereText('in', '', base)).toBe('Clocked in at the office, 40 m from its pin (accurate to about 8 m).');
    expect(whereText('out', 'for design on PH-B1302', { ...base, acc: null })).toBe('Clocked out for design on PH-B1302 at the office, 40 m from its pin.');
    expect(whereText('in', '', { ...base, place: 'unknown', distance: null, compared: false })).toBe('Clocked in. Your position was recorded (accurate to about 8 m); the office location is not set yet, so it was not compared.');
    expect(whereText('in', 'on site PH-B1302', { ...base, rule: 'site', place: 'site', distance: null, compared: false })).toBe('Clocked in on site PH-B1302. Your position was recorded (accurate to about 8 m); this project has no location pin yet, so it was not compared.');
    expect(whereText('in', 'on site PH-B1302', { ...base, rule: 'site', place: 'site', distance: 63 })).toBe('Clocked in on site PH-B1302, 63 m from the project pin (accurate to about 8 m).');
    expect(whereText('out', '', { ...base, place: 'away', distance: 900 })).toBe('Clocked out about 900 m from the office, outside the allowed distance; HR will see it.');
    expect(whereText('in', '', { ...base, hasPos: false, place: 'unknown', distance: null, acc: null })).toBe('Clocked in without a location: your phone did not give one. Allow the location for this site: in Safari tap aA next to the address, then Website Settings, Location, Allow.');
  });
  it('the categories are data: who gets which, what is preselected, how they read', () => {
    expect(CATEGORIES.map(c => c.key)).toEqual(['office', 'site', 'design', 'payments', 'collections', 'payroll', 'bank_cash', 'cost_control', 'reports']);
    expect(new Set(CATEGORIES.map(c => c.key)).size).toBe(CATEGORIES.length);
    expect(offeredCategories({ dept_name: null }).map(c => c.key)).toEqual(['office', 'site']);   // update 20: Office or Site for everyone
    expect(offeredCategories({ dept_name: 'Admin', work_location: 'site' }).map(c => c.key)).toEqual(['office', 'site']);
    expect(offeredCategories({ dept_name: 'Engineering', work_location: 'office' }).map(c => c.key)).toEqual(['office', 'site', 'design']);
    expect(offeredCategories({ dept_name: null }, { roles: ['projects'] }).map(c => c.key)).toEqual(['office', 'site', 'design']);
    expect(offeredCategories({ dept_name: 'Finance' }).map(c => c.key)).toEqual(['office', 'site', 'payments', 'collections', 'payroll', 'bank_cash', 'cost_control', 'reports']);
    expect(offeredCategories({ dept_name: null }, { roles: ['finance'] })).toHaveLength(8);
    expect(offeredCategories({ dept_name: 'Admin' }, { roles: ['management'] })).toHaveLength(9);
    expect(defaultPick({ work_location: 'site', project_id: 'p1' }, null)).toEqual({ category: 'site', projectId: 'p1' });
    expect(defaultPick({ work_location: 'office', project_id: null }, null)).toEqual({ category: 'office', projectId: null });
    expect(defaultPick({ work_location: 'office', project_id: null }, { category: 'design', project_id: 'p2' })).toEqual({ category: 'office', projectId: null });   // update 20: design is clocked on the Design page
    expect(defaultPick({ work_location: 'office', project_id: null }, { category: 'gone', project_id: null })).toEqual({ category: 'office', projectId: null });
    expect(whatLabel(categoryOf('office'), null)).toBe('Office'); expect(whatLabel(categoryOf('site'), 'PH-B1302')).toBe('Site on PH-B1302'); expect(whatLabel(categoryOf('site'), null)).toBe('Site'); expect(whatLabel(categoryOf('bank_cash'), null)).toBe('Bank and petty cash');
    expect(whatPhrase(categoryOf('design')!, 'PH-B1302')).toBe('for design on PH-B1302'); expect(whatPhrase(categoryOf('design')!, null)).toBe('for design'); expect(whatPhrase(categoryOf('site')!, null)).toBe('on site');
    expect(whatPhrase(categoryOf('office')!, null)).toBe(''); expect(whatPhrase(categoryOf('reports')!, null)).toBe('for reports, tax and closing');
  });
  it('an hour costs the monthly pay over the standard hours; overtime and lateness are priced from it', () => {
    expect(hourlyRate(10000, 2000, DEFAULT_HR)).toBe(68.18);                     // 12,000 / 176
    expect(hourlyRate(8800, 0, hrSettings({ hours_per_day: 8, days_per_month: 22 }))).toBe(50);
    expect(timesheetAmounts({ overtime_min: 120, late_min: 30 }, 50, DEFAULT_HR)).toEqual({ overtime: 135, late: 25 });
    expect(timesheetAmounts({ overtime_min: 120, late_min: 30 }, 50, { ...DEFAULT_HR, late_deduction: false })).toEqual({ overtime: 135, late: 0 });
  });
  it('settings read what HR typed and fall back to the defaults', () => {
    expect(hrSettings(null)).toEqual(DEFAULT_HR);
    expect(hrSettings({ office_lat: '', office_lng: '', work_start: '8:30', grace_min: 'x', weekend: ['5'] })).toMatchObject({ office_lat: null, work_start: '09:00', grace_min: 15, weekend: [5] });
    expect(fmtMin(125)).toBe('2:05');
  });
});
