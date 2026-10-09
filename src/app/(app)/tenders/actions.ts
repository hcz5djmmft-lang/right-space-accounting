'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import * as tn from '@/lib/tenders';
import { CURRENCIES } from '@/lib/tender-calc';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const num = (f: FormData, k: string) => { const s = str(f, k).replace(/,/g, ''); return s === '' ? null : Number(s); };

/** Runs the change, then goes back to the tender at the right step and trade. */
async function go(tenderId: string, step: string, trade: string | (() => string), fn: () => Promise<unknown>, extra: Record<string, string> = {}) {
  let err = '', ok = '';
  try { const r = await fn(); if (typeof r === 'string' || typeof r === 'number') ok = String(r); } catch (e) { err = msg(e); }
  revalidatePath('/tenders');
  const tr = typeof trade === 'function' ? trade() : trade;
  const q = new URLSearchParams({ step, ...(tr ? { trade: tr } : {}), ...extra, ...(err ? { error: err } : {}), ...(ok ? { ok } : {}) });
  redirect(`/tenders/${tenderId}?${q}`);
}

export async function createTenderAction(f: FormData) {
  const user = await requireUser('tenders');
  let id = '';
  try { id = await tn.createTender(user, { name: str(f, 'name'), client_id: str(f, 'client_id') || null, client_name: str(f, 'client_name'), due_date: str(f, 'due_date') || null }); }
  catch (e) { redirect(`/tenders?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/tenders');
  redirect(`/tenders/${id}?step=boq`);
}
export async function saveDetailsAction(id: string, f: FormData) {
  const user = await requireUser('tenders');
  await go(id, 'details', '', () => tn.saveDetails(user, id, {
    name: str(f, 'name'), client_id: str(f, 'client_id') || null, client_name: str(f, 'client_name'), location: str(f, 'location'), due_date: str(f, 'due_date') || null,
    status: str(f, 'status'), type: str(f, 'type') || null, service: str(f, 'service') || null, unit: str(f, 'unit') || null,
    rates: Object.fromEntries(CURRENCIES.filter(c => c !== 'EGP').map(c => [c, num(f, 'rate_' + c)])), markup: num(f, 'markup'), vat: num(f, 'vat') ?? 14, notes: str(f, 'notes'),
  }));
}
export async function deleteTenderAction(id: string) {
  const user = await requireUser('tenders');
  try { await tn.deleteTender(user, id); } catch (e) { redirect(`/tenders/${id}?step=details&error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/tenders');
  redirect('/tenders');
}
export async function tenderToProjectAction(id: string) {
  const user = await requireUser('tenders');
  let pid = '';
  try { pid = await tn.tenderToProject(user, id); } catch (e) { redirect(`/tenders/${id}?step=details&error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/cost-centers/${pid}`);
}

export async function addTradeAction(id: string, f: FormData) {
  const user = await requireUser('tenders');
  let tradeId = '';
  await go(id, 'boq', () => tradeId, async () => { tradeId = await tn.addTrade(user, id, str(f, 'new_name') || str(f, 'std_name'), str(f, 'division')); });
}
export async function saveTradeAction(id: string, tradeId: string, f: FormData) {
  const user = await requireUser('tenders');
  await go(id, 'boq', tradeId, () => tn.saveTrade(user, tradeId, { name: str(f, 'name'), division: str(f, 'division'), trade_no: str(f, 'trade_no') || null }));
}
export async function deleteTradeAction(id: string, tradeId: string) {
  const user = await requireUser('tenders');
  await go(id, 'boq', '', () => tn.deleteTrade(user, tradeId));
}
export async function saveItemsAction(id: string, tradeId: string, f: FormData) {
  const user = await requireUser('tenders');
  const rows = [...f.keys()].filter(k => k.startsWith('row_')).map(k => k.slice(4)).map(r => ({
    id: str(f, `id_${r}`) || null, no: str(f, `no_${r}`), code: str(f, `code_${r}`) || null, description: str(f, `desc_${r}`), unit: str(f, `unit_${r}`), qty: num(f, `qty_${r}`), act_qty: num(f, `act_${r}`),
  }));
  await go(id, 'boq', tradeId, () => tn.saveItems(user, tradeId, rows));
}
export async function pasteItemsAction(id: string, tradeId: string, f: FormData) {
  const user = await requireUser('tenders');
  await go(id, 'boq', tradeId, async () => `${await tn.pasteItems(user, tradeId, String(f.get('text') ?? ''))} items added`);
}
export async function addBidderAction(id: string, tradeId: string) {
  const user = await requireUser('tenders');
  await go(id, 'bids', tradeId, () => tn.addBidder(user, tradeId));
}
export async function saveBidderAction(id: string, tradeId: string, bidderId: string, f: FormData) {
  const user = await requireUser('tenders');
  await go(id, 'bids', tradeId, () => tn.saveBidder(user, bidderId, { name: str(f, 'name'), party_id: str(f, 'party_id') || null, currency: str(f, 'currency') || 'EGP', wastage: num(f, 'wastage'), discount: num(f, 'discount'), tax: num(f, 'tax') }));
}
export async function deleteBidderAction(id: string, tradeId: string, bidderId: string) {
  const user = await requireUser('tenders');
  await go(id, 'bids', tradeId, () => tn.deleteBidder(user, bidderId));
}
/** Saves every offer on the grid: inputs are named p_<bidder>_<item>_offer|logistics|misc. */
export async function savePricesAction(id: string, tradeId: string, f: FormData) {
  const user = await requireUser('tenders');
  const misc = str(f, 'misc') === '1';
  const by = new Map<string, { item_id: string; offer: number | null; logistics?: number | null; misc?: number | null }[]>();
  for (const k of f.keys()) {
    const m = /^p_([^_]+)_([^_]+)_offer$/.exec(k);
    if (!m) continue;
    const [, b, it] = m;
    (by.get(b) ?? by.set(b, []).get(b)!).push({ item_id: it, offer: num(f, k), logistics: num(f, `p_${b}_${it}_logistics`), misc: num(f, `p_${b}_${it}_misc`) });
  }
  await go(id, 'bids', tradeId, async () => { for (const [b, prices] of by) await tn.savePrices(user, b, prices); }, misc ? { misc: '1' } : {});
}
export async function pastePricesAction(id: string, tradeId: string, bidderId: string, f: FormData) {
  const user = await requireUser('tenders');
  await go(id, 'bids', tradeId, async () => `${await tn.pastePrices(user, bidderId, String(f.get('text') ?? ''))} prices applied`);
}
export async function setAwardsAction(id: string, f: FormData) {
  const user = await requireUser('tenders');
  const awards = Object.fromEntries([...f.keys()].filter(k => k.startsWith('award_')).map(k => [k.slice(6), str(f, k) || null]));
  await go(id, 'compare', str(f, 'trade'), () => tn.setAwards(user, id, awards));
}
export async function saveMarkupsAction(id: string, f: FormData) {
  const user = await requireUser('tenders');
  const markups = Object.fromEntries([...f.keys()].filter(k => k.startsWith('mk_')).map(k => [k.slice(3), num(f, k)]));
  await go(id, 'client', '', () => tn.saveMarkups(user, id, markups));
}
