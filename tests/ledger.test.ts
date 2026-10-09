import { describe, expect, it } from 'vitest';
import { entryLines, assertBalanced, missingCostCenter, RuleError } from '@/lib/ledger';

const map = { vatIn: 'A140', ar: 'A130' };

describe('entryLines', () => {
  it('expense: debits each GL line, adds input VAT, credits the bank', () => {
    const lines = entryLines({
      type: 'expense', memo: 'Site electricity', bank: 'A110', vatRate: 14, party: 'vc1',
      items: [{ project: 'p1', acc: '24001-1', amount: 1000 }, { dept: 'fin', acc: '11003', amount: 500, desc: 'Office' }],
    }, map);
    expect(lines).toEqual([
      { account: '24001-1', dr: 1000, cr: 0, project_id: 'p1', dept_id: null, party_id: 'vc1', description: 'Site electricity' },
      { account: '11003', dr: 500, cr: 0, project_id: null, dept_id: 'fin', party_id: 'vc1', description: 'Office' },
      { account: 'A140', dr: 210, cr: 0, description: 'VAT · Site electricity' },
      { account: 'A110', dr: 0, cr: 1710, description: 'Site electricity' },
    ]);
    assertBalanced(lines);
  });

  it('collection: debits the bank, credits revenue, tags the customer only on receivables', () => {
    const lines = entryLines({
      type: 'collection', memo: 'Collection', bank: 'A120', party: 'cu1',
      items: [{ project: 'p3', acc: 'R110', amount: 50000 }, { acc: 'A130', amount: 100 }],
    }, map);
    expect(lines[0]).toMatchObject({ account: 'A120', dr: 50100, cr: 0 });
    expect(lines[1]).toMatchObject({ account: 'R110', cr: 50000, project_id: 'p3', party_id: null });
    expect(lines[2]).toMatchObject({ account: 'A130', cr: 100, party_id: 'cu1' });
    assertBalanced(lines);
  });

  it('transfer: moves money between two bank/cash accounts', () => {
    const lines = entryLines({ type: 'transfer', memo: 'Petty cash', bank: 'A120', toBank: 'A110', amount: 2500, items: [] }, map);
    expect(lines).toEqual([
      { account: 'A110', dr: 2500, cr: 0, description: 'Petty cash' },
      { account: 'A120', dr: 0, cr: 2500, description: 'Petty cash' },
    ]);
  });

  it('rejects empty or invalid entries', () => {
    expect(() => entryLines({ type: 'expense', memo: '', bank: 'A110', items: [] }, map)).toThrow(RuleError);
    expect(() => entryLines({ type: 'transfer', memo: '', bank: 'A110', toBank: 'A110', amount: 5, items: [] }, map)).toThrow(/different/);
    expect(() => entryLines({ type: 'expense', memo: '', bank: '', items: [{ acc: 'x', amount: 1 }] }, map)).toThrow(/bank/);
  });

  it('rounds to piasters', () => {
    const lines = entryLines({ type: 'expense', memo: '', bank: 'A110', vatRate: 14, items: [{ dept: 'd', acc: 'x', amount: 10.005 }] }, map);
    assertBalanced(lines);
  });
});

describe('missingCostCenter', () => {
  it('flags expense lines with no project or department', () => {
    const type = (c: string) => (c.startsWith('1') || c.startsWith('2') ? 'expense' : 'asset') as never;
    expect(missingCostCenter([
      { account: '11001', dr: 5, cr: 0, description: '' },
      { account: '12001', dr: 5, cr: 0, dept_id: 'fin', description: '' },
      { account: 'A110', dr: 0, cr: 10, description: '' },
    ], type)).toEqual(['11001']);
  });
});
