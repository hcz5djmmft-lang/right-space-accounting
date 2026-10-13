// Schedule maths: inclusive day counts, planned progress to date, delays, the expected finish, the project summary and the Gantt columns.
import { describe, expect, it } from 'vitest';
import { type Activity, BEHIND_POINTS, CALCULATOR_CATEGORY, CATEGORIES, addDays, bar, daysBetween, expectedEnd, isBehind, overdueDays, plannedPct, summarize, weekLabel, weeks } from '@/lib/planning-calc';

const act = (o: Partial<Activity>): Activity => ({ id: 'a', category: 'other', name: 'Work', position: 1, start_date: null, end_date: null, base_start: null, base_end: null, progress: 0, progress_at: null, note: '', ...o });
const A = act({ start_date: '2026-10-01', end_date: '2026-10-10' });   // ten days

describe('days', () => {
  it('counts both ends and never goes negative', () => {
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-10-10')).toBe(10);
    expect(daysBetween('2026-10-10', '2026-10-01')).toBe(0);
    expect(addDays('2026-10-28', 5)).toBe('2026-11-02');
    expect(addDays('2026-10-01', -7)).toBe('2026-09-24');
  });
  it('uses the Master BOQ sections as the work categories', () => {
    expect(CATEGORIES).toHaveLength(10);
    expect(CATEGORIES[1].no).toBe('2');
    expect(Object.keys(CALCULATOR_CATEGORY)).toEqual(['bathroom', 'kitchen', 'electrical', 'sanitary', 'elecfin']);
  });
});

describe('an activity against the plan', () => {
  it('is planned at 0 before the start, the elapsed share in between and 100 from the end', () => {
    expect(plannedPct(A, '2026-09-30')).toBe(0);
    expect(plannedPct(A, '2026-10-05')).toBe(50);
    expect(plannedPct(A, '2026-10-10')).toBe(100);
    expect(plannedPct(A, '2026-10-20')).toBe(100);
    expect(plannedPct(act({}), '2026-10-05')).toBe(0);
  });
  it('is late once the end has passed with work open', () => {
    expect(overdueDays({ ...A, progress: 50 }, '2026-10-10')).toBe(0);
    expect(overdueDays({ ...A, progress: 50 }, '2026-10-13')).toBe(3);
    expect(overdueDays({ ...A, progress: 100 }, '2026-10-13')).toBe(0);
  });
  it(`is behind when late or ${BEHIND_POINTS} points under the plan`, () => {
    expect(isBehind({ ...A, progress: 40 }, '2026-10-05')).toBe(true);
    expect(isBehind({ ...A, progress: 41 }, '2026-10-05')).toBe(false);
    expect(isBehind({ ...A, progress: 90 }, '2026-10-11')).toBe(true);
    expect(isBehind({ ...A, progress: 100 }, '2026-10-11')).toBe(false);
    expect(isBehind({ ...A, progress: 0 }, '2026-09-20')).toBe(false);
  });
  it('expects to finish at the planned pace, never before the plan', () => {
    expect(expectedEnd({ ...A, progress: 50 }, '2026-10-05')).toBe('2026-10-10');   // 5 days left, 6 planned
    expect(expectedEnd({ ...A, progress: 20 }, '2026-10-08')).toBe('2026-10-15');   // 8 days left from the 8th
    expect(expectedEnd({ ...A, progress: 100 }, '2026-10-05')).toBe('2026-10-05');  // finished early
    expect(expectedEnd({ ...A, progress: 100 }, '2026-10-20')).toBe('2026-10-10');
    expect(expectedEnd({ ...A, progress: 0 }, '2026-09-20')).toBe('2026-10-10');
    expect(expectedEnd(act({}), '2026-10-05')).toBeNull();
  });
});

describe('the project summary', () => {
  const B = act({ id: 'b', start_date: '2026-10-11', end_date: '2026-10-30' });   // twenty days
  it('weights planned and actual progress by duration and finds the latest expected finish', () => {
    const s = summarize([{ ...A, progress: 50 }, B], '2026-10-05');
    expect(s).toMatchObject({ start: '2026-10-01', end: '2026-10-30', base_end: null, planned_pct: 17, actual_pct: 17, behind: 0, expected_end: '2026-10-30', slip_days: 0, activities: 2, dated: 2, done: 0 });
  });
  it('measures the slip against the baseline and counts what is behind', () => {
    const s = summarize([{ ...A, progress: 20 }, { ...B, base_start: '2026-10-11', base_end: '2026-10-25' }], '2026-10-08');
    expect(s.behind).toBe(1);
    expect(s.base_end).toBe('2026-10-25');
    expect(s.expected_end).toBe('2026-10-30');
    expect(s.slip_days).toBe(5);
  });
  it('ignores undated activities and copes with an empty schedule', () => {
    expect(summarize([act({ progress: 100 }), act({ id: 'c' })], '2026-10-05')).toMatchObject({ start: null, planned_pct: 0, actual_pct: 0, expected_end: null, activities: 2, dated: 0, done: 1 });
    expect(summarize([], '2026-10-05').activities).toBe(0);
  });
});

describe('the Gantt', () => {
  it('runs in weeks from the Monday before the first date to the last date, at least four weeks', () => {
    expect(weeks([A, act({ id: 'b', start_date: '2026-10-11', end_date: '2026-10-30' })], '2026-10-13')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(weeks([], '2026-10-13')).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(weekLabel('2026-09-28')).toBe('09/28');
  });
  it('places a bar as percentages of the span', () => {
    expect(bar('2026-10-01', '2026-10-10', '2026-09-28', 35)).toEqual({ left: 8.6, width: 28.6 });
    expect(bar('2026-09-28', '2026-11-01', '2026-09-28', 35)).toEqual({ left: 0, width: 100 });
    expect(bar(null, '2026-10-10', '2026-09-28', 35)).toBeNull();
  });
});
