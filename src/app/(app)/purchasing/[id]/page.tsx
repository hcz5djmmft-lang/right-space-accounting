import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { lineAmount } from '@/lib/ledger';
import { TZ } from '@/lib/dates';
import { canActOn, getPOInvoices, getPurchaseApprovals, getPurchaseLines, getPurchaseRequest, isProcurement, poFigures, stateOf } from '@/lib/purchasing';
import { approveAction, cancelAction, closeAction, priceAction, returnAction } from '../actions';

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const r = await getPurchaseRequest(id);
  if (!r) notFound();
  const [lines, approvals, invoices, proc, mayAct, vendors, log] = await Promise.all([
    getPurchaseLines(id), getPurchaseApprovals(id), getPOInvoices(id), isProcurement(user), canActOn(user, r),
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'vendor' order by name`,
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'purchase' and g.entity_id = ${id} order by g.at`,
  ]);
  const fig = poFigures(lines);
  const vat = Math.round(fig.ordered * r.vat_rate) / 100;
  const pricing = r.status === 'procurement' && proc;
  const isPO = r.status === 'approved';
  const finance = hasRole(user, 'finance');
  const mayEdit = ['draft', 'rejected'].includes(r.status) && (r.created_by === user.id || proc);
  const mayCancel = !['cancelled'].includes(r.status) && (isPO ? (proc || finance) && invoices.every(i => i.status !== 'posted') : r.created_by === user.id || proc);
  const lastReturn = [...log].reverse().find(g => g.action === 'Returned for changes');
  const chain = [
    { key: 'procurement', name: 'Procurement' }, { key: 'head', name: r.approver_label ?? 'Department head' }, { key: 'management', name: 'Management' },
  ].map(s => { const a = approvals.find(x => x.step === s.key); return { ...s, note: a ? `✓ ${a.who ?? ''} · ${a.at}` : r.status === s.key ? 'Waiting' + (s.key === 'head' && r.approver_name ? ` for ${r.approver_name}` : '') : '—', cur: r.status === s.key }; });
  return (
    <>
      <div className="head">
        <div><h1>{isPO ? `${r.po_no} ` : ''}{r.no} <span className={'pill ' + (isPO ? 'posted' : r.status === 'rejected' || r.status === 'cancelled' ? 'rejected' : 'pending')}>{stateOf(r)}</span></h1>
          <p dir="auto">{r.date} · for {r.cc}{r.vendor ? ` · ${r.vendor}` : ''}{r.needed_by ? ` · needed by ${r.needed_by}` : ''} · raised by {r.created_by_name ?? '—'}</p></div>
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
            {isPO && <><th className="num">Received</th><th className="num">Remaining</th></>}</tr></thead>
          <tbody>{lines.map(l => (
            <tr key={l.id}><td dir="auto">{l.name ?? '—'}{l.description ? <span className="muted"> · {l.description}</span> : null}</td>
              <td className="hide-sm" dir="auto"><span className="mono">{l.account}</span>{l.account_name ? ` · ${l.account_name}` : ''}</td>
              <td className="num">{Number(l.qty)}</td><td>{l.unit}</td><td className="num">{l.price ? fmt(l.price) : '—'}</td><td className="num">{l.price ? fmt(lineAmount(l)) : '—'}</td>
              {isPO && <><td className="num">{Number(l.received_qty)}</td><td className="num">{Math.round((Number(l.qty) - Number(l.received_qty)) * 1000) / 1000}</td></>}</tr>))}</tbody>
          <tfoot>
            <tr><td colSpan={5}>Subtotal</td><td className="num">{fmt(fig.ordered)}</td>{isPO && <td colSpan={2}></td>}</tr>
            {vat ? <tr><td colSpan={5}>VAT {r.vat_rate}%</td><td className="num">{fmt(vat)}</td>{isPO && <td colSpan={2}></td>}</tr> : null}
          </tfoot>
        </table></div>)}

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
