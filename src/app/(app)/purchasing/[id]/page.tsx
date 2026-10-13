import Link from 'next/link';
import { pendingSamples } from '@/lib/design';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { lineAmount } from '@/lib/ledger';
import { TZ, today } from '@/lib/dates';
import { type Attachment, listAttachments } from '@/lib/attachments';
import { canActOn, getPOInvoices, getPurchaseApprovals, getPurchaseLines, getPurchaseRequest, isProcurement, poFigures, stateOf } from '@/lib/purchasing';
import { compareQuotations, deliveryLabel, deliveryState, lateDays, listDeliveries, procurementPeople } from '@/lib/procurement';
import { approveAction, cancelAction, closeAction, priceAction, returnAction } from '../actions';
import { assignAction, chooseQuotationAction, deliveryAction, deliveryDateAction, quotationAction, removeQuotationAction } from '../procurement-actions';

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const r = await getPurchaseRequest(id);
  if (!r) notFound();
  const [lines, approvals, invoices, proc, mayAct, vendors, log, cmp, deliveries, buyers] = await Promise.all([
    getPurchaseLines(id), getPurchaseApprovals(id), getPOInvoices(id), isProcurement(user), canActOn(user, r),
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'vendor' order by name`,
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'purchase' and g.entity_id = ${id} order by g.at`,
    compareQuotations(id), listDeliveries(id), procurementPeople(),
  ]);
  const samplesOpen = r.project_id && !['approved', 'cancelled'].includes(r.status) ? await pendingSamples(r.project_id) : 0;
  const qfiles: Record<string, Attachment[]> = Object.fromEntries(await Promise.all(cmp.quotes.map(async q => [q.id, await listAttachments('quotation', q.id)] as const)));
  const dfiles: Record<string, Attachment[]> = Object.fromEntries(await Promise.all(deliveries.map(async d => [d.id, await listAttachments('delivery', d.id)] as const)));
  const fig = poFigures(lines);
  const vat = Math.round(fig.ordered * r.vat_rate) / 100;
  const pricing = r.status === 'procurement' && proc;
  const isPO = r.status === 'approved';
  const finance = hasRole(user, 'finance');
  const site = hasRole(user, 'finance', 'engineering', 'projects') || proc;
  const mayEdit = ['draft', 'rejected'].includes(r.status) && (r.created_by === user.id || proc);
  const mayCancel = !['cancelled'].includes(r.status) && (isPO ? (proc || finance) && invoices.every(i => i.status !== 'posted') : r.created_by === user.id || proc);
  const lastReturn = [...log].reverse().find(g => g.action === 'Returned for changes');
  const dstate = deliveryState(lines);
  const late = isPO ? lateDays(r, dstate) : 0;
  const chain = [
    { key: 'procurement', name: 'Procurement' }, { key: 'head', name: r.approver_label ?? 'Department head' }, { key: 'management', name: 'Management' },
  ].map(s => { const a = approvals.find(x => x.step === s.key); return { ...s, note: a ? `✓ ${a.who ?? ''} · ${a.at}` : r.status === s.key ? 'Waiting' + (s.key === 'head' && r.approver_name ? ` for ${r.approver_name}` : '') : '—', cur: r.status === s.key }; });
  const chosen = cmp.quotes.find(q => q.chosen);
  return (
    <>
      <div className="head">
        <div><h1>{isPO ? `${r.po_no} ` : ''}{r.no} <span className={'pill ' + (isPO ? 'posted' : r.status === 'rejected' || r.status === 'cancelled' ? 'rejected' : 'pending')}>{stateOf(r)}</span>
          {isPO && <span className={'pill ' + (dstate === 'full' ? 'posted' : late ? 'rejected' : dstate === 'part' ? 'pending' : '')} style={{ marginLeft: 6 }}>{deliveryLabel[dstate]}{late ? ` · ${late} day${late === 1 ? '' : 's'} late` : ''}</span>}</h1>
          <p dir="auto">{r.date} · for {r.cc}{r.vendor ? ` · ${r.vendor}` : ''}{r.needed_by ? ` · needed by ${r.needed_by}` : ''}{r.delivery_date ? ` · promised ${r.delivery_date}` : ''} · raised by {r.created_by_name ?? '—'}{r.buyer ? ` · buyer ${r.buyer}` : ''}{samplesOpen > 0 && <> · <Link href={`/samples?project=${r.project_id}`} className="pill pending">{samplesOpen} sample{samplesOpen === 1 ? '' : 's'} still with the client</Link></>}</p></div>
        <div className="row">
          {isPO && <a className="btn" href={`/print/po/${id}`} target="_blank">Purchase order PDF</a>}
          {isPO && !r.closed && finance && <Link className="btn pri" href={`/purchasing/${id}/receive`}>Receive and invoice</Link>}
          {mayEdit && <Link className="btn" href={`/purchasing/${id}/edit`}>Edit</Link>}
          {isPO && (proc || finance) && <form action={closeAction.bind(null, id, !r.closed)}><button className="btn">{r.closed ? 'Reopen PO' : 'Close PO'}</button></form>}
          {mayCancel && <form action={cancelAction.bind(null, id)}><button className="btn bad">Cancel</button></form>}
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {r.status === 'rejected' && lastReturn && <div className="msg bad">Returned by {lastReturn.who}: {lastReturn.note || 'no reason given'}</div>}
      {r.notes && <div className="card" dir="auto"><b>Notes:</b> {r.notes}</div>}

      <div className="steps">{chain.map(c => <div key={c.key} className={c.cur ? 'cur' : ''}><b>{c.name}</b><div className="muted" style={{ fontSize: 13 }}>{c.note}</div></div>)}</div>

      {proc && !['approved', 'cancelled'].includes(r.status) && (
        <form action={assignAction.bind(null, id)} className="card row" style={{ alignItems: 'end' }}>
          <label className="f" style={{ flex: 1, minWidth: 200 }}><span>Assigned to (the buyer)</span><select className="inp" name="buyer" defaultValue={r.buyer_id ?? ''}><option value="">Nobody yet</option>{buyers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <button className="btn">Assign</button>
        </form>)}

      {mayAct && r.status !== 'procurement' && (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <form action={returnAction.bind(null, id)} className="row" style={{ flex: 1 }}>
            <input className="inp" name="reason" placeholder="Reason, if returning for changes" style={{ flex: 1, minWidth: 180 }} />
            <button className="btn bad">Return</button></form>
          <form action={approveAction.bind(null, id)}><button className="btn pri">Approve as {r.status === 'head' ? r.approver_label ?? 'department head' : 'Management'}</button></form>
        </div>)}

      {pricing && (
        <form action={returnAction.bind(null, id)} className="card row">
          <input className="inp" name="reason" placeholder="Reason, if returning to the requester" style={{ flex: 1, minWidth: 180 }} /><button className="btn bad">Return</button>
        </form>)}
      {pricing ? (
        <form action={priceAction.bind(null, id)} className="card">
          <h2>Procurement: prices and vendor</h2>
          <p className="muted" style={{ fontSize: 13 }}>Type the prices yourself, or record the vendors&apos; quotations below and choose the best offer: it fills the prices and sends the request to the procurement head.</p>
          <div className="grid g3" style={{ marginBottom: 10 }}>
            <label className="f"><span>Vendor</span><select className="inp" name="vendor" defaultValue={r.vendor_id ?? ''}><option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
            <label className="f"><span>VAT</span><select className="inp" name="vat" defaultValue={String(r.vat_rate)}><option value="0">0%</option><option value="14">14%</option></select></label>
            <div className="f"><span>&nbsp;</span><Link href="/parties?tab=vendor">Add a vendor in Customers &amp; vendors</Link></div>
          </div>
          <div className="tw"><table>
            <thead><tr><th>Material</th><th className="hide-sm">GL code</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit price</th></tr></thead>
            <tbody>{lines.map(l => (
              <tr key={l.id}><td dir="auto">{l.name ?? '—'}{l.description ? <span className="muted"> · {l.description}</span> : null}</td><td className="mono hide-sm">{l.account}</td>
                <td className="num">{Number(l.qty)}</td><td>{l.unit}</td>
                <td className="num"><input className="inp mono" style={{ maxWidth: 130 }} name={'price_' + l.id} inputMode="decimal" defaultValue={l.price || ''} /></td></tr>))}</tbody>
          </table></div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" name="send" value="0">Save prices</button><button className="btn pri" name="send" value="1">Send for approval</button>
          </div>
        </form>
      ) : (
        <div className="tw" style={{ marginBottom: 14 }}><table>
          <thead><tr><th>Material</th><th className="hide-sm">GL code</th><th className="num">Qty</th><th>Unit</th><th className="num">Price</th><th className="num">Amount</th>
            {isPO && <><th className="num">Delivered</th><th className="num">Invoiced</th></>}</tr></thead>
          <tbody>{lines.map(l => (
            <tr key={l.id}><td dir="auto">{l.name ?? '—'}{l.description ? <span className="muted"> · {l.description}</span> : null}</td>
              <td className="hide-sm" dir="auto"><span className="mono">{l.account}</span>{l.account_name ? ` · ${l.account_name}` : ''}</td>
              <td className="num">{Number(l.qty)}</td><td>{l.unit}</td><td className="num">{l.price ? fmt(l.price) : '—'}</td><td className="num">{l.price ? fmt(lineAmount(l)) : '—'}</td>
              {isPO && <><td className="num">{Number(l.delivered_qty)}</td><td className="num">{Number(l.received_qty)}</td></>}</tr>))}</tbody>
          <tfoot>
            <tr><td colSpan={5}>Subtotal</td><td className="num">{fmt(fig.ordered)}</td>{isPO && <td colSpan={2}></td>}</tr>
            {vat ? <tr><td colSpan={5}>VAT {r.vat_rate}%</td><td className="num">{fmt(vat)}</td>{isPO && <td colSpan={2}></td>}</tr> : null}
          </tfoot>
        </table></div>)}

      {(cmp.quotes.length > 0 || pricing) && (
        <div className="card" id="quotations">
          <h2>Quotations{cmp.quotes.length ? ` · ${cmp.quotes.length}` : ''}</h2>
          {cmp.quotes.length > 0 && (
            <div className="tw"><table>
              <thead><tr><th>Material</th><th className="num">Qty</th>{cmp.quotes.map(q => <th key={q.id} className="num" dir="auto">{q.vendor}{q.chosen ? ' ✓' : ''}<div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{q.date}{q.delivery_days != null ? ` · ${q.delivery_days} d` : ''}{q.valid_until ? ` · to ${q.valid_until}` : ''}</div></th>)}</tr></thead>
              <tbody>{cmp.lines.map(l => <tr key={l.id}><td dir="auto">{l.name ?? l.description}</td><td className="num">{Number(l.qty)} {l.unit}</td>
                {cmp.quotes.map(q => <td key={q.id} className="num mono" style={cmp.lowest[l.id] === q.id ? { fontWeight: 700 } : undefined}>{q.lines[l.id] ? fmt(q.lines[l.id]) : <span className="muted">—</span>}</td>)}</tr>)}
                <tr className="tot"><td colSpan={2}><b>Total before VAT</b></td>{cmp.quotes.map(q => <td key={q.id} className="num mono"><b style={cmp.best === q.id ? { color: 'var(--good, #137a3a)' } : undefined}>{fmt(q.total)}</b>{!q.complete ? <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>not every line</div> : cmp.best === q.id ? <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>lowest</div> : null}</td>)}</tr>
                <tr><td colSpan={2} className="muted" style={{ fontSize: 12 }}>VAT · notes · file</td>{cmp.quotes.map(q => <td key={q.id} className="num" style={{ fontSize: 12 }} dir="auto">{q.vat_rate} %{q.ref ? ` · ${q.ref}` : ''}{q.notes ? ` · ${q.notes}` : ''}{(qfiles[q.id] ?? []).map(a => <div key={a.id}><a href={`/files/${a.id}`} target="_blank" rel="noopener">{a.file_name}</a></div>)}</td>)}</tr>
                {pricing && <tr><td colSpan={2}></td>{cmp.quotes.map(q => <td key={q.id} className="num"><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                  <form action={chooseQuotationAction.bind(null, id, q.id)}><button className="btn sm pri" disabled={!q.complete}>Choose this offer</button></form>
                  <form action={removeQuotationAction.bind(null, id, q.id)}><button className="btn sm">Remove</button></form></div></td>)}</tr>}
              </tbody>
            </table></div>)}
          {chosen && !pricing && <p className="muted" style={{ fontSize: 13 }}>Chosen: {chosen.vendor} at {fmt(chosen.total)} before VAT{cmp.quotes.length > 1 ? ` against ${cmp.quotes.length - 1} other offer${cmp.quotes.length === 2 ? '' : 's'}` : ''}.</p>}
          {pricing && (
            <form action={quotationAction.bind(null, id)} className="card" style={{ marginTop: 10, marginBottom: 0 }}>
              <h3 style={{ marginTop: 0 }}>Add a quotation</h3>
              <div className="grid g3">
                <label className="f"><span>Vendor</span><select className="inp" name="vendor" required defaultValue=""><option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
                <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} required /></label>
                <label className="f"><span>Quotation no.</span><input className="inp" name="ref" /></label>
                <label className="f"><span>Valid until</span><input className="inp" type="date" name="valid_until" /></label>
                <label className="f"><span>Delivery (days)</span><input className="inp" name="delivery_days" inputMode="numeric" /></label>
                <label className="f"><span>VAT</span><select className="inp" name="vat_rate" defaultValue="14"><option value="0">0%</option><option value="14">14%</option></select></label>
              </div>
              <div className="tw" style={{ marginTop: 8 }}><table>
                <thead><tr><th>Material</th><th className="num">Qty</th><th className="num">Unit price</th></tr></thead>
                <tbody>{lines.map(l => <tr key={l.id}><td dir="auto">{l.name ?? l.description}</td><td className="num">{Number(l.qty)} {l.unit}</td><td className="num"><input className="inp mono" style={{ maxWidth: 130 }} name={'qp_' + l.id} inputMode="decimal" /></td></tr>)}</tbody>
              </table></div>
              <div className="grid g2" style={{ marginTop: 8 }}>
                <label className="f"><span>Notes</span><input className="inp" name="notes" dir="auto" /></label>
                <label className="f"><span>The quotation (photo or PDF, optional)</span><input className="inp" type="file" name="file" accept="image/*,application/pdf" /></label>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Add quotation</button></div>
            </form>)}
        </div>)}

      {isPO && (
        <div className="card" id="deliveries">
          <h2>Deliveries</h2>
          <div className="tiles">
            <div className="tile"><div className="k">Promised</div><div className="v mono" style={{ fontSize: 16 }}>{r.delivery_date ?? r.needed_by ?? '—'}</div></div>
            <div className="tile"><div className="k">Delivered</div><div className="v mono">{fmt(r.delivered)}</div></div>
            <div className="tile"><div className="k">Still to come</div><div className="v mono">{fmt(Math.max(fig.ordered - r.delivered, 0))}</div></div>
          </div>
          {deliveries.length === 0 ? <p className="muted">Nothing delivered yet.</p> : (
            <div className="tw"><table>
              <thead><tr><th>Date</th><th>Delivery note</th><th>What came</th><th className="hide-sm">Received by</th></tr></thead>
              <tbody>{deliveries.map(d => <tr key={d.id}><td className="mono">{d.date}</td><td>{d.ref || '—'}{d.notes ? <span className="muted"> · {d.notes}</span> : null}{(dfiles[d.id] ?? []).map(a => <div key={a.id} style={{ fontSize: 12 }}><a href={`/files/${a.id}`} target="_blank" rel="noopener">{a.file_name}</a></div>)}</td><td dir="auto" style={{ fontSize: 13 }}>{d.lines.map(l => `${l.name}: ${l.qty}`).join(' · ')}</td><td className="hide-sm">{d.who ?? ''}</td></tr>)}</tbody>
            </table></div>)}
          {!r.closed && dstate !== 'full' && site && (
            <form action={deliveryAction.bind(null, id)} className="card" style={{ marginTop: 10, marginBottom: 0 }}>
              <h3 style={{ marginTop: 0 }}>Record a delivery</h3>
              <div className="grid g3">
                <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} required /></label>
                <label className="f"><span>Delivery note no.</span><input className="inp" name="ref" /></label>
                <label className="f"><span>Delivery note (photo, optional)</span><input className="inp" type="file" name="file" accept="image/*,application/pdf" capture="environment" /></label>
              </div>
              <div className="tw" style={{ marginTop: 8 }}><table>
                <thead><tr><th>Material</th><th className="num">Ordered</th><th className="num">Delivered so far</th><th className="num">Delivered now</th></tr></thead>
                <tbody>{lines.map(l => { const left = Math.round((Number(l.qty) - Number(l.delivered_qty)) * 1000) / 1000; return (
                  <tr key={l.id}><td dir="auto">{l.name ?? l.description}</td><td className="num">{Number(l.qty)} {l.unit}</td><td className="num">{Number(l.delivered_qty)}</td>
                    <td className="num">{left > 0 ? <input className="inp mono" style={{ maxWidth: 110 }} name={'dq_' + l.id} inputMode="decimal" placeholder={String(left)} /> : <span className="muted">done</span>}</td></tr>); })}</tbody>
              </table></div>
              <label className="f" style={{ marginTop: 8 }}><span>Notes</span><input className="inp" name="notes" dir="auto" placeholder="Damaged items, short delivery…" /></label>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Record delivery</button></div>
            </form>)}
          {proc && !r.closed && (
            <form action={deliveryDateAction.bind(null, id)} className="row" style={{ marginTop: 10, alignItems: 'end' }}>
              <label className="f"><span>Promised delivery date</span><input className="inp" type="date" name="date" defaultValue={r.delivery_date ?? ''} /></label><button className="btn">Save date</button>
            </form>)}
          {late > 0 && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>A &quot;Late delivery&quot; task is open for the buyer until the goods arrive.</p>}
        </div>)}

      {isPO && (
        <div className="card">
          <h2>Received on this PO</h2>
          <div className="tiles">
            <div className="tile"><div className="k">Ordered</div><div className="v mono">{fmt(fig.ordered)}</div></div>
            <div className="tile"><div className="k">Received and invoiced · {fig.pct}%</div><div className="v mono">{fmt(fig.received)}</div></div>
            <div className="tile"><div className="k">Remaining</div><div className="v mono">{fmt(fig.remaining)}</div></div>
          </div>
          {invoices.length === 0 ? <p className="muted">No invoice received yet.</p> : (
            <div className="tw"><table>
              <thead><tr><th>Invoice</th><th>Date</th><th>Vendor&apos;s no.</th><th className="num">Before VAT</th><th className="num">Net to vendor</th><th className="num">Paid</th></tr></thead>
              <tbody>{invoices.map(i => <tr key={i.id}><td className="mono"><Link href={`/purchasing/invoices/${i.id}`}>{i.no}</Link></td><td className="mono">{i.date}</td><td>{i.ref}</td>
                <td className="num">{fmt(i.subtotal)}</td><td className="num">{fmt(i.net)}</td><td className="num">{fmt(i.paid)}</td></tr>)}</tbody>
            </table></div>)}
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Amounts before VAT. Each invoice posts to the items&apos; GL codes and to the vendor&apos;s account; pay it from a payment request that ticks it.</p>
        </div>)}

      <div className="card"><h2>History</h2>
        <div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? '—'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
