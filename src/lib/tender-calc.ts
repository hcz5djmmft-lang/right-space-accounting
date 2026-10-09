import { r2 } from './money';

// Tender maths, a port of the old app's uRate / bidTotals / tradeSel / tenderTotals / tenderInputs.
// Pure functions over a loaded tender; no database.

export const STD_TRADES = ['excavation', 'backfilling', 'Soil replacement', 'plain concrete', 'reinforced concrete', 'Masonry', 'insulation', 'terrazo tiles', 'joints', 'metal works', 'Stainless Steel Works', 'fence', 'Metal Doors', 'Stainless Steel Doors', 'wooden doors', 'Door Hardware', 'Glass Works', 'Aluminium Works', 'Aluminium Doors and Windows', 'plaster', 'Painting', 'Epoxy and Polyurethane painting', 'ceramic and porcelain tiles', 'Stone & marble', 'Corian', 'wooden work', 'Gypsum and Cement Board', 'Vinyle', 'Rubber Floor', 'Mockett', 'Raised Floor', 'Sornaga', 'suspended ceiling', 'Mirrors', 'Curtains', 'PVC Works', 'Signage', 'Counters', 'interlocking', 'curbs', 'roads', 'Landscape', 'Accessories', 'road marking', 'precast', 'Stainless steel equipments'];
export const STATUSES = ['Draft', 'Pricing', 'Submitted', 'Won', 'Lost'] as const;
export const CURRENCIES = ['EGP', 'USD', 'EUR', 'SAR', 'AED'] as const;
export const MAX_BIDDERS = 12;

export type Item = { id: string; no: string; code?: string | null; description: string; unit: string; qty: number | null; act_qty: number | null };
export type Bidder = { id: string; name: string; party_id?: string | null; currency: string; wastage: number | null; discount: number | null; tax: number | null };
export type Price = { offer: number | null; logistics?: number | null; misc?: number | null };
export type Trade = {
  id: string; name: string; division: string; trade_no?: string | null; position: number; markup: number | null; selected_bidder: string | null;
  items: Item[]; bidders: Bidder[]; prices: Record<string, Record<string, Price>>;
};
export type Tender = { id: string; no: string; name: string; rates: Record<string, number | null>; markup: number | null; vat: number; trades: Trade[]; due_date?: string | null; client_id?: string | null; client_name?: string };

export const fxOf = (t: Pick<Tender, 'rates'>, cur: string | null | undefined) => (!cur || cur === 'EGP' ? 1 : +(t.rates?.[cur] ?? 0) || 0);

/** Unit rate = offer × exchange rate × (1 + wastage %) × (1 − discount %) + logistics + misc, as in the Comparison Sheet. */
export function uRate(t: Pick<Tender, 'rates'>, tr: Trade, b: Bidder, it: Item): number | null {
  const p = tr.prices[b.id]?.[it.id];
  if (!p || p.offer === null || p.offer === undefined) return null;
  return r2((+p.offer || 0) * fxOf(t, b.currency) * (1 + (+(b.wastage ?? 0) || 0) / 100) * (1 - (+(b.discount ?? 0) || 0) / 100) + (+(p.logistics ?? 0) || 0) + (+(p.misc ?? 0) || 0));
}

export type BidTotal = { b: Bidder; tot: number; act: number; after: number; fin: number; priced: number; complete: boolean };
export function bidTotals(t: Pick<Tender, 'rates'>, tr: Trade): BidTotal[] {
  return tr.bidders.map(b => {
    let tot = 0, act = 0, priced = 0;
    for (const it of tr.items) {
      const u = uRate(t, tr, b, it);
      if (u !== null) { tot += u * (+(it.qty ?? 0) || 0); act += u * (+(it.act_qty ?? 0) || 0); priced++; }
    }
    return { b, tot: r2(tot), act: r2(act), after: r2(tot), fin: r2(tot * (1 + (+(b.tax ?? 0) || 0) / 100)), priced, complete: priced > 0 && priced === tr.items.length };
  });
}

/** The awarded bidder, or the lowest complete offer when nothing is awarded yet (`auto`). */
export function tradeSel(t: Pick<Tender, 'rates'>, tr: Trade): (BidTotal & { auto: boolean }) | null {
  const bt = bidTotals(t, tr).filter(x => x.priced);
  if (!bt.length) return null;
  const chosen = tr.selected_bidder && bt.find(x => x.b.id === tr.selected_bidder);
  if (chosen) return { ...chosen, auto: false };
  const pool = bt.filter(x => x.complete).length ? bt.filter(x => x.complete) : bt;
  return { ...pool.sort((a, b) => a.after - b.after)[0], auto: true };
}

export const tMarkup = (t: Pick<Tender, 'markup'>, tr: Pick<Trade, 'markup'>) => (tr.markup !== null && tr.markup !== undefined ? +tr.markup : +(t.markup ?? 0) || 0);
export const selRate = (t: Pick<Tender, 'rates'>, tr: Trade, it: Item, sel = tradeSel(t, tr)) => (sel ? uRate(t, tr, sel.b, it) : null);

