import { Fragment } from 'react';
import Link from 'next/link';
import { fmt } from '@/lib/money';
import type { TenderRow } from '@/lib/tenders';
import { bidTotals, CURRENCIES, STATUSES, STD_TRADES, tMarkup, tradeSel, uRate, type Tender, type Totals, type Trade } from '@/lib/tender-calc';
import {
  addBidderAction, addTradeAction, deleteBidderAction, deleteTenderAction, deleteTradeAction, pasteItemsAction, pastePricesAction, saveBidderAction,
  saveDetailsAction, saveItemsAction, saveMarkupsAction, savePricesAction, saveTradeAction, setAwardsAction, tenderToProjectAction,
} from '@/app/(app)/tenders/actions';

type T = TenderRow & Tender;
type People = { id: string; name: string }[];
const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const short = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : fmt(v));

function TradeList({ t, cur, step }: { t: T; cur?: Trade; step: string }) {
  return (
    <div className="card" style={{ padding: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '70vh', overflow: 'auto' }}>
        {t.trades.map(tr => (
          <Link key={tr.id} href={`/tenders/${t.id}?step=${step}&trade=${tr.id}`} className="btn" style={{ justifyContent: 'space-between', ...(tr.id === cur?.id ? { borderColor: 'var(--gold, #e5b35a)', background: 'var(--bg)' } : {}) }}>
            <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr.name}</span><span className="muted mono" style={{ fontSize: 11 }}>{step === 'bids' ? `${tr.bidders.length} bid` : tr.items.length}</span></Link>))}
      </div>
      {step === 'boq' && (
        <form action={addTradeAction.bind(null, t.id)} style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <select className="inp" name="std_name"><option value="">— standard trade —</option>{STD_TRADES.filter(x => !t.trades.some(tr => tr.name.toLowerCase() === x.toLowerCase())).map(x => <option key={x}>{x}</option>)}</select>
          <input className="inp" name="new_name" dir="auto" placeholder="or a new trade name" />
          <input className="inp" name="division" dir="auto" placeholder="Division (optional)" />
          <button className="btn sm">Add trade</button>
        </form>)}
    </div>
  );
}

export function DetailsStep({ t, cats, customers }: { t: T; cats: Record<string, string[]>; customers: People }) {
  const pick = (k: 'type' | 'service' | 'unit', label: string) => (
    <label className="f"><span>{label}</span><select className="inp" name={k} defaultValue={t[k] ?? ''}><option value="">—</option>{(cats[k] ?? []).map(x => <option key={x}>{x}</option>)}</select></label>);
  return (
    <form action={saveDetailsAction.bind(null, t.id)} className="card">
      <div className="grid g3">
        <label className="f"><span>Tender / project name</span><input className="inp" name="name" dir="auto" defaultValue={t.name} required /></label>
        <label className="f"><span>Client</span><select className="inp" name="client_id" defaultValue={t.client_id ?? ''}><option value="">—</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="f"><span>Client name (if not a customer yet)</span><input className="inp" name="client_name" dir="auto" defaultValue={t.client_name} /></label>
        <label className="f"><span>Location</span><input className="inp" name="location" dir="auto" defaultValue={t.location} /></label>
        <label className="f"><span>Submission date</span><input className="inp" type="date" name="due_date" defaultValue={t.due_date ?? ''} /></label>
        <label className="f"><span>Status</span><select className="inp" name="status" defaultValue={t.status}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
        {pick('type', 'Project type')}{pick('service', 'Service')}{pick('unit', 'Unit type')}
      </div>
      <h2 style={{ marginTop: 16 }}>Currency rates to EGP <small className="muted">used when a bidder prices in another currency</small></h2>
      <div className="grid g4">{CURRENCIES.filter(c => c !== 'EGP').map(c => <label key={c} className="f"><span>1 {c} =</span><input className="inp mono" name={'rate_' + c} inputMode="decimal" defaultValue={n(t.rates[c])} placeholder="EGP" /></label>)}</div>
      <h2 style={{ marginTop: 16 }}>Pricing</h2>
      <div className="grid g4">
        <label className="f"><span>Default markup %</span><input className="inp mono" name="markup" inputMode="decimal" defaultValue={n(t.markup)} /></label>
        <label className="f"><span>VAT % on client price</span><input className="inp mono" name="vat" inputMode="decimal" defaultValue={n(t.vat)} /></label>
      </div>
      <label className="f" style={{ marginTop: 12 }}><span>Notes / scope</span><textarea className="inp" name="notes" dir="auto" rows={3} defaultValue={t.notes} /></label>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <div className="row">
          {t.status === 'Won' && !t.project_id && <button className="btn" formAction={tenderToProjectAction.bind(null, t.id)}>Create cost center from this tender</button>}
          {t.project_id && <span className="muted">Cost center: <Link href={`/cost-centers/${t.project_id}`}>{t.project_code}</Link></span>}
          {!t.project_id && <button className="btn bad" formAction={deleteTenderAction.bind(null, t.id)}>Delete tender</button>}
        </div>
        <button className="btn pri">Save details</button>
      </div>
    </form>
  );
}

