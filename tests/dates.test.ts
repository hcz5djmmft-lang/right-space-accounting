import { describe, expect, it } from 'vitest';
import { today } from '@/lib/dates';

// Egypt is UTC+3 in October (summer time) and UTC+2 in winter; the books' "today" follows Cairo, not the server.
describe('today() in the company time zone', () => {
  it('rolls over at Cairo midnight, not UTC midnight', () => {
    expect(today(new Date('2026-10-09T20:59:00Z'))).toBe('2026-10-09');
    expect(today(new Date('2026-10-09T21:30:00Z'))).toBe('2026-10-10');
    expect(today(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
    expect(today(new Date('2026-12-31T21:30:00Z'))).toBe('2026-12-31');
  });
  it('is a plain YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
