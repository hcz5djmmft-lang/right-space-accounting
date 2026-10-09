import 'server-only';
import { sql, type Tx } from './db';
import { audit, createProjectCodes, nextNo } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { CURRENCIES, MAX_BIDDERS, parseItems, parsePrices, STATUSES, tenderTotals, type Bidder, type Item, type Price, type Tender, type Trade } from './tender-calc';
import { today } from './dates';

// Tenders: 1 Details → 2 BOQ → 3 Bidders & prices → 4 Comparison & award → 5 Client price.
// The Tenders role (and Management) edits; the maths lives in tender-calc.ts.

const need = (u: User) => { if (!hasRole(u, 'tenders')) throw new RuleError('Only the Tenders team or Management can change tenders.'); };

export type TenderRow = {
  id: string; no: string; name: string; client_id: string | null; client_name: string; client: string | null; location: string; due_date: string | null; status: string;
  type: string | null; service: string | null; unit: string | null; rates: Record<string, number | null>; markup: number | null; vat: number; notes: string;
  project_id: string | null; project_code: string | null; created_at: string;
};
const rows = (tx: Tx, where = sql``) => tx<TenderRow[]>`
  select t.id, t.no, t.name, t.client_id, t.client_name, coalesce(p.name, nullif(t.client_name, '')) client, t.location, to_char(t.due_date,'YYYY-MM-DD') due_date, t.status,
    t.type, t.service, t.unit, t.rates, t.markup, t.vat, t.notes, t.project_id, pr.code project_code, to_char(t.created_at,'YYYY-MM-DD') created_at
  from tenders t left join parties p on p.id = t.client_id left join projects pr on pr.id = t.project_id ${where} order by t.no desc`;

/** The whole tender with its trades, items, bidders and prices, in the shape the maths uses. */
export async function loadTender(id: string): Promise<(TenderRow & Tender) | null> {
  const [t] = await rows(sql, sql`where t.id = ${id}`);
  if (!t) return null;
  const [trades, items, bidders, prices] = await Promise.all([
    sql<Omit<Trade, 'items' | 'bidders' | 'prices'>[]>`select id, name, division, trade_no, position, markup, selected_bidder from tender_trades where tender_id = ${id} order by position, name`,
    sql<(Item & { trade_id: string })[]>`select i.id, i.trade_id, i.no, i.code, i.description, i.unit, i.qty, i.act_qty from tender_items i join tender_trades tr on tr.id = i.trade_id where tr.tender_id = ${id} order by i.position, i.id`,
    sql<(Bidder & { trade_id: string })[]>`select b.id, b.trade_id, b.name, b.party_id, b.currency, b.wastage, b.discount, b.tax from tender_bidders b join tender_trades tr on tr.id = b.trade_id where tr.tender_id = ${id} order by b.position, b.id`,
    sql<(Price & { bidder_id: string; item_id: string })[]>`select p.bidder_id, p.item_id, p.offer, p.logistics, p.misc from tender_prices p join tender_bidders b on b.id = p.bidder_id join tender_trades tr on tr.id = b.trade_id where tr.tender_id = ${id}`,
  ]);
  const full: Trade[] = trades.map(tr => ({ ...tr, items: [], bidders: [], prices: {} }));
  const byId = new Map(full.map(tr => [tr.id, tr]));
  for (const it of items) byId.get(it.trade_id)?.items.push(it);
  const bidderTrade = new Map<string, Trade>();
  for (const b of bidders) { const tr = byId.get(b.trade_id); if (tr) { tr.bidders.push(b); bidderTrade.set(b.id, tr); } }
  for (const p of prices) { const tr = bidderTrade.get(p.bidder_id); if (tr) (tr.prices[p.bidder_id] ??= {})[p.item_id] = { offer: p.offer, logistics: p.logistics, misc: p.misc }; }
  return { ...t, trades: full };
}

export async function listTenders() {
  const list = await rows(sql);
  return Promise.all(list.map(async t => ({ ...t, totals: tenderTotals((await loadTender(t.id))!) })));
}

export async function createTender(user: User, i: { name: string; client_id?: string | null; client_name?: string; due_date?: string | null }) {
  need(user);
  if (!i.name.trim()) throw new RuleError('Enter a tender name.');
  return sql.begin(async tx => {
    const [s] = await tx<{ vat_rate: number }[]>`select vat_rate from settings where id = 1`;
    const no = await nextNo(tx, 'TND-', 4);
    const [{ id }] = await tx<{ id: string }[]>`insert into tenders (no, name, client_id, client_name, due_date, vat, created_by)
      values (${no}, ${i.name.trim()}, ${i.client_id || null}, ${i.client_name?.trim() || ''}, ${i.due_date || null}, ${s.vat_rate ?? 14}, ${user.id}) returning id`;
    await audit(tx, user, 'tender', id, 'Created', no);
    return id;
  });
}