export type Totals = { cost: number; client: number; vat: number; items: number; trades: number; priced: number };
export function tenderTotals(t: Tender): Totals {
  let cost = 0, client = 0, items = 0, trades = 0, priced = 0;
  for (const tr of t.trades) {
    trades++; items += tr.items.length;
    const sel = tradeSel(t, tr);
    if (sel) { priced++; cost += sel.after; client += sel.after * (1 + tMarkup(t, tr) / 100); }
  }
  return { cost: r2(cost), client: r2(client), vat: r2(client * (+t.vat || 0) / 100), items, trades, priced };
}

export type Step = 'details' | 'boq' | 'bids' | 'compare' | 'client';
/** What is still missing, as [step, trade id, message], shown in the sidebar. */
export function tenderInputs(t: Tender): [Step, string, string][] {
  const out: [Step, string, string][] = [];
  if (!t.client_id && !t.client_name) out.push(['details', '', 'Add the client']);
  if (!t.due_date) out.push(['details', '', 'Add the submission date']);
  for (const b of t.trades.flatMap(tr => tr.bidders)) if (b.currency && b.currency !== 'EGP' && !fxOf(t, b.currency)) { out.push(['details', '', `Enter the ${b.currency} exchange rate`]); break; }
  if (!t.trades.length) out.push(['boq', '', 'Add the first trade and its BOQ items']);
  for (const tr of t.trades) {
    const noQ = tr.items.filter(i => !(+(i.qty ?? 0) > 0)).length;
    if (!tr.items.length) out.push(['boq', tr.id, `${tr.name}: no BOQ items yet`]);
    else if (noQ) out.push(['boq', tr.id, `${tr.name}: ${noQ} item${noQ > 1 ? 's' : ''} without quantity`]);
    if (tr.items.length && !tr.bidders.length) out.push(['bids', tr.id, `${tr.name}: no bidders yet`]);
    for (const x of bidTotals(t, tr)) if (x.priced < tr.items.length) { const n = tr.items.length - x.priced; out.push(['bids', tr.id, `${tr.name}: ${x.b.name || 'bidder'} has ${n} unpriced item${n > 1 ? 's' : ''}`]); }
    const sel = tradeSel(t, tr);
    if (sel && sel.auto && tr.bidders.length > 0) out.push(['compare', tr.id, `${tr.name}: confirm the award (lowest bidder picked for now)`]);
  }
  if (t.trades.length && !(+(t.markup ?? 0)) && !t.trades.some(tr => tr.markup !== null && tr.markup !== undefined)) out.push(['client', '', 'Set your markup to get the client price']);
  return out;
}

export type ClientRow = { tr: Trade; it: Item; cr: number | null; amt: number | null };
/** Client unit rate = awarded unit rate × (1 + markup %), per BOQ item. */
export function clientRows(t: Tender): ClientRow[] {
  const rows: ClientRow[] = [];
  for (const tr of t.trades) {
    const sel = tradeSel(t, tr), mk = tMarkup(t, tr);
    for (const it of tr.items) {
      const sr = selRate(t, tr, it, sel);
      const cr = sr === null ? null : r2(sr * (1 + mk / 100));
      rows.push({ tr, it, cr, amt: cr === null ? null : r2(cr * (+(it.qty ?? 0) || 0)) });
    }
  }
  return rows;
}

/** Parses rows pasted from Excel: Item no. · Description · Unit · BOQ qty · Actual qty. A header row is skipped. */
export function parseItems(text: string) {
  const num = (s: string) => { s = s.replace(/,/g, '').trim(); return s === '' ? null : isNaN(+s) ? NaN : r2(+s); };
  return text.split(/\r?\n/).map(l => l.split('\t')).filter(c => c.some(x => x.trim()))
    .map(c => ({ no: (c[0] || '').trim(), description: (c[1] || '').trim(), unit: (c[2] || '').trim(), qty: num(c[3] || ''), act_qty: num(c[4] || '') }))
    .filter(r => r.description && !Number.isNaN(r.qty) && !Number.isNaN(r.act_qty));
}

/** Parses pasted prices: one column in BOQ order, or two columns "Item no. · Unit price" matched by item no. */
export function parsePrices(text: string, items: Item[]): [Item, number][] {
  const rows = text.split(/\r?\n/).map(l => l.split('\t').map(x => x.replace(/,/g, '').trim())).filter(c => c.some(Boolean));
  const plan: [Item, number][] = [];
  if (rows.length && rows.every(c => c.length >= 2) && rows.some(c => items.some(it => String(it.no) === c[0]))) {
    for (const c of rows) { const it = items.find(x => String(x.no) === c[0]); if (it && c[1] !== '' && !isNaN(+c[1])) plan.push([it, +c[1]]); }
  } else {
    const nums = rows.map(c => c[c.length - 1]).filter(v => v !== '' && !isNaN(+v));
    nums.forEach((v, i) => { if (items[i]) plan.push([items[i], +v]); });
  }
  return plan;
}
