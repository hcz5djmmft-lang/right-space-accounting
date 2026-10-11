import { describe, expect, it } from 'vitest';
import { type AccountInfo, groupOf, summarize } from '@/lib/bank-groups';

const INFO: Record<string, AccountInfo> = {
  L110: { type: 'liability' }, '14005': { type: 'expense', charges: true }, L115: { type: 'liability', bank: 'card' }, A115: { type: 'asset', bank: 'cash' },
  L180: { type: 'liability' }, '11003': { type: 'expense' }, R130: { type: 'revenue', interest: true }, Q110: { type: 'equity' }, A130: { type: 'asset', receivable: true },
  R110: { type: 'revenue' }, A160: { type: 'asset' },
};
const info = (c: string) => INFO[c] ?? {};
const out = (kind: string, cr: number, others: string[]) => ({ kind, dr: 0, cr, others });
const inn = (kind: string, dr: number, others: string[]) => ({ kind, dr, cr: 0, others });

describe('bank reconciliation groups', () => {
  it('reads money out the way the statement is read: vendors, charges, card settlement, transfers, salaries, the rest', () => {
    expect(groupOf(out('payment', 100, ['L110']), info).group).toBe('Transfers to vendors');
    expect(groupOf(out('expense', 15, ['14005']), info).group).toBe('Bank charges');
    expect(groupOf(out('transfer', 500, ['L115']), info).group).toBe('Credit card settlement');
    expect(groupOf(out('transfer', 500, ['A115']), info).group).toBe('Transfers between accounts');
    expect(groupOf(out('payroll', 80000, ['L180']), info).group).toBe('Salaries');
    expect(groupOf(out('expense', 50, ['11003']), info).group).toBe('Other payments');
  });
  it('and money in: collections, the partners\' deposits, interest, transfers, the rest', () => {
    expect(groupOf(inn('receipt', 1000, ['A130']), info).group).toBe('Collections');
    expect(groupOf(inn('collection', 1000, ['R110']), info).group).toBe('Collections');
    expect(groupOf(inn('collection', 20, ['R130']), info).group).toBe('Interest');
    expect(groupOf(inn('adjustment', 250000, ['Q110']), info).group).toBe("Partners' deposits");
    expect(groupOf(inn('transfer', 300, ['A115']), info).group).toBe('Transfers between accounts');
    expect(groupOf(inn('adjustment', 7, ['A160']), info).group).toBe('Other receipts');
  });
  it('totals each group in a fixed order and leaves out empty ones', () => {
    const s = summarize([out('payment', 100, ['L110']), out('payment', 50.5, ['L110']), out('expense', 15, ['14005']), inn('collection', 20, ['R130']), inn('receipt', 1000, ['A130'])], info);
    expect(s.out).toEqual([{ group: 'Transfers to vendors', total: 150.5, count: 2 }, { group: 'Bank charges', total: 15, count: 1 }]);
    expect(s.in).toEqual([{ group: 'Collections', total: 1000, count: 1 }, { group: 'Interest', total: 20, count: 1 }]);
    expect(s.totalOut).toBe(165.5);
    expect(s.totalIn).toBe(1020);
  });
});