export type DetailsInput = { name: string; client_id?: string | null; client_name: string; location: string; due_date?: string | null; status: string; type?: string | null; service?: string | null; unit?: string | null; rates: Record<string, number | null>; markup: number | null; vat: number; notes: string };
export async function saveDetails(user: User, id: string, i: DetailsInput) {
  need(user);
  if (!i.name.trim()) throw new RuleError('Enter a tender name.');
  if (!STATUSES.includes(i.status as never)) throw new RuleError('Unknown status.');
  await sql.begin(async tx => {
    const rates = Object.fromEntries(CURRENCIES.filter(c => c !== 'EGP').map(c => [c, i.rates[c] === null || i.rates[c] === undefined || Number.isNaN(i.rates[c]) ? null : r2(Number(i.rates[c]))]));
    const n = await tx`update tenders set ${tx({ name: i.name.trim(), client_id: i.client_id || null, client_name: i.client_name.trim(), location: i.location.trim(), due_date: i.due_date || null, status: i.status,
      type: i.type || null, service: i.service || null, unit: i.unit || null, rates: tx.json(rates as never), markup: i.markup === null ? null : r2(i.markup), vat: r2(i.vat), notes: i.notes })} where id = ${id}`;
    if (!n.count) throw new RuleError('Tender not found.');
    await audit(tx, user, 'tender', id, 'Details saved');
  });
}

export async function deleteTender(user: User, id: string) {
  need(user);
  await sql.begin(async tx => {
    const [t] = await tx<{ no: string; project_id: string | null }[]>`select no, project_id from tenders where id = ${id}`;
    if (!t) return;
    if (t.project_id) throw new RuleError('This tender already has a cost center; it is kept for the record.');
    await tx`delete from tenders where id = ${id}`;
    await audit(tx, user, 'tender', id, 'Deleted', t.no);
  });
}

// ---- step 2: BOQ ----
export async function addTrade(user: User, tenderId: string, name: string, division = '') {
  need(user);
  name = name.trim();
  if (!name) throw new RuleError('Choose or type a trade.');
  const [{ p }] = await sql<{ p: number }[]>`select coalesce(max(position),0)::int p from tender_trades where tender_id = ${tenderId}`;
  const [{ id }] = await sql<{ id: string }[]>`insert into tender_trades (tender_id, position, name, division) values (${tenderId}, ${p + 1}, ${name}, ${division.trim()}) returning id`;
  return id;
}
export async function saveTrade(user: User, tradeId: string, i: { name: string; division: string; trade_no?: string | null }) {
  need(user);
  if (!i.name.trim()) throw new RuleError('The trade needs a name.');
  await sql`update tender_trades set name = ${i.name.trim()}, division = ${i.division.trim()}, trade_no = ${i.trade_no?.trim() || null} where id = ${tradeId}`;
}
export async function deleteTrade(user: User, tradeId: string) { need(user); await sql`delete from tender_trades where id = ${tradeId}`; }

export type ItemInput = { id?: string | null; no: string; code?: string | null; description: string; unit: string; qty: number | null; act_qty: number | null };
/** Replaces the trade's BOQ with these rows (rows without a description are dropped; removed items lose their prices). */
export async function saveItems(user: User, tradeId: string, items: ItemInput[]) {
  need(user);
  const keep = items.filter(i => i.description.trim() || i.no.trim());
  await sql.begin(async tx => {
    const ids = keep.map(i => i.id).filter((x): x is string => !!x);
    await tx`delete from tender_items where trade_id = ${tradeId} and id not in ${tx(ids.length ? ids : ['-'])}`;
    for (const [k, i] of keep.entries()) {
      const vals = { position: k + 1, no: i.no.trim(), code: i.code?.trim() || null, description: i.description.trim(), unit: i.unit.trim(), qty: i.qty, act_qty: i.act_qty };
      if (i.id) await tx`update tender_items set ${tx(vals)} where id = ${i.id} and trade_id = ${tradeId}`;
      else await tx`insert into tender_items ${tx({ ...vals, trade_id: tradeId })}`;
    }
  });
}
export async function pasteItems(user: User, tradeId: string, text: string) {
  need(user);
  const rows = parseItems(text);
  if (!rows.length) throw new RuleError('No rows recognised. Columns: Item no. · Description · Unit · BOQ qty · Actual qty.');
  await sql.begin(async tx => {
    const [{ p }] = await tx<{ p: number }[]>`select coalesce(max(position),0)::int p from tender_items where trade_id = ${tradeId}`;
    for (const [k, r] of rows.entries()) await tx`insert into tender_items ${tx({ trade_id: tradeId, position: p + k + 1, ...r })}`;
  });
  return rows.length;
}

