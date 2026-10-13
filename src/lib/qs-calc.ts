import { r2 } from './money';
import { BATHROOM, ELECFIN, ELECTRICAL, KITCHEN, MASTER, SANITARY, SEED_RATES, type QsMaterial } from './qs-data';

// The Master BOQ workbook's maths: five calculators (bathroom and kitchen plumbing rough-in, electrical rough-in, sanitary
// and electrical finishing) whose totals feed the Master BOQ, the dry cost, and the client price (dry cost is 70 % of it:
// risk 10 %, margin 20 %; VAT 14 % on top). Pure functions over an Inputs object; no database.

export type Rec = Record<string, number | null>;  // null = left blank on purpose
export type Inputs = { bathroom: Rec; kitchen: Rec; electrical: Rec; sanitary: Rec; elecfin: Rec; master: Rec; pricing: Rec };
export const PARTS = ['bathroom', 'kitchen', 'electrical', 'sanitary', 'elecfin', 'master', 'pricing'] as const;
export type Part = typeof PARTS[number];
export const CALCULATORS = [['bathroom', 'Bathroom plumbing'], ['kitchen', 'Kitchen plumbing'], ['electrical', 'Electrical rough-in'], ['sanitary', 'Sanitary finishing'], ['elecfin', 'Electrical finishing']] as const;
export const calcLabel = (k: string) => CALCULATORS.find(c => c[0] === k)?.[1] ?? k;

export const PRICING = [
  ['bathrooms', 'Bathrooms priced from the bathroom calculator (× its total)', 2],
  ['bath_labour', 'Bathroom labour and sundries added to item 2.1 (EGP)', 16000],
  ['kitchen_labour', 'Kitchen labour and sundries added to item 2.2 (EGP)', 8000],
  ['risk_pct', 'Risk (% of the client price)', 10],
  ['margin_pct', 'Margin (% of the client price)', 20],
  ['vat_pct', 'VAT (% on the client price, shown apart)', 14],
] as const;

/** Excel's ROUNDUP(x, 0) / CEILING(x, 1) for the positive quantities here: whole purchase units, never below zero. */
export const up = (x: number) => Math.max(0, Math.ceil(x - 1e-9));
const n = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Every input with the workbook's own values, prices from the rate table (the workbook's where none is given). */
export function defaults(rates: Record<string, number> = {}): Inputs {
  const price = (m: QsMaterial) => rates[m.key] ?? SEED_RATES[m.key] ?? m.price;
  const mats = (ms: QsMaterial[]) => Object.fromEntries(ms.flatMap(m => [[`p_${m.key}`, price(m)], ...(m.typed != null ? [[`q_${m.key}`, m.typed]] : [])]));
  const params = (ps: { key: string; def: number }[]) => Object.fromEntries(ps.map(p => [p.key, p.def]));
  const matrix = Object.fromEntries(ELECTRICAL.rooms.flatMap((r, i) => r.def.map((v, j) => [`m${i}_${j}`, v])));
  return {
    bathroom: { ...params(BATHROOM.params), ...params(BATHROOM.fixtures), ...mats(BATHROOM.materials) },
    kitchen: { ...params(KITCHEN.params), ...params(KITCHEN.fixtures), ...mats(KITCHEN.materials) },
    electrical: { ...matrix, ...mats(ELECTRICAL.materials) },
    sanitary: mats(SANITARY.materials),
    elecfin: mats(ELECFIN.materials),
    master: Object.fromEntries(MASTER.items.flatMap(i => [...(i.qty != null ? [[`q_${i.key}`, i.qty]] : []), ...(i.rate != null ? [[`r_${i.key}`, i.rate]] : [])])),
    pricing: Object.fromEntries(PRICING.map(p => [p[0], p[2]])),
  };
}

export type Line = { key: string; no: string; desc: string; size: string; brand: string; unit: string; qty: number; price: number; total: number; typed: boolean; group: number; note: string };
export type Indicator = { key: string; label: string; unit: string; value: number };
export type CalcResult = { indicators: Indicator[]; lines: Line[]; groups: { title: string; total: number }[]; total: number };

function lines(ms: QsMaterial[], v: Rec, qty: Record<string, number>): CalcResult {
  const out: Line[] = ms.map(m => {
    const q = m.typed != null ? n(v[`q_${m.key}`]) : n(qty[m.key]);
    const price = n(v[`p_${m.key}`]);
    return { key: m.key, no: m.no, desc: m.desc, size: m.size, brand: m.brand, unit: m.unit, qty: q, price, total: r2(q * price), typed: m.typed != null, group: m.group, note: m.note };
  });
  const groups = [...new Set(ms.map(m => m.group))].map(g => ({ title: '', total: r2(out.filter(l => l.group === g).reduce((t, l) => t + l.total, 0)) }));
  return { indicators: [], lines: out, groups, total: r2(out.reduce((t, l) => t + l.total, 0)) };
}
const withTitles = (r: CalcResult, titles: { title: string }[]) => ({ ...r, groups: r.groups.map((g, i) => ({ ...g, title: titles[i]?.title ?? '' })) });
const ind = (def: { key: string; label: string; unit: string }[], values: Rec): Indicator[] => def.map(d => ({ ...d, value: n(values[d.key]) }));

