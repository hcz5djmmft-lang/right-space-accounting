import { describe, expect, it } from 'vitest';
import { tr, trParts, trClockMessage, isLang } from '../src/lib/i18n';
import { whereText } from '../src/lib/attendance-calc';

describe('Arabic', () => {
  it('gives the Arabic of a known phrase and leaves English alone', () => {
    expect(tr('ar', 'Clock in')).toBe('الحضور');
    expect(tr('en', 'Clock in')).toBe('Clock in');
    expect(tr('ar', 'A phrase with no Arabic yet')).toBe('A phrase with no Arabic yet');
  });
  it('fills slots with Western digits', () => {
    expect(tr('ar', 'Clock in within {m} m of the office.', { m: 150 })).toBe('سجّل الحضور في حدود 150 متر من المكتب.');
    expect(tr('en', 'Clock in within {m} m of the office.', { m: 150 })).toBe('Clock in within 150 m of the office.');
  });
  it('translates each part of an approval type', () => {
    expect(trParts('ar', 'Payment request · Management')).toBe('طلب صرف · الإدارة');
  });
  it('turns the clock-in sentence into Arabic and keeps the numbers', () => {
    const ar = trClockMessage('ar', whereText('in', 'for design on PH-1', { place: 'office', distance: 12, acc: 8, hasPos: true, rule: 'office', compared: true }));
    expect(ar).toContain('تم تسجيل الحضور في المكتب');
    expect(ar).toContain('12');
    expect(ar).toContain('8');
    const site = whereText('out', 'on site PH-1', { place: 'site', distance: 30, acc: null, hasPos: true, rule: 'site', compared: true });
    expect(trClockMessage('ar', site)).toBe('تم تسجيل الانصراف، على بعد 30 متر من موقع المشروع.');
    expect(trClockMessage('ar', whereText('in', '', { place: 'away', distance: 900, acc: null, hasPos: true, rule: 'site', compared: true }))).toContain('900');
    expect(trClockMessage('ar', whereText('in', '', { place: null as never, distance: null, acc: null, hasPos: false, rule: 'office', compared: false }))).toContain('بدون موقع');
    expect(trClockMessage('en', 'Clocked in at the office')).toBe('Clocked in at the office');
  });
  it('accepts only the two languages', () => {
    expect(isLang('ar')).toBe(true);
    expect(isLang('fr')).toBe(false);
  });
});