// ---- step 3: bidders and prices ----
export async function addBidder(user: User, tradeId: string) {
  need(user);
  const [{ n, p }] = await sql<{ n: number; p: number }[]>`select count(*)::int n, coalesce(max(position),0)::int p from tender_bidders where trade_id = ${tradeId}`;
  if (n >= MAX_BIDDERS) throw new RuleError(`Up to ${MAX_BIDDERS} bidders per trade.`);
  const [{ id }] = await sql<{ id: string }[]>`insert into tender_bidders (trade_id, position, name) values (${tradeId}, ${p + 1}, ${'Bidder ' + (n + 1)}) returning id`;
  return id;
}
export type BidderInput = { name: string; party_id?: string | null; currency: string; wastage: number | null; discount: number | null; tax: number | null };
export async function saveBidder(user: User, bidderId: string, i: BidderInput) {
  need(user);
  if (!CURRENCIES.includes(i.currency as never)) throw new RuleError('Unknown currency.');
  let name = i.name.trim();
  if (!name && i.party_id) name = (await sql<{ name: string }[]>`select name from parties where id = ${i.party_id}`)[0]?.name ?? '';
  await sql`update tender_bidders set ${sql({ name, party_id: i.party_id || null, currency: i.currency, wastage: i.wastage, discount: i.discount, tax: i.tax })} where id = ${bidderId}`;
}
export async function deleteBidder(user: User, bidderId: string) {
  need(user);
  await sql.begin(async tx => {
    await tx`update tender_trades set selected_bidder = null where selected_bidder = ${bidderId}`;
    await tx`delete from tender_bidders where id = ${bidderId}`;
  });
}
/** Saves a bidder's offers per item; an empty offer removes the price. */
export async function savePrices(user: User, bidderId: string, prices: { item_id: string; offer: number | null; logistics?: number | null; misc?: number | null }[]) {
  need(user);
  await sql.begin(async tx => {
    for (const p of prices) {
      if (p.offer === null || p.offer === undefined || Number.isNaN(p.offer)) { await tx`delete from tender_prices where bidder_id = ${bidderId} and item_id = ${p.item_id}`; continue; }
      await tx`insert into tender_prices (bidder_id, item_id, offer, logistics, misc) values (${bidderId}, ${p.item_id}, ${p.offer}, ${p.logistics ?? null}, ${p.misc ?? null})
        on conflict (bidder_id, item_id) do update set offer = excluded.offer, logistics = excluded.logistics, misc = excluded.misc`;
    }
  });
}
export async function pastePrices(user: User, bidderId: string, text: string) {
  need(user);
  const [b] = await sql<{ trade_id: string }[]>`select trade_id from tender_bidders where id = ${bidderId}`;
  if (!b) throw new RuleError('Bidder not found.');
  const items = await sql<Item[]>`select id, no, description, unit, qty, act_qty from tender_items where trade_id = ${b.trade_id} order by position, id`;
  const plan = parsePrices(text, items);
  if (!plan.length) throw new RuleError('No prices recognised. Paste one column in BOQ order, or two columns: Item no. · Unit price.');
  await sql.begin(async tx => {
    for (const [it, v] of plan)
      await tx`insert into tender_prices (bidder_id, item_id, offer) values (${bidderId}, ${it.id}, ${r2(v)}) on conflict (bidder_id, item_id) do update set offer = excluded.offer`;
  });
  return plan.length;
}

// ---- step 4 and 5 ----
export async function setAwards(user: User, tenderId: string, awards: Record<string, string | null>) {
  need(user);
  await sql.begin(async tx => {
    for (const [tradeId, bidderId] of Object.entries(awards))
      await tx`update tender_trades set selected_bidder = ${bidderId || null} where id = ${tradeId} and tender_id = ${tenderId}`;
    await audit(tx, user, 'tender', tenderId, 'Awards saved');
  });
}
export async function saveMarkups(user: User, tenderId: string, markups: Record<string, number | null>) {
  need(user);
  await sql.begin(async tx => {
    for (const [tradeId, mk] of Object.entries(markups))
      await tx`update tender_trades set markup = ${mk === null || Number.isNaN(mk) ? null : r2(mk)} where id = ${tradeId} and tender_id = ${tenderId}`;
  });
}

/** A won tender becomes a cost center: contract = client price, budget = awarded cost, plus its own GL codes. */
export async function tenderToProject(user: User, id: string) {
  need(user);
  const t = await loadTender(id);
  if (!t) throw new RuleError('Tender not found.');
  if (t.status !== 'Won') throw new RuleError('Mark the tender as Won first.');
  if (t.project_id) throw new RuleError('This tender already has a cost center.');
  const T = tenderTotals(t);
  return sql.begin(async tx => {
    const code = t.no.replace('TND-', 'PRJ-');
    const [{ id: pid }] = await tx<{ id: string }[]>`insert into projects (code, name, client_id, type, service, unit, location, contract, budget, status, start_date, description)
      values (${code}, ${t.name}, ${t.client_id}, ${t.type}, ${t.service}, ${t.unit}, ${t.location || null}, ${T.client}, ${T.cost}, 'Active', ${today()}, ${t.notes || null}) returning id`;
    await createProjectCodes(tx, pid, code);
    await tx`update tenders set project_id = ${pid} where id = ${id}`;
    await audit(tx, user, 'tender', id, 'Cost center created', `${code} · contract ${T.client} · budget ${T.cost}`);
    await audit(tx, user, 'project', pid, 'Created from tender', t.no);
    return pid;
  });
}