/** Bathroom rough-in (sheet 4): PPR supply and PVC drainage from the room's size, the risers' distance and the fixtures. */
export function bathroom(v: Rec): CalcResult {
  const waste = n(v.waste) / 100, len = n(v.len), wid = n(v.wid), riser = n(v.riser);
  const basins = n(v.basins), wcWall = n(v.wc_wall), wcStd = n(v.wc_std), conc = n(v.shower_conc), exp = n(v.shower_exp), tub = n(v.tub), heater = n(v.heater), washer = n(v.washer), shattaf = n(v.shattaf);
  const area = len * wid, perim = 2 * (len + wid), wp = area + perim * 0.3;
  const outlets = basins * 2 + wcWall + wcStd + (conc > 0 ? conc + 2 : 0) + exp * 2 + tub * 2 + heater * 2 + washer + shattaf;
  const q: Record<string, number> = {};
  q.b34 = up((((riser + perim * 0.6 + outlets * 0.8) * 2) * (1 + waste)) / 4);
  q.b37 = outlets; q.b38 = outlets; q.b39 = up(outlets * 0.75); q.b40 = up(outlets * 1.2 + 6); q.b41 = 4 + (perim > 8 ? 2 : 0);
  q.b42 = (heater > 0 ? 2 : 0) + (conc > 0 ? 2 : 0) + (exp > 0 ? 2 : 0) + (basins > 0 ? 1 : 0);
  q.b43 = q.b34 + 2; q.b44 = up(q.b34 * 4 * 1.5); q.b45 = up(outlets / 3) + 1;
  q.b50 = up((((perim * 0.4 + basins * 1.5 + (conc > 0 ? 1.5 : 0) + exp * 1.2 + tub * 2 + washer * 2.5)) * (1 + waste)) / 4);
  q.b51 = 1; q.b52 = up((basins + (conc > 0 ? 1 : 0) + exp + tub + washer) * 2 + 2); q.b53 = up(basins + (conc > 0 ? 1 : 0) + exp + washer);
  q.b54 = wcWall + wcStd; q.b55 = wcWall + wcStd; q.b56 = basins + (conc > 0 ? 1 : 0) + exp + tub + washer + (wcWall + wcStd) + 1;
  q.b57 = n(v.q_b49) + q.b50 > 5 ? 2 : 1;
  const r = withTitles(lines(BATHROOM.materials, v, q), BATHROOM.groups);
  r.indicators = ind(BATHROOM.indicators, { area: Math.round(area * 10000) / 10000, perim: r2(perim), wp: Math.round(wp * 10000) / 10000, outlets });
  return r;
}

/** Kitchen rough-in (sheet 5): the same pattern with the appliances' on/off flags. */
export function kitchen(v: Rec): CalcResult {
  const waste = n(v.waste) / 100, len = n(v.len), wid = n(v.wid), riser = n(v.riser), stack = n(v.stack);
  const sink = n(v.sink), dish = n(v.dishwasher), filter = n(v.filter), heater = n(v.heater), washer = n(v.washer);
  const area = len * wid, perim = 2 * (len + wid), wp = area + perim * 0.3;
  const outlets = sink * 2 + dish + filter + heater * 2 + washer;
  const q: Record<string, number> = {};
  q.k30 = up((((riser + perim * 0.5 + outlets * 0.8) * 2) * (1 + waste)) / 4);
  q.k33 = outlets; q.k34 = outlets; q.k35 = up(outlets * 0.75); q.k36 = up(outlets * 1.2 + 4); q.k37 = 4; q.k38 = (heater > 0 ? 2 : 0) + 1;
  q.k39 = q.k30 + 1; q.k40 = up(q.k30 * 4 * 1.5); q.k41 = up(outlets / 3) + 1;
  q.k43 = up((((stack + perim * 0.3 + sink * 1.5 + dish * 1.5 + washer * 2)) * (1 + waste)) / 4);
  q.k44 = 1; q.k45 = up((sink + dish + washer) * 2 + 2); q.k46 = up(sink + dish + washer); q.k47 = sink + dish + washer + 1; q.k48 = 1;
  const r = withTitles(lines(KITCHEN.materials, v, q), KITCHEN.groups);
  r.indicators = ind(KITCHEN.indicators, { area: Math.round(area * 10000) / 10000, perim: r2(perim), wp: Math.round(wp * 10000) / 10000, outlets });
  return r;
}

