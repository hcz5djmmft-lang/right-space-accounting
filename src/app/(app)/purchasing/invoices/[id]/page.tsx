import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { lineAmount } from '@/lib/ledger';
import { getPR, getPRLines } from '@/lib/pr-queries';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';
import { today } from '@/lib/dates';
import { voidInvoiceAction } from '../../actions';

/** A vendor invoice received against a purchase order. */
export default async function VendorInvoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const r = await getPR(id);
  if (!r) notFound();
  const [lines, files, [po], [paid], requests] = await Promise.all([
    getPRLines(id), listAttachments('invoice', id),
    sql<{ id: string; no: string; po_no: string }[]>`select q.id, q.no, q.po_no from purchase_requests q join invoices i on i.po_id = q.id where i.id = ${id}`,
    sql<{ v: number }[]>`select invoice_paid(${id}) v`,
    sql<{ id: string; no: string; status: string }[]>`select q.id, q.no, q.status from payment_request_bills b join invoices q on q.id = b.request_id where b.bill_id = ${id} order by q.no`,
  ]);
  const voided = r.status === 'void';
  const open = voided ? 0 : r.net - paid.v;
  const mayVoid = !voided && hasRole(user, 'finance') && paid.v === 0 && !requests.some(q => ['draft', 'pending', 'posted'].includes(q.status));
  const ded = [[`Less WHT (${r.wht_rate}%)`, r.wht]] as const;
  return (
    <>
      <div className="head">
        <div><h1>{r.no} <span className={'pill ' + (voided ? 'rejected' : open <= 0.004 ? 'posted' : 'pending')}>{voided ? 'Void' : open <= 0.004 ? 'Paid' : paid.v ? 'Part paid' : 'Unpaid'}</span></h1>
          <p dir="auto">{r.date} · {r.vendor} · vendor&apos;s invoice {r.ref} · for {r.cc}{po ? <> · on <Link href={`/purchasing/${po.id}`}>{po.po_no}</Link></> : null}</p></div>
        <div className="row">
          {open > 0.004 && <Link className="btn pri" href="/payment-requests/new">Pay a vendor or subcontractor</Link>}
          <Link className="btn" href={`/parties/${r.party_id}`}>Vendor account</Link>
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>GL code</th><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}><td dir="auto"><span className="mono">{l.account}</span> · {l.name}</td><td dir="auto">{l.description}</td><td className="num">{Number(l.qty)}</td><td className="num">{fmt(l.price)}</td><td className="num">{fmt(lineAmount(l))}</td></tr>)}
          <tr><td colSpan={4}>Subtotal</td><td className="num">{fmt(r.subtotal)}</td></tr>
          {r.vat ? <tr><td colSpan={4}>VAT {r.vat_rate}%</td><td className="num">{fmt(r.vat)}</td></tr> : null}
          {ded.filter(d => d[1]).map(d => <tr key={d[0]}><td colSpan={4}>{d[0]}</td><td className="num">({fmt(d[1])})</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>Net to the vendor</td><td className="num">{fmt(r.net)}</td></tr></tfoot>
      </table></div>
      <div className="card">Posted as <Link href={`/entries/${r.entry_id}`}>{r.entry_no}</Link> · paid {fmt(paid.v)} · unpaid {fmt(open)}
        {requests.length ? <> · payment request {requests.map((q, i) => <span key={q.id}>{i ? ', ' : ''}<Link href={`/payment-requests/${q.id}`}>{q.no}</Link> ({q.status === 'posted' ? 'approved' : q.status})</span>)}</> : ' · not yet on a payment request'}</div>
      {mayVoid && (
        <details className="card"><summary>Void this invoice</summary>
          <form action={voidInvoiceAction.bind(null, id)} className="grid g3" style={{ marginTop: 10, alignItems: 'end' }}>
            <label className="f"><span>Reversal date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
            <label className="f"><span>Reason</span><input className="inp" name="reason" /></label>
            <button className="btn bad">Void invoice</button>
          </form></details>)}
      <Attachments entity="invoice" id={id} path={`/purchasing/invoices/${id}`} items={files} userId={user.id} canRemove={hasRole(user, 'finance')} locked={true} />
    </>
  );
}
