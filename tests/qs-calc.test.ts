// The Master BOQ workbook's maths, checked against the workbook's own cached values with its template inputs.
import { describe, expect, it } from 'vitest';
import { bathroom, compute, defaults, electrical, elecfin, kitchen, parsePart, sanitary, up } from '@/lib/qs-calc';
import { BATHROOM, ELECFIN, ELECTRICAL, KITCHEN, MASTER, SANITARY, SEED_RATES } from '@/lib/qs-data';

const d = defaults();
const qty = (r: { lines: { key: string; qty: number }[] }, key: string) => r.lines.find(l => l.key === key)!.qty;

describe('workbook data', () => {
  it('holds the 25 Master BOQ items in 10 sections and 90 priced materials', () => {
    expect(MASTER.items).toHaveLength(25);
    expect(MASTER.sections).toHaveLength(10);
    expect(MASTER.items.filter(i => i.source !== 'manual').map(i => i.no)).toEqual(['2.1', '2.2', '3.1', '10.1', '10.2', '10.3']);
    expect(BATHROOM.materials.length + KITCHEN.materials.length + ELECTRICAL.materials.length + SANITARY.materials.length + ELECFIN.materials.length).toBe(90);
    expect(Object.keys(SEED_RATES)).toHaveLength(90);
    expect(ELECTRICAL.rooms).toHaveLength(9);
    expect(ELECTRICAL.points).toHaveLength(10);
  });
  it('rounds up to whole purchase units and never below zero', () => {
    expect(up(2.01)).toBe(3); expect(up(3)).toBe(3); expect(up(0)).toBe(0); expect(up(-0.5)).toBe(0); expect(up(0.1 + 0.2 - 0.3 + 1)).toBe(1);
  });
});

describe('calculators with the template inputs', () => {
  it('bathroom: 10 PPR rods, 11 outlets, 16,781.00', () => {
    const r = bathroom(d.bathroom);
    expect(r.indicators.map(i => i.value)).toEqual([3.465, 7.5, 5.715, 11]);
    expect(['b34', 'b37', 'b39', 'b40', 'b41', 'b42', 'b43', 'b44', 'b45', 'b50', 'b52', 'b53', 'b54', 'b56', 'b57'].map(k => qty(r, k))).toEqual([10, 11, 9, 20, 4, 5, 12, 60, 5, 2, 6, 2, 1, 4, 1]);
    expect(qty(r, 'b47')).toBe(1);  // typed: the cistern frame
    expect(r.total).toBe(16781);
  });
  it('kitchen: 9 rods, 6 outlets, 6,119.25', () => {
    const r = kitchen(d.kitchen);
    expect(r.indicators.map(i => i.value)).toEqual([9.9875, 13.2, 13.9475, 6]);
    expect(['k30', 'k33', 'k35', 'k36', 'k38', 'k39', 'k40', 'k41', 'k43', 'k45', 'k46', 'k47'].map(k => qty(r, k))).toEqual([9, 6, 5, 12, 3, 10, 54, 3, 4, 6, 2, 3]);
    expect(r.total).toBe(6119.25);
  });
  it('electrical: 73 boxes, 29 panel ways, 64,303', () => {
    const r = electrical(d.electrical);
    expect(Object.fromEntries(r.indicators.map(i => [i.key, i.value]))).toEqual({ lights: 72, boxes: 81, switches: 34, light_circuits: 8, sockets: 29, socket_circuits: 4, power_lines: 11, direct_lines: 11, lowcurrent: 7, panel_ways: 29 });
    expect(['e27', 'e28', 'e29', 'e35', 'e36', 'e38', 'e45', 'e46', 'e47', 'e54', 'e55'].map(k => qty(r, k))).toEqual([9, 3, 2, 9, 6, 82, 8, 4, 11, 1, 1]);
    expect(r.groups.map(g => g.total)).toEqual([43100, 6918, 9275, 5010]);
    expect(r.total).toBe(64303);
  });
  it('sanitary: 27,680.25 bathroom and 11,660.25 kitchen', () => {
    const r = sanitary(d.sanitary);
    expect(r.groups.map(g => g.total)).toEqual([27680.25, 11660.25]);
    expect(r.total).toBe(39340.5);
  });
  it('electrical finishing counts modules from the points: 26,656', () => {
    const r = elecfin(d.elecfin, d.electrical);
    expect(['f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f14'].map(k => qty(r, k))).toEqual([73, 37, 21, 8, 7, 73, 72]);
    expect(r.groups.map(g => g.total)).toEqual([7846, 18810]);
    expect(r.total).toBe(26656);
  });
});