export function BoqStep({ t, cur }: { t: T; cur?: Trade; showMisc?: boolean }) {
  const blank = ['n1', 'n2', 'n3'];
  return (
    <div className="tsplit">
      <TradeList t={t} cur={cur} step="boq" />
      <div style={{ minWidth: 0 }}>
        {!cur ? <div className="empty card">No trades yet. Use Add trade to start the BOQ.</div> : (
          <>
            <form action={saveTradeAction.bind(null, t.id, cur.id)} className="card row" style={{ alignItems: 'end' }}>
              <label className="f" style={{ width: 90 }}><span>No.</span><input className="inp mono" name="trade_no" defaultValue={cur.trade_no ?? ''} /></label>
              <label className="f" style={{ flex: 1, minWidth: 160 }}><span>Trade</span><input className="inp" name="name" dir="auto" defaultValue={cur.name} /></label>
              <label className="f" style={{ flex: 2, minWidth: 200 }}><span>Division</span><input className="inp" name="division" dir="auto" defaultValue={cur.division} /></label>
              <button className="btn sm">Save trade</button>
              <button className="btn sm bad" formAction={deleteTradeAction.bind(null, t.id, cur.id)}>Delete trade</button>
            </form>
            <form action={saveItemsAction.bind(null, t.id, cur.id)}>
              <div className="tw"><table>
                <thead><tr><th>Item no.</th><th>Description</th><th>Unit</th><th className="num">BOQ qty</th><th className="num">Actual qty</th></tr></thead>
                <tbody>
                  {cur.items.map(it => (
                    <tr key={it.id}><td style={{ width: 90 }}><input type="hidden" name={'row_' + it.id} value="1" /><input type="hidden" name={'id_' + it.id} value={it.id} /><input type="hidden" name={'code_' + it.id} value={it.code ?? ''} /><input className="inp mono" name={'no_' + it.id} defaultValue={it.no} /></td>
                      <td style={{ minWidth: 320 }}><input className="inp" name={'desc_' + it.id} dir="auto" defaultValue={it.description} /></td>
                      <td style={{ width: 90 }}><input className="inp" name={'unit_' + it.id} dir="auto" defaultValue={it.unit} /></td>
                      <td style={{ width: 120 }}><input className="inp mono" name={'qty_' + it.id} inputMode="decimal" defaultValue={n(it.qty)} /></td>
                      <td style={{ width: 120 }}><input className="inp mono" name={'act_' + it.id} inputMode="decimal" defaultValue={n(it.act_qty)} /></td></tr>))}
                  {blank.map(k => (
                    <tr key={k}><td><input type="hidden" name={'row_' + k} value="1" /><input className="inp mono" name={'no_' + k} placeholder="new" /></td>
                      <td><input className="inp" name={'desc_' + k} dir="auto" placeholder="New item" /></td><td><input className="inp" name={'unit_' + k} /></td>
                      <td><input className="inp mono" name={'qty_' + k} inputMode="decimal" /></td><td><input className="inp mono" name={'act_' + k} inputMode="decimal" /></td></tr>))}
                </tbody></table></div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}><span className="muted" style={{ fontSize: 12 }}>{cur.items.length} items · clear a description to remove its row</span><button className="btn pri">Save items</button></div>
            </form>
            <details className="card" style={{ marginTop: 14 }}><summary>Paste from Excel</summary>
              <form action={pasteItemsAction.bind(null, t.id, cur.id)} style={{ marginTop: 8 }}>
                <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>Copy rows from Excel with these columns in order: Item no. · Description · Unit · BOQ qty · Actual qty (optional). A header row is skipped.</p>
                <textarea className="inp mono" name="text" rows={8} placeholder={'1\tPainting walls\tm2\t1250'} />
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Add items</button></div>
              </form></details>
          </>)}
      </div>
    </div>
  );
}