/** The electrical point matrix's column totals: ceiling and wall lights, switches, sockets, power, heater, TV, data, boxes. */
export function pointTotals(v: Rec) {
  const t = { ceil: 0, wall: 0, sw1: 0, sw2: 0, sw2way: 0, sock: 0, power: 0, heater: 0, tv: 0, data: 0, boxes: 0 };
  const keys = ELECTRICAL.points.map(p => p.key) as (keyof typeof t)[];
  ELECTRICAL.rooms.forEach((_, i) => {
    let boxes = 0;
    keys.forEach((k, j) => { const x = n(v[`m${i}_${j}`]); t[k] += x; if (j >= 2) boxes += x; });
    t.boxes += boxes;
  });
  return t;
}
export const roomBoxes = (v: Rec, i: number) => ELECTRICAL.points.reduce((s, _, j) => s + (j >= 2 ? n(v[`m${i}_${j}`]) : 0), 0);

/** Electrical rough-in (sheet 7): wires, conduits, boxes, the panel and low current from the room-by-room points. */
export function electrical(v: Rec): CalcResult {
  const t = pointTotals(v);
  const lights = t.ceil + t.wall, switches = t.sw1 + t.sw2 + t.sw2way;
  const q: Record<string, number> = {};
  q.e27 = up(((lights * 8 + switches * 6) * 1.15) / 100); q.e28 = up((t.sock * 12 * 1.15) / 100); q.e29 = up(((t.power * 16 + t.heater * 14) * 1.15) / 100);
  q.e35 = up(((lights * 4 + switches * 3) * 1.15) / 50); q.e36 = up(((t.sock + t.power + t.heater) * 8 * 1.15) / 50); q.e38 = up(t.boxes * 1.12);
  q.e45 = up(lights / 10); q.e46 = up(t.sock / 6); q.e47 = t.power + t.heater;
  q.e54 = up((t.tv * 18 * 1.1) / 100); q.e55 = up((t.data * 18 * 1.1) / 100);
  const r = withTitles(lines(ELECTRICAL.materials, v, q), ELECTRICAL.groups);
  r.indicators = ind(ELECTRICAL.indicators, {
    lights, boxes: up(t.boxes * 1.1), switches, light_circuits: up(lights / 10), sockets: t.sock + t.power, socket_circuits: up(t.sock / 6),
    power_lines: t.power + t.heater, direct_lines: t.power + t.heater, lowcurrent: t.tv + t.data, panel_ways: up((lights / 10 + t.sock / 6 + t.power + t.heater + 2) * 1.2),
  });
  return r;
}

/** Sanitary finishing (sheet 8): typed quantities × prices, the bathroom and the kitchen apart. */
export const sanitary = (v: Rec): CalcResult => withTitles(lines(SANITARY.materials, v, {}), SANITARY.groups);

/** Electrical finishing (sheet 9): modules, plates and spots counted from the electrical points, LED items typed. */
export function elecfin(v: Rec, elec: Rec): CalcResult {
  const t = pointTotals(elec);
  const q: Record<string, number> = { f5: t.boxes, f6: t.sw1 + t.sw2 * 2 + t.sw2way, f7: t.sock, f8: t.power, f9: t.tv + t.data, f10: t.boxes, f14: t.ceil + t.wall };
  return withTitles(lines(ELECFIN.materials, v, q), ELECFIN.groups);
}

export type MasterRow = { key: string; no: string; section: string; desc: string; unit: string; qty: number | null; rate: number | null; total: number; source: string; linked: boolean; note: string; client_rate: number; client_total: number };
export type Pricing = { risk_pct: number; margin_pct: number; vat_pct: number; factor: number; client: number; risk: number; margin: number; vat: number; total: number };
export type Estimate = { bathroom: CalcResult; kitchen: CalcResult; electrical: CalcResult; sanitary: CalcResult; elecfin: CalcResult; rows: MasterRow[]; dry: number; pricing: Pricing; materials: (Line & { calculator: string })[] };

/** Dry cost is (1 − risk − margin) of the client price; the factor turns a dry rate into a client rate. */
export const clientFactor = (risk: number, margin: number) => { const f = 1 - (n(risk) + n(margin)) / 100; return f > 0.05 ? f : 1; };

