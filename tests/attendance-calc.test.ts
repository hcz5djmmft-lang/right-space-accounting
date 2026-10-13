import { describe, expect, it } from 'vitest';
import { DEFAULT_HR, distanceM, fmtMin, hourlyRate, hrSettings, lateMinutes, localParts, placeOf, timesheetAmounts, workedAndOvertime } from '@/lib/attendance-calc';

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
    expect(placeOf('site', { lat: 30.0, lng: 31.0 }, s)).toMatchObject({ place: 'site' });
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