export function BidsStep({ t, cur, showMisc, vendors }: { t: T; cur?: Trade; showMisc: boolean; vendors: People }) {
  if (!cur) return <div className="empty card">Add the BOQ first (step 2).</div>;
  const bt = bidTotals(t, cur);
  const base = `/tenders/${t.id}?step=bids&trade=${cur.id}`;
  return (
    <div className="tsplit">
      <TradeList t={t} cur={cur} step="bids" />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }} dir="auto">{cur.name} <span className="muted" style={{ fontWeight: 400 }}>· {cur.items.length} items</span></h2>
          <div className="row"><Link className="btn sm" href={showMisc ? base : base + '&misc=1'}>{showMisc ? 'Hide' : 'Show'} logistics &amp; misc</Link>
            <form action={addBidderAction.bind(null, t.id, cur.id)}><button className="btn sm pri">Add bidder</button></form></div>
        </div>
        {cur.bidders.length === 0 && <div className="msg good" style={{ marginBottom: 10 }}>Add the subcontractors or suppliers who priced this trade.</div>}
        <div className="row" style={{ alignItems: 'stretch', marginBottom: 10, flexWrap: 'wrap' }}>
          {cur.bidders.map(b => (
            <form key={b.id} action={saveBidderAction.bind(null, t.id, cur.id, b.id)} className="card" style={{ padding: 10, minWidth: 230, flex: 1, margin: 0 }}>
              <div className="row"><input className="inp" name="name" dir="auto" defaultValue={b.name} placeholder="Bidder name" style={{ flex: 1, fontWeight: 600 }} /><button className="btn sm" formAction={deleteBidderAction.bind(null, t.id, cur.id, b.id)} title="Remove bidder">✕</button></div>
              <div className="grid g2" style={{ marginTop: 6, gap: 6 }}>
                <label className="f"><span>Vendor record</span><select className="inp" name="party_id" defaultValue={b.party_id ?? ''}><option value="">—</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
                <label className="f"><span>Currency</span><select className="inp" name="currency" defaultValue={b.currency}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
                <label className="f"><span>Wastage %</span><input className="inp mono" name="wastage" inputMode="decimal" defaultValue={n(b.wastage)} /></label>
                <label className="f"><span>Discount %</span><input className="inp mono" name="discount" inputMode="decimal" defaultValue={n(b.discount)} /></label>
                <label className="f"><span>Tax %</span><input className="inp mono" name="tax" inputMode="decimal" defaultValue={n(b.tax)} /></label>
                <div style={{ alignSelf: 'end' }}><button className="btn sm" style={{ width: '100%' }}>Save bidder</button></div>
              </div>
              <details style={{ marginTop: 6 }}><summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Paste prices</summary>
                <textarea className="inp mono" name="text" rows={5} form={'pp_' + b.id} placeholder={'100\n200\n…'} style={{ marginTop: 6 }} />
                <button className="btn sm" form={'pp_' + b.id} style={{ marginTop: 6 }}>Apply prices</button></details>
            </form>))}
          {cur.bidders.map(b => <form key={'pp' + b.id} id={'pp_' + b.id} action={pastePricesAction.bind(null, t.id, cur.id, b.id)} />)}
        </div>
        {cur.items.length > 0 && cur.bidders.length > 0 && (
          <form action={savePricesAction.bind(null, t.id, cur.id)}>
            <input type="hidden" name="misc" value={showMisc ? '1' : ''} />
            <div className="tw" style={{ maxHeight: '62vh', overflow: 'auto' }}><table>
              <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="num">Qty</th>{cur.bidders.map(b => <th key={b.id} className="num" colSpan={showMisc ? 4 : 2} dir="auto">{b.name || 'Bidder'} <span className="muted">{b.currency}</span></th>)}</tr>
                {showMisc && <tr><th colSpan={4}></th>{cur.bidders.map(b => <Fragment key={b.id}><th className="num">Offer</th><th className="num">Logistics</th><th className="num">Misc</th><th className="num">Unit rate</th></Fragment>)}</tr>}</thead>
              <tbody>{cur.items.map(it => (
                <tr key={it.id}><td className="mono">{it.no}</td><td style={{ minWidth: 220, maxWidth: 360 }}><div dir="auto" className="clamp" title={it.description}>{it.description}</div></td><td dir="auto">{it.unit}</td><td className="num">{it.qty !== null ? fmt(it.qty) : ''}</td>
                  {cur.bidders.map(b => { const p = cur.prices[b.id]?.[it.id]; const u = uRate(t, cur, b, it); return (
                    <Fragment key={b.id}>
                      <td className="num" style={{ minWidth: 100 }}><input className="inp mono" name={`p_${b.id}_${it.id}_offer`} inputMode="decimal" defaultValue={n(p?.offer)} /></td>
                      {showMisc && <><td className="num" style={{ minWidth: 90 }}><input className="inp mono" name={`p_${b.id}_${it.id}_logistics`} inputMode="decimal" defaultValue={n(p?.logistics)} /></td><td className="num" style={{ minWidth: 90 }}><input className="inp mono" name={`p_${b.id}_${it.id}_misc`} inputMode="decimal" defaultValue={n(p?.misc)} /></td></>}
                      {!showMisc && p && <><input type="hidden" name={`p_${b.id}_${it.id}_logistics`} value={n(p.logistics)} /><input type="hidden" name={`p_${b.id}_${it.id}_misc`} value={n(p.misc)} /></>}
                      <td className="num muted">{u === null ? '—' : fmt(u)}</td>
                    </Fragment>); })}</tr>))}</tbody>
              <tfoot>{([['tot', 'Total (BOQ qty)'], ['act', 'Total (actual qty)'], ['fin', 'Incl. tax'], ['priced', 'Priced items']] as const).map(([k, l]) => (
                <tr key={k}><td colSpan={4}>{l}</td>{bt.map(x => <td key={x.b.id} className="num" colSpan={showMisc ? 4 : 2}>{k === 'priced' ? `${x.priced} / ${cur.items.length}` : fmt(x[k])}</td>)}</tr>))}</tfoot>
            </table></div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}><span className="muted" style={{ fontSize: 12 }}>Unit rate = offer × exchange rate × (1 + wastage %) × (1 − discount %) + logistics + misc.</span><button className="btn pri">Save prices</button></div>
          </form>)}
      </div>
    </div>
  );
}

