import { r2 } from './money';
import type { AccountMap, Line } from './ledger';

// Egyptian payroll maths, a port of the old app's payLine / annualTax / payrollJE.
// Pure functions: no database, usable in the browser for the live estimate on the employee form.

export type PayRates = { empRate: number; coRate: number; insMin: number; insMax: number; exemption: number; brackets: string };

/** Social insurance 11% employee / 18.75% company on the insurable wage between 2,700 and 16,700 a month;
 *  annual personal exemption 20,000; progressive salary-tax brackets as "upper limit:rate, …, 0:top rate". */
export const DEFAULT_RATES: PayRates = {
  empRate: 11, coRate: 18.75, insMin: 2700, insMax: 16700, exemption: 20000,
  brackets: '40000:0,55000:10,70000:15,200000:20,400000:22.5,1200000:25,0:27.5',
};

export function rates(p: Record<string, unknown> | null | undefined): PayRates {
  const out = { ...DEFAULT_RATES };
  for (const k of Object.keys(DEFAULT_RATES) as (keyof PayRates)[]) {
    const v = p?.[k];
    if (k === 'brackets') { if (typeof v === 'string' && v.trim()) out.brackets = v; }
    else if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) out[k] = Number(v);
  }
  return out;
}

export const brackets = (s: string): [number, number][] =>
  s.split(',').map(x => x.split(':').map(Number) as [number, number]).filter(x => x.length === 2 && !isNaN(x[0]) && !isNaN(x[1]));

/** Tax on an annual taxable amount, progressive over the brackets (limit 0 = no upper limit). */
export function annualTax(taxable: number, br: [number, number][]): number {
  let tax = 0, prev = 0;
  for (const [lim, rate] of br) {
    const top = lim > 0 ? lim : Infinity;
    if (taxable > prev) tax += (Math.min(taxable, top) - prev) * rate / 100;
    prev = top;
    if (taxable <= top) break;
  }
  return tax;
}

export type EmpPay = { basic: number; allowances: number; insurable?: number | null };
export type PayLine = { basic: number; allowances: number; overtime: number; deductions: number; gross: number; insurable: number; soc_emp: number; soc_co: number; tax: number; net: number };

/** One employee's month. `insurable` 0 or empty means basic + allowances. Deductions are advances recovered. */
export function payLine(e: EmpPay, overtime: number, deductions: number, R: PayRates): PayLine {
  const basic = r2(+e.basic || 0), allowances = r2(+e.allowances || 0);
  overtime = r2(+overtime || 0); deductions = r2(+deductions || 0);
  const gross = r2(basic + allowances + overtime);
  const insurable = r2(Math.min(Math.max(+(e.insurable ?? 0) || basic + allowances, R.insMin || 0), R.insMax || Infinity));
  const soc_emp = r2(insurable * R.empRate / 100), soc_co = r2(insurable * R.coRate / 100);
  const taxable = Math.max(0, (gross - soc_emp) * 12 - (R.exemption || 0));
  const tax = r2(annualTax(taxable, brackets(R.brackets)) / 12);
  return { basic, allowances, overtime, deductions, gross, insurable, soc_emp, soc_co, tax, net: r2(gross - soc_emp - tax - deductions) };
}

export type RunTotals = { gross: number; soc_emp: number; soc_co: number; tax: number; deductions: number; net: number };
export function runTotals(lines: PayLine[]): RunTotals {
  const t: RunTotals = { gross: 0, soc_emp: 0, soc_co: 0, tax: 0, deductions: 0, net: 0 };
  for (const l of lines) for (const k of Object.keys(t) as (keyof RunTotals)[]) t[k] += l[k] || 0;
  for (const k of Object.keys(t) as (keyof RunTotals)[]) t[k] = r2(t[k]);
  return t;
}

export type CostedLine = PayLine & { project_id?: string | null; dept_id?: string | null };

/** The posting for a payroll month: salaries and the company's insurance per cost center,
 *  then what is owed to the insurance authority, the tax authority, staff advances and the staff. */
export function payrollLines(period: string, lines: CostedLine[], map: AccountMap): Line[] {
  const groups = new Map<string, { project_id: string | null; dept_id: string | null; gross: number; co: number }>();
  for (const l of lines) {
    const k = `${l.project_id ?? ''}|${l.dept_id ?? ''}`;
    const g = groups.get(k) ?? { project_id: l.project_id ?? null, dept_id: l.dept_id ?? null, gross: 0, co: 0 };
    g.gross += l.gross; g.co += l.soc_co; groups.set(k, g);
  }
  const out: Line[] = [];
  for (const g of groups.values()) {
    out.push({ account: map.salExp, dr: r2(g.gross), cr: 0, project_id: g.project_id, dept_id: g.dept_id, description: 'Salaries ' + period });
    if (g.co) out.push({ account: map.socExp, dr: r2(g.co), cr: 0, project_id: g.project_id, dept_id: g.dept_id, description: 'Social insurance (company) ' + period });
  }
  const t = runTotals(lines);
  if (t.soc_emp + t.soc_co) out.push({ account: map.socPay, dr: 0, cr: r2(t.soc_emp + t.soc_co), description: 'Social insurance ' + period });
  if (t.tax) out.push({ account: map.taxPay, dr: 0, cr: t.tax, description: 'Salary tax ' + period });
  if (t.deductions) out.push({ account: map.empAdv, dr: 0, cr: t.deductions, description: 'Deductions / advances ' + period });
  out.push({ account: map.salPay, dr: 0, cr: t.net, description: 'Net salaries ' + period });
  return out.filter(l => l.dr || l.cr);
}

export const salaryPaymentLines = (period: string, net: number, bank: string, map: AccountMap): Line[] => [
  { account: map.salPay, dr: r2(net), cr: 0, description: 'Net salaries ' + period },
  { account: bank, dr: 0, cr: r2(net), description: 'Net salaries ' + period },
];

/** Last day of a YYYY-MM month, the usual posting date. */
export function monthEnd(period: string) {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
