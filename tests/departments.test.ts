import { describe, expect, it } from 'vitest';
import { hasRole, mergeRoles } from '@/lib/roles';
import { type ChartRow, baseCode, groupProjectCodes } from '@/lib/chart';

describe('department groups', () => {
  it('a person may do what their department allows plus their own extras, each once', () => {
    expect(mergeRoles(['tenders'], ['finance', 'tenders'])).toEqual(['tenders', 'finance']);
    expect(mergeRoles([], null)).toEqual([]);
    expect(mergeRoles(['bogus', 'finance'], ['nope'])).toEqual(['finance']);
    const member = { roles: mergeRoles([], ['finance']) };
    expect(hasRole(member, 'finance')).toBe(true);
    expect(hasRole(member, 'management')).toBe(false);
  });
});

const row = (code: string, name: string, p: Partial<ChartRow> = {}): ChartRow => ({
  code, name, type: 'expense', parent: null, postable: true, is_bank: false, is_system: false, budget: null, cost_type: 'Opex', project: null, dr: 0, cr: 0, ...p,
});

describe('chart of accounts totals', () => {
  const rows = [
    row('10000', 'Office expenses', { postable: false }),
    row('11003', 'Transport', { parent: '10000', dr: 700, budget: 2000, project: 'Office' }),
    row('20000-1', 'PH-B1302 project costs', { postable: false, project: 'PH-B1302' }),
    row('21001-1', 'Drawings', { parent: '20000-1', dr: 1000, budget: 5000, project: 'PH-B1302' }),
    row('28006-1', 'Parquet', { parent: '20000-1', dr: 10, project: 'PH-B1302' }),
    row('20000-2', 'CS-CH2505 project costs', { postable: false, project: 'CS-CH2505' }),
    row('21001-2', 'Drawings', { parent: '20000-2', dr: 250, cr: 50, budget: 3000, project: 'CS-CH2505' }),
    row('28006-2', 'Backfill', { parent: '20000-2', dr: 20, project: 'CS-CH2505' }),
    row('A120', 'Bank', { type: 'asset', cr: 2000 }),
  ];
  it('adds a project code up over all projects, under one heading, and leaves the rest alone', () => {
    const g = groupProjectCodes(rows);
    expect(g.map(r => r.code)).toEqual(['10000', '11003', 'A120', '20000', '21001', '28006', '28006']);
    expect(g.find(r => r.code === '21001')).toMatchObject({ name: 'Drawings', parent: '20000', dr: 1250, cr: 50, budget: 8000, project: null });
    expect(g.find(r => r.code === '20000')).toMatchObject({ postable: false, name: 'Project costs · all projects' });
  });
  it('keeps one line per name when the same number was given different names on different projects', () => {
    const g = groupProjectCodes(rows).filter(r => r.code === '28006');
    expect(g.map(r => [r.name, r.dr])).toEqual([['Backfill', 20], ['Parquet', 10]]);
  });
  it('knows a project code from any other', () => {
    expect(baseCode('21001-6')).toBe('21001');
    expect(baseCode('11003')).toBe('11003');
    expect(baseCode('A120')).toBe('A120');
  });
});
