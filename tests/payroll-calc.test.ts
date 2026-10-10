import { describe, expect, it } from 'vitest';
import { annualTax, assertBalanced, brackets, DEFAULT_RATES, monthEnd, payLine, payrollLines, rates, runTotals, salaryPaymentLines } from './helpers/payroll';

const map = { salExp: '11001', socExp: '11010', socPay: 'L160', taxPay: 'L170', salPay: 'L180', empAdv: 'A160' };

describe('Egyptian payroll maths', () => {
  it('basic 10,000 + allowances 2,000: insurance 11% / 18.75%, tax on annualised pay less 20,000 exemption', () => {
    const l = payLine({ basic: 10000, allowances: 2000 }, 0, 0, DEFAULT_RATES);
    // taxable = (12,000 − 1,320) × 12 − 20,000 = 108,160 → 0 + 1,500 + 2,250 + 7,632 = 11,382 a year
    expect(l).toEqual({ basic: 10000, allowances: 2000, overtime: 0, deductions: 0, gross: 12000, insurable: 12000, soc_emp: 1320, soc_co: 2250, tax: 948.5, net: 9731.5, no_deductions: false });
  });
  it('"no insurance or tax" pays the full salary: nothing for insurance on either side, no tax, advances still recovered', () => {
    const l = payLine({ basic: 10000, allowances: 2000, no_deductions: true }, 500, 300, DEFAULT_RATES);
    expect(l).toMatchObject({ gross: 12500, insurable: 0, soc_emp: 0, soc_co: 0, tax: 0, deductions: 300, net: 12200, no_deductions: true });
    const lines = payrollLines('2026-10', [{ ...l, project_id: null, dept_id: 'd1' }], map);
    assertBalanced(lines);
    expect(lines.map(x => [x.account, x.dr, x.cr])).toEqual([['11001', 12500, 0], ['A160', 0, 300], ['L180', 0, 12200]]);
  });
  it('clamps the insurable wage between 2,700 and 16,700, and overtime and deductions flow through', () => {
    expect(payLine({ basic: 2000, allowances: 0 }, 0, 0, DEFAULT_RATES)).toMatchObject({ insurable: 2700, soc_emp: 297, tax: 0, net: 1703 });
    expect(payLine({ basic: 30000, allowances: 0, insurable: 0 }, 0, 0, DEFAULT_RATES)).toMatchObject({ insurable: 16700, soc_emp: 1837, soc_co: 3131.25 });
    expect(payLine({ basic: 30000, allowances: 0, insurable: 10000 }, 500, 1000, DEFAULT_RATES)).toMatchObject({ insurable: 10000, soc_emp: 1100, gross: 30500, deductions: 1000 });
    const l = payLine({ basic: 10000, allowances: 2000 }, 1000, 500, DEFAULT_RATES);
    expect(l.gross).toBe(13000);
    expect(l.net).toBe(13000 - 1320 - l.tax - 500);
  });
  it('progressive brackets: 0 up to 40,000, then 10%, 15%, 20%, 22.5%, 25%, 27.5% above 1.2 million', () => {
    const br = brackets(DEFAULT_RATES.brackets);
    expect(annualTax(40000, br)).toBe(0);
    expect(annualTax(55000, br)).toBe(1500);
    expect(annualTax(70000, br)).toBe(3750);
    expect(annualTax(1300000, br)).toBeCloseTo(3750 + 26000 + 45000 + 200000 + 27500, 2);
  });
  it('reads rates from settings with defaults for anything missing', () => {
    expect(rates({ empRate: '12', brackets: '' })).toMatchObject({ empRate: 12, coRate: 18.75, brackets: DEFAULT_RATES.brackets });
    expect(rates(null)).toEqual(DEFAULT_RATES);
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2026-10')).toBe('2026-10-31');
  });
  it('posts salaries per cost center against insurance, tax, advances and net salaries payable', () => {
    const a = { ...payLine({ basic: 10000, allowances: 2000 }, 0, 500, DEFAULT_RATES), project_id: 'p1', dept_id: null };
    const b = { ...payLine({ basic: 5000, allowances: 0 }, 0, 0, DEFAULT_RATES), project_id: null, dept_id: 'd1' };
    const lines = payrollLines('2026-10', [a, b], map);
    assertBalanced(lines);
    const t = runTotals([a, b]);
    expect(lines.map(l => [l.account, l.dr, l.cr, l.project_id ?? l.dept_id ?? null])).toEqual([
      ['11001', 12000, 0, 'p1'], ['11010', 2250, 0, 'p1'], ['11001', 5000, 0, 'd1'], ['11010', 937.5, 0, 'd1'],
      ['L160', 0, t.soc_emp + t.soc_co, null], ['L170', 0, t.tax, null], ['A160', 0, 500, null], ['L180', 0, t.net, null],
    ]);
    const pay = salaryPaymentLines('2026-10', t.net, 'A120', map);
    assertBalanced(pay);
    expect(pay).toEqual([{ account: 'L180', dr: t.net, cr: 0, description: 'Net salaries 2026-10' }, { account: 'A120', dr: 0, cr: t.net, description: 'Net salaries 2026-10' }]);
  });
});
