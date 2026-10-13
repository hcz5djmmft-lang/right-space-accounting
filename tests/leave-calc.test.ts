// Leave maths: entitlement per Egyptian law, working days over a weekend, and what a request must satisfy.
import { describe, expect, it } from 'vitest';
import { checkRequest, entitlement, workingDays } from '@/lib/leave-calc';

const weekend = [5, 6]; // Friday and Saturday

describe('entitlement', () => {
  it('is 21 days, 30 after ten years of service or from age 50 by the end of the year', () => {
    expect(entitlement('2020-01-15', '1990-06-01', 2026)).toBe(21);
    expect(entitlement('2016-12-31', '1990-06-01', 2026)).toBe(30);  // ten years on 2026-12-31
    expect(entitlement('2017-01-01', '1990-06-01', 2026)).toBe(21);  // one day short
    expect(entitlement('2020-01-15', '1976-12-31', 2026)).toBe(30);  // turns 50 on the last day of the year
    expect(entitlement('2020-01-15', '1977-01-01', 2026)).toBe(21);
    expect(entitlement(null, null, 2026)).toBe(21);
  });
  it('gives the hire year pro rata by whole months left, and nothing before the hire year', () => {
    expect(entitlement('2026-03-10', null, 2026)).toBe(17);  // 21 × 10 / 12
    expect(entitlement('2026-01-01', null, 2026)).toBe(21);
    expect(entitlement('2026-12-01', null, 2026)).toBe(1);
    expect(entitlement('2027-02-01', null, 2026)).toBe(0);
  });
});

describe('workingDays', () => {
  it('counts both ends and skips the weekend', () => {
    expect(workingDays('2026-10-11', '2026-10-15', weekend)).toBe(5);  // Sunday to Thursday
    expect(workingDays('2026-10-15', '2026-10-18', weekend)).toBe(2);  // Thursday, Friday, Saturday, Sunday
    expect(workingDays('2026-10-16', '2026-10-17', weekend)).toBe(0);
    expect(workingDays('2026-10-15', '2026-10-15', weekend)).toBe(1);
    expect(workingDays('2026-10-15', '2026-10-14', weekend)).toBe(0);
    expect(workingDays('2026-10-11', '2026-10-15', [0, 6])).toBe(4);  // a Sunday-Saturday weekend
  });
});

describe('checkRequest', () => {
  const ok = { type: 'annual' as const, from: '2026-10-11', to: '2026-10-15', days: 5, balance: 21 };
  it('accepts a sound request', () => expect(checkRequest(ok)).toBeNull());
  it('refuses bad dates, reversed dates and a request over New Year', () => {
    expect(checkRequest({ ...ok, from: '' })).toMatch(/Choose the first/);
    expect(checkRequest({ ...ok, to: '2026-10-10' })).toMatch(/before the first/);
    expect(checkRequest({ ...ok, to: '2027-01-03' })).toMatch(/within one year/);
    expect(checkRequest({ ...ok, days: 0 })).toMatch(/weekend/);
  });
  it('caps casual leave at two days and annual leave at the balance; sick and unpaid leave have no balance', () => {
    expect(checkRequest({ ...ok, type: 'casual', days: 3 })).toMatch(/at most 2 days/);
    expect(checkRequest({ ...ok, type: 'casual', days: 2 })).toBeNull();
    expect(checkRequest({ ...ok, balance: 4 })).toBe('Only 4 days of annual leave are left this year.');
    expect(checkRequest({ ...ok, type: 'sick', balance: 0 })).toBeNull();
    expect(checkRequest({ ...ok, type: 'unpaid', days: 20, balance: 0 })).toBeNull();
  });
});