export function CompareStep({ t, cur }: { t: T; cur?: Trade; showMisc?: boolean }) {
  if (!t.trades.length) return <div className="empty card">Nothing to compare yet. Add the BOQ and bidders first.</div>;
  const sum = t.trades.map(x => { const bt = bidTotals(t, x).filter(y => y.priced).sort((a, b) => a.after - b.after); const sel = tradeSel(t, x); const low = bt.length ? Math.min(...bt.map(y => y.after)) : 0; return { x, bt, sel, low }; });
  const detail = cur && cur.bidders.length && cur.items.length ? { bt: bidTotals(t, cur), sel: tradeSel(t, cur), low: Math.min(...bidTotals(t, cur).filter(y => y.priced).map(y => y.after)) } : null;
  return (
    <>
      <form action={setAwardsAction.bind(null, t.id)} className="card">
        <input type="hidden" name="trade" value={cur?.id ?? ''} />
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>All trades <small className="muted">award one bidder per trade</small></h2><button className="btn pri">Save awards</button></div>
        <div className="tw" style={{ marginTop: 10 }}><table>
          <thead><tr><th>Trade</th><th className="hide-sm">Offers</th><th>Award to</th><th className="num">Awarded total</th><th className="num hide-sm">Lowest</th><th className="num hide-sm">Over lowest</th></tr></thead>
          <tbody>{sum.map(({ x, bt, sel, low }) => (
            <tr key={x.id}><td><Link href={`/tenders/${t.id}?step=compare&trade=${x.id}`} dir="auto">{x.name}</Link></td>
              <td className="hide-sm" style={{ fontSize: 12 }}>{bt.length ? bt.map(y => <span key={y.b.id}><span dir="auto">{y.b.name || 'Bidder'}</span> <span className="mono">{short(y.after)}</span> · </span>) : <span className="muted">no offers</span>}</td>
              <td style={{ minWidth: 170 }}>{bt.length > 0 && <select className="inp" name={'award_' + x.id} defaultValue={x.selected_bidder ?? ''}><option value="">Lowest (auto)</option>{bt.map(y => <option key={y.b.id} value={y.b.id}>{y.b.name || 'Bidder'}</option>)}</select>}</td>
              <td className="num">{sel ? fmt(sel.after) : ''}{sel?.auto && <span className="muted" style={{ fontSize: 11 }}> auto</span>}</td>
              <td className="num hide-sm">{low ? fmt(low) : ''}</td>
              <td className="num hide-sm" style={sel && low && sel.after > low ? { color: 'var(--warn)' } : undefined}>{sel && low ? ((sel.after / low - 1) * 100).toFixed(1) + '%' : ''}</td></tr>))}
          </tbody>
          <tfoot><tr><td colSpan={3}>Total awarded</td><td className="num">{fmt(sum.reduce((s, y) => s + (y.sel?.after ?? 0), 0))}</td><td className="num hide-sm">{fmt(sum.reduce((s, y) => s + y.low, 0))}</td><td className="hide-sm"></td></tr></tfoot>
        </table></div>
      </form>
      {cur && detail && (
        <div className="card"><h2 dir="auto">{cur.name} <small className="muted">unit rates per bidder · lowest in green, highest in red</small></h2>
          <div className="tw" style={{ maxHeight: '60vh', overflow: 'auto' }}><table>
            <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="num">Qty</th>{cur.bidders.map(b => <th key={b.id} className="num" dir="auto">{b.name || 'Bidder'}{detail.sel?.b.id === b.id ? ' ★' : ''}</th>)}<th className="num">Min</th><th className="num">Max</th><th className="num">Selected rate</th></tr></thead>
            <tbody>{cur.items.map(it => {
              const us = cur.bidders.map(b => uRate(t, cur, b, it)); const v = us.filter((u): u is number => u !== null);
              const mn = v.length ? Math.min(...v) : null, mx = v.length ? Math.max(...v) : null; const sr = detail.sel ? uRate(t, cur, detail.sel.b, it) : null;
              return (<tr key={it.id}><td className="mono">{it.no}</td><td style={{ minWidth: 220, maxWidth: 340 }}><div dir="auto" className="clamp" title={it.description}>{it.description}</div></td><td dir="auto">{it.unit}</td><td className="num">{it.qty !== null ? fmt(it.qty) : ''}</td>
                {us.map((u, i) => <td key={i} className="num" style={u !== null && v.length > 1 && u === mn ? { color: 'var(--good)', fontWeight: 600 } : u !== null && v.length > 1 && u === mx ? { color: 'var(--bad)' } : undefined}>{u === null ? '—' : fmt(u)}</td>)}
                <td className="num">{mn === null ? '' : fmt(mn)}</td><td className="num">{mx === null ? '' : fmt(mx)}</td><td className="num"><b>{sr === null ? '' : fmt(sr)}</b></td></tr>); })}</tbody>
            <tfoot>
              {([['tot', 'Total (BOQ qty)'], ['fin', 'Incl. tax']] as const).map(([k, l]) => <tr key={k}><td colSpan={4}>{l}</td>{detail.bt.map(x => <td key={x.b.id} className="num">{x.priced ? fmt(x[k]) : '—'}</td>)}<td colSpan={3}></td></tr>)}
              <tr><td colSpan={4}>Over lowest</td>{detail.bt.map(x => <td key={x.b.id} className="num">{x.priced && detail.low ? ((x.after / detail.low - 1) * 100).toFixed(1) + '%' : ''}</td>)}<td colSpan={3}></td></tr>
            </tfoot>
          </table></div></div>)}
    </>
  );
}

