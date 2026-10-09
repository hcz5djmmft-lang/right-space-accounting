import { describe, expect, it } from 'vitest';
import { amountInWords, assertBalanced, docLines, docTotals, paymentLines } from '@/lib/ledger';

const map = { ap: 'L110', ar: 'A130', vatIn: 'A140', vatOut: 'L140', whtPay: 'L150', whtRec: 'A150', siPay: 'L165', retPay: 'L120', dpAdv: '90000' };

describe('payment request', () => {
  const pr = {
    kind: 'purchase' as const, no: 'C-000002', party: 'vc1', project: 'p1',
    vatRate: 14, whtRate: 3, siRate: 1, retRate: 5, dpAmount: 1000,
    lines: [{ acc: '25001-1', qty: 2, price: 5000, desc: 'Carpentry' }, { acc: '24001-1', qty: 1, price: 2000, dept: null }],
  };
  it('computes totals like the old app: deductions on the subtotal', () => {
    expect(docTotals(pr)).toEqual({ subtotal: 12000, vat: 1680, total: 13680, wht: 360, si: 120, retention: 600, dp: 1000, net: 11600 });
  });
  it('posts expense lines, input VAT, deductions and the net payable', () => {
    const lines = docLines(pr, map);
    assertBalanced(lines);
    expect(lines.map(l => [l.account, l.dr, l.cr])).toEqual([
      ['25001-1', 10000, 0], ['24001-1', 2000, 0], ['A140', 1680, 0],
      ['L150', 0, 360], ['L165', 0, 120], ['L120', 0, 600], ['90000', 0, 1000], ['L110', 0, 11600],
    ]);
    expect(lines[0]).toMatchObject({ project_id: 'p1', party_id: 'vc1' });
  });
  it('refuses deductions larger than the amount', () => {
    expect(() => docLines({ ...pr, dpAmount: 99999 }, map)).toThrow(/Deductions/);
  });
});

describe('vendor payment', () => {
  it('clears payables up to the allocation; the rest is a down payment', () => {
    const lines = paymentLines({ kind: 'payment', no: 'PAY-00002', party: 'vc1', bank: 'A120', amount: 15000, wht: 0, allocated: 11600 }, map);
    assertBalanced(lines);
    expect(lines.map(l => [l.account, l.dr, l.cr])).toEqual([['L110', 11600, 0], ['90000', 3400, 0], ['A120', 0, 15000]]);
  });
  it('refuses allocating more than paid', () => {
    expect(() => paymentLines({ kind: 'payment', no: 'x', party: 'v', bank: 'A120', amount: 10, wht: 0, allocated: 11 }, map)).toThrow();
  });
});

describe('amountInWords', () => {
  it('reads like the printed request', () => {
    expect(amountInWords(225000)).toBe('Two hundred twenty-five thousand Egyptian pounds only');
    expect(amountInWords(11600.5)).toBe('Eleven thousand six hundred Egyptian pounds and fifty piasters only');
  });
});