/** The whole estimate: every calculator, the Master BOQ rows with the linked rates, the dry cost and the client price. */
export function compute(inp: Inputs): Estimate {
  const b = bathroom(inp.bathroom), k = kitchen(inp.kitchen), e = electrical(inp.electrical), s = sanitary(inp.sanitary), f = elecfin(inp.elecfin, inp.electrical);
  const p = inp.pricing;
  const linkedRate: Record<string, number> = {
    bathroom: r2(b.total * n(p.bathrooms) + n(p.bath_labour)), kitchen: r2(k.total + n(p.kitchen_labour)), electrical: e.total,
    san_bath: s.groups[0]?.total ?? 0, san_kitchen: s.groups[1]?.total ?? 0, elecfin: f.total,
  };
  const factor = clientFactor(n(p.risk_pct), n(p.margin_pct));
  const rows: MasterRow[] = MASTER.items.map(i => {
    const linked = i.source !== 'manual';
    const qty = inp.master[`q_${i.key}`] ?? null;
    const rate = linked ? linkedRate[i.source] : inp.master[`r_${i.key}`] ?? null;
    const total = qty == null || rate == null ? 0 : r2(qty * rate);
    const client_rate = rate == null ? 0 : r2(rate / factor);
    return { key: i.key, no: i.no, section: i.section, desc: i.desc, unit: i.unit, qty, rate, total, source: i.source, linked, note: i.note, client_rate, client_total: qty == null ? 0 : r2(qty * client_rate) };
  });
  const dry = r2(rows.reduce((t, r) => t + r.total, 0));
  const client = r2(rows.reduce((t, r) => t + r.client_total, 0));
  const vat = r2(client * n(p.vat_pct) / 100);
  const pricing: Pricing = { risk_pct: n(p.risk_pct), margin_pct: n(p.margin_pct), vat_pct: n(p.vat_pct), factor, client, risk: r2(client * n(p.risk_pct) / 100), margin: r2(client * n(p.margin_pct) / 100), vat, total: r2(client + vat) };
  const materials = ([['bathroom', b], ['kitchen', k], ['electrical', e], ['sanitary', s], ['elecfin', f]] as const).flatMap(([c, r]) => r.lines.filter(l => l.qty > 0).map(l => ({ ...l, calculator: c })));
  return { bathroom: b, kitchen: k, electrical: e, sanitary: s, elecfin: f, rows, dry, pricing, materials };
}

/** Reads one part's inputs from a form: numbers kept, blanks stored as null (a blank quantity or rate makes the Master BOQ line 0). */
export function parsePart(part: Part, get: (name: string) => string | null, current: Rec): Rec {
  const keys: string[] = part === 'bathroom' ? [...BATHROOM.params, ...BATHROOM.fixtures].map(p => p.key).concat(BATHROOM.materials.flatMap(m => [`p_${m.key}`, ...(m.typed != null ? [`q_${m.key}`] : [])]))
    : part === 'kitchen' ? [...KITCHEN.params, ...KITCHEN.fixtures].map(p => p.key).concat(KITCHEN.materials.flatMap(m => [`p_${m.key}`, ...(m.typed != null ? [`q_${m.key}`] : [])]))
    : part === 'electrical' ? ELECTRICAL.rooms.flatMap((_, i) => ELECTRICAL.points.map((_, j) => `m${i}_${j}`)).concat(ELECTRICAL.materials.flatMap(m => [`p_${m.key}`, ...(m.typed != null ? [`q_${m.key}`] : [])]))
    : part === 'sanitary' ? SANITARY.materials.flatMap(m => [`p_${m.key}`, `q_${m.key}`])
    : part === 'elecfin' ? ELECFIN.materials.flatMap(m => [`p_${m.key}`, ...(m.typed != null ? [`q_${m.key}`] : [])])
    : part === 'master' ? MASTER.items.flatMap(i => [`q_${i.key}`, ...(i.source === 'manual' ? [`r_${i.key}`] : [])])
    : PRICING.map(p => p[0] as string);
  const out: Rec = { ...current };
  for (const k of keys) {
    const raw = get(k);
    if (raw === null) continue;
    const t = raw.trim();
    if (t === '') { out[k] = null; continue; }
    const x = Number(t.replace(/,/g, ''));
    if (Number.isFinite(x) && x >= 0) out[k] = x;
  }
  if (part === 'pricing') {
    for (const k of PRICING.map(p => p[0])) if (out[k] == null) out[k] = PRICING.find(p => p[0] === k)![2];
    if ((out.risk_pct ?? 0) + (out.margin_pct ?? 0) >= 95) throw new Error('Risk and margin together must stay under 95 % of the client price.');
  }
  return out;
}

export const STATUS_LABELS: Record<string, string> = { draft: 'Being prepared', sent: 'Sent to the client', accepted: 'Accepted · contract', rejected: 'Client declined', superseded: 'Superseded' };
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;
export const statusClass = (s: string) => 'pill ' + (s === 'accepted' ? 'posted' : s === 'rejected' ? 'rejected' : s === 'sent' ? 'pending' : '');
