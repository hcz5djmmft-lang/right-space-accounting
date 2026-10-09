import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/reports';

describe('CSV for Excel', () => {
  it('keeps numbers as numbers and stops text from running as a formula', () => {
    const csv = toCsv([['GL code', 'Name', 'Debit'], ['=SUM(A1)', '-x', -1234.5], ['+20 100 000', '@me', 0], ['a "quoted", name', 'ok', '']]);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('GL code,Name,Debit');
    expect(lines[1]).toBe("'=SUM(A1),'-x,-1234.5");
    expect(lines[2]).toBe("'+20 100 000,'@me,0");
    expect(lines[3]).toBe('"a ""quoted"", name",ok,');
  });
});