describe('Master BOQ and the client price', () => {
  it('links the calculators into the rates and sums the dry cost to 245,091.25', () => {
    const e = compute(d);
    const row = (no: string) => e.rows.find(r => r.no === no)!;
    expect(row('2.1').rate).toBe(49562);          // bathroom × 2 + 16,000
    expect(row('2.2').rate).toBe(14119.25);       // kitchen + 8,000
    expect(row('3.1').rate).toBe(64303);
    expect(row('1.2').total).toBe(38510.5);       // 70 m² × 550.15
    expect(row('10.1').rate).toBe(27680.25); expect(row('10.2').rate).toBe(11660.25); expect(row('10.3').rate).toBe(26656);
    expect(row('4.1').total).toBe(0);             // blank quantity and rate
    expect(e.dry).toBe(245091.25);
  });
  it('prices the client at dry ÷ 0.70 with risk 10 % and margin 20 %, VAT 14 % apart', () => {
    const e = compute(d);
    expect(Math.abs(e.pricing.client - 245091.25 / 0.7)).toBeLessThan(0.5);
    expect(e.pricing.factor).toBe(0.7);
    expect(e.pricing.risk).toBe(Math.round(e.pricing.client * 10) / 100);
    expect(e.pricing.margin).toBe(Math.round(e.pricing.client * 20) / 100);
    expect(e.pricing.vat).toBe(Math.round(e.pricing.client * 14) / 100);
    expect(e.pricing.total).toBe(Math.round((e.pricing.client + e.pricing.vat) * 100) / 100);
    expect(e.rows.find(r => r.no === '1.1')!.client_rate).toBe(14285.71);
    expect(e.materials.length).toBeGreaterThan(60);
    expect(e.materials.every(m => m.qty > 0)).toBe(true);
  });
  it('a second bathroom and a bigger kitchen change the linked rates only', () => {
    const inp = { ...d, pricing: { ...d.pricing, bathrooms: 3 }, kitchen: { ...d.kitchen, len: 6, sink: 1, washer: 1 } };
    const e = compute(inp);
    expect(e.rows.find(r => r.no === '2.1')!.rate).toBe(16781 * 3 + 16000);
    expect(e.rows.find(r => r.no === '2.2')!.rate).toBeGreaterThan(14119.25);
    expect(e.rows.find(r => r.no === '1.1')!.rate).toBe(10000);
  });
});

describe('parsePart', () => {
  it('keeps numbers, stores blanks as null, ignores unknown names and refuses a markup over 95 %', () => {
    const form: Record<string, string> = { len: '3', wid: '', basins: '2', p_b34: '300', q_b47: '2', bogus: '9' };
    const v = parsePart('bathroom', k => form[k] ?? null, d.bathroom);
    expect(v.len).toBe(3); expect(v.wid).toBeNull(); expect(v.basins).toBe(2); expect(v.p_b34).toBe(300); expect(v.q_b47).toBe(2); expect(v.bogus).toBeUndefined();
    expect(v.hgt).toBe(2.7);  // untouched
    const m = parsePart('master', k => ({ q_i17: '120', r_i17: '95.5', r_i10: '1' } as Record<string, string>)[k] ?? null, d.master);
    expect(m.q_i17).toBe(120); expect(m.r_i17).toBe(95.5); expect(m.r_i10).toBeUndefined();  // a linked item's rate cannot be typed
    expect(() => parsePart('pricing', k => ({ risk_pct: '50', margin_pct: '50' } as Record<string, string>)[k] ?? null, d.pricing)).toThrow(/under 95/);
    const p = parsePart('pricing', k => ({ risk_pct: '', vat_pct: '0' } as Record<string, string>)[k] ?? null, {});
    expect(p.risk_pct).toBe(10); expect(p.vat_pct).toBe(0); expect(p.bathrooms).toBe(2);
  });
});
