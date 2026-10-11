import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { getPurchaseLines, getPurchaseRequest, poFigures } from '@/lib/purchasing';
import { receiveAction } from '../../actions';

/** Receive and invoice (Finance): what the vendor delivered on this PO, at the invoice's prices, with the invoice attached. */
export default async function Receive({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireUser('finance');
  const { id } = await params;
  const { error } = await searchParams;
  const r = await getPurchaseRequest(id);
  if (!r) notFound();
  if (r.status !== 'approved' || r.closed) redirect('/purchasing/' + id);
  const lines = await getPurchaseLines(id);
  const fig = poFigures(lines);
  const left = (l: (typeof lines)[number]) => Math.max(0, Math.round((Number(l.qty) - Number(l.received_qty)) * 1000) / 1000);
  return (
    <>
      <div className="head"><div><h1>Receive and invoice · {r.po_no}</h1><p dir="auto">{r.vendor} · for {r.cc} · ordered {fmt(fig.ordered)}, received so far {fmt(fig.received)}, remaining {fmt(fig.remaining)} (before VAT)</p></div>
        <Link className="btn" href={`/purchasing/${id}`}>Back to the PO</Link></div>
      {error && <div className="msg bad">{error}</div>}
      <form action={receiveAction.bind(null, id)} className="card">
        <div className="grid g4" style={{ marginBottom: 12 }}>
          <label className="f"><span>Invoice date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
          <label className="f"><span>Vendor&apos;s invoice no.</span><input className="inp" name="ref" required /></label>
          <label className="f"><span>VAT</span><select className="inp" name="vat" defaultValue={String(r.vat_rate)}><option value="0">0%</option><option value="14">14%</option></select></label>
          <label className="f"><span>WHT</span><select className="inp" name="wht" defaultValue="0">{[0, 1, 3, 5].map(o => <option key={o} value={o}>{o}%</option>)}</select></label>
        </div>
        <div className="tw"><table>
          <thead><tr><th>Material</th><th className="num">Ordered</th><th className="num">Received before</th><th className="num">Received now</th><th>Unit</th><th className="num">Unit price</th></tr></thead>
          <tbody>{lines.map(l => (
            <tr key={l.id}><td dir="auto">{l.name ?? l.description}<div className="muted mono" style={{ fontSize: 12 }}>{l.account}</div></td>
              <td className="num">{Number(l.qty)}</td><td className="num">{Number(l.received_qty)}</td>
              <td className="num"><input className="inp mono" style={{ maxWidth: 110 }} name={'qty_' + l.id} inputMode="decimal" defaultValue={left(l) || ''} disabled={!left(l)} /></td>
              <td>{l.unit}</td>
              <td className="num"><input className="inp mono" style={{ maxWidth: 130 }} name={'price_' + l.id} inputMode="decimal" defaultValue={l.price} disabled={!left(l)} /></td></tr>))}</tbody>
        </table></div>
        <label className="f" style={{ marginTop: 12 }}><span>The vendor&apos;s invoice (photo or PDF, up to 4 MB)</span>
          <input className="inp" type="file" name="file" accept="image/*,application/pdf" required /></label>
        <p className="muted" style={{ fontSize: 13 }}>Posting puts each item on its GL code for {r.cc}, VAT on input VAT, and the net on the vendor&apos;s account. It is then paid from a payment request that ticks this invoice.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Receive and post invoice</button></div>
      </form>
    </>
  );
}