export function ClientStep({ t, T }: { t: T; T: Totals; cur?: Trade; showMisc?: boolean }) {
  if (!t.trades.length) return <div className="empty card">Nothing to price yet. Add the BOQ, bidders and awards first.</div>;
  return (
    <form action={saveMarkupsAction.bind(null, t.id)} className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Client price by trade</h2>
        <div className="row"><a className="btn sm" href={`/tenders/${t.id}/export?kind=client`}>Client BOQ (Excel CSV)</a><a className="btn sm" href={`/tenders/${t.id}/export?kind=compare`}>Comparison (Excel CSV)</a><button className="btn sm pri">Save markups</button></div></div>
      <div className="tw" style={{ marginTop: 10 }}><table>
        <thead><tr><th>Trade</th><th className="hide-sm">Awarded to</th><th className="num">Cost</th><th className="num" style={{ width: 110 }}>Markup %</th><th className="num">Client price</th><th className="num hide-sm">Margin</th></tr></thead>
        <tbody>{t.trades.map(tr => { const sel = tradeSel(t, tr); const mk = tMarkup(t, tr); const cost = sel ? sel.after : 0; const cl = Math.round(cost * (1 + mk / 100) * 100) / 100; return (
          <tr key={tr.id}><td dir="auto">{tr.name}</td><td className="hide-sm" dir="auto">{sel ? <>{sel.b.name || 'Bidder'}{sel.auto && <span className="muted" style={{ fontSize: 11 }}> auto</span>}</> : <span className="muted">no offers</span>}</td>
            <td className="num">{fmt(cost)}</td><td className="num"><input className="inp mono" name={'mk_' + tr.id} inputMode="decimal" defaultValue={n(tr.markup)} placeholder={String(t.markup ?? 0)} /></td>
            <td className="num">{fmt(cl)}</td><td className="num hide-sm">{cl ? Math.round((cl - cost) / cl * 100) + '%' : ''}</td></tr>); })}
          <tr><td colSpan={2} style={{ fontWeight: 600 }}>Total before VAT</td><td className="num" style={{ fontWeight: 600 }}>{fmt(T.cost)}</td><td></td><td className="num" style={{ fontWeight: 600 }}>{fmt(T.client)}</td><td className="num hide-sm">{T.client ? Math.round((T.client - T.cost) / T.client * 100) + '%' : ''}</td></tr>
          <tr><td colSpan={4}>VAT {t.vat}%</td><td className="num">{fmt(T.vat)}</td><td className="hide-sm"></td></tr>
          <tr><td colSpan={4} style={{ fontWeight: 600 }}>Tender total incl. VAT</td><td className="num" style={{ fontWeight: 600 }}>{fmt(T.client + T.vat)}</td><td className="hide-sm"></td></tr>
        </tbody></table></div>
      <p className="muted" style={{ fontSize: 12 }}>An empty markup uses the default ({t.markup ?? 0}%) from step 1. Client unit rate = awarded unit rate × (1 + markup %).</p>
    </form>
  );
}
