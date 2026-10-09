// The tender maths against the Maghagha tender from the old app's snapshot (343 items, 46 trades).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { clientRows, parseItems, parsePrices, tenderInputs, tenderTotals, tradeSel, uRate, type Tender, type Trade } from '@/lib/tender-calc';

const ctx = { window: {} as Record<string, unknown> };
vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
const seed = ctx.window.__SEED as Record<string, Record<string, Record<string, unknown>>>;
const n = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

/** The old document shape → the calc shape (the same mapping the importer uses). */
function load(id: string): Tender {
  const t = seed.tenders[id] as Record<string, unknown>;
  const trades = Object.entries(seed[`tenders/${id}/trades`] ?? {}).map(([tid, x]): Trade => {
    const d = x as { name: string; division?: string; order?: number; markup?: unknown; selected?: string; items: Record<string, unknown>[]; bidders: Record<string, unknown>[]; prices?: Record<string, Record<string, Record<string, unknown>>> };
    return {
      id: tid, name: d.name, division: d.division ?? '', position: d.order ?? 0, markup: n(d.markup), selected_bidder: d.selected || null,
      items: d.items.map(i => ({ id: String(i.id), no: String(i.no ?? ''), description: String(i.desc ?? ''), unit: String(i.unit ?? ''), qty: n(i.qty), act_qty: n(i.actQty) })),
      bidders: d.bidders.map(b => ({ id: String(b.id), name: String(b.name ?? ''), currency: String(b.cur || 'EGP'), wastage: n(b.wastage), discount: n(b.disc), tax: n(b.tax) })),
      prices: Object.fromEntries(Object.entries(d.prices ?? {}).map(([bid, m]) => [bid, Object.fromEntries(Object.entries(m).map(([iid, p]) => [iid, { offer: n(p.offer), logistics: n(p.logi), misc: n(p.misc) }]))])),
    };
  }).sort((a, b) => a.position - b.position);
  const rates = Object.fromEntries(Object.entries((t.rates as Record<string, unknown>) ?? {}).map(([k, v]) => [k, n(v)]));
  return { id, no: String(t.no), name: String(t.name), rates, markup: n(t.markup), vat: Number(t.vat ?? 14), trades, due_date: (t.dueDate as string) || null, client_id: (t.client as string) || null, client_name: String(t.clientName ?? '') };
}

describe('tender maths on Maghagha (TND-0001)', () => {
  const t = load('maghagha');
  it('has 46 trades and 343 BOQ items, and a selected-offer cost of 623,302,349.92 at 0% markup', () => {
    const T = tenderTotals(t);
    expect(T).toMatchObject({ trades: 46, items: 343, cost: 623302349.92, client: 623302349.92 });
    expect(T.vat).toBe(87262328.99);
    expect(T.priced).toBeLessThan(46); // 5 trades have no offers, as the old notes say
  });
  it('unit rate = offer × fx × (1 + wastage%) × (1 − discount%) + logistics + misc', () => {
    const tr = t.trades[0]; // excavation: Bidder 1 offers 70 with 30% wastage
    expect(uRate(t, tr, tr.bidders[0], tr.items[0])).toBe(91);
    const eur = t.trades.find(x => x.bidders.some(b => b.currency === 'EUR'))!;
    const b = eur.bidders.find(x => x.currency === 'EUR')!;
    const it = eur.items.find(i => eur.prices[b.id]?.[i.id]?.offer != null)!;
    const p = eur.prices[b.id][it.id];
    expect(uRate(t, eur, b, it)).toBe(Math.round(((p.offer ?? 0) * 60 * (1 + (b.wastage ?? 0) / 100) * (1 - (b.discount ?? 0) / 100) + (p.logistics ?? 0) + (p.misc ?? 0)) * 100) / 100);
  });
  it('awards the selected bidder, else the lowest complete offer', () => {
    const awarded = t.trades.find(x => x.selected_bidder)!;
    expect(tradeSel(t, awarded)).toMatchObject({ auto: false, b: { id: awarded.selected_bidder } });
    const open = { ...awarded, selected_bidder: null };
    const s = tradeSel(t, open)!;
    expect(s.auto).toBe(true);
    expect(s.after).toBe(Math.min(...open.bidders.map(b => tradeSel(t, { ...open, selected_bidder: b.id })!).filter(x => x.complete).map(x => x.after)));
  });
  it('markup raises the client price per trade; the sidebar lists what is still missing', () => {
    const T = tenderTotals({ ...t, markup: 10 });
    expect(T.client).toBe(Math.round(623302349.92 * 1.1 * 100) / 100);
    const rows = clientRows({ ...t, markup: 10 });
    expect(rows).toHaveLength(343);
    // per-item client rates are rounded to piastres before × qty, so the item sum differs from the trade totals by rounding only
    expect(Math.abs(rows.reduce((s, r) => s + (r.amt ?? 0), 0) - T.client) / T.client).toBeLessThan(0.00001);
    const need = tenderInputs(t);
    expect(need.map(x => x[2])).toContain('Add the client');
    expect(need.map(x => x[2])).toContain('Set your markup to get the client price');
    expect(need.filter(x => x[0] === 'compare').length).toBeGreaterThan(0);
  });
  it('parses BOQ rows and prices pasted from Excel', () => {
    const items = parseItems('Item\tDescription\tUnit\tQty\n1\tPainting walls\tm2\t1,250\n2\tCeiling\tm2\tx\n3\tDoors\tno\t12\t10');
    expect(items).toEqual([{ no: '1', description: 'Painting walls', unit: 'm2', qty: 1250, act_qty: null }, { no: '3', description: 'Doors', unit: 'no', qty: 12, act_qty: 10 }]);
    const its = items.map((i, k) => ({ ...i, id: 'i' + k }));
    expect(parsePrices('100\n200', its).map(([i, v]) => [i.no, v])).toEqual([['1', 100], ['3', 200]]);
    expect(parsePrices('3\t55\n1\t44', its).map(([i, v]) => [i.no, v])).toEqual([['3', 55], ['1', 44]]);
  });
});
