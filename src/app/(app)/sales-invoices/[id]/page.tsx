import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { amountInWords, lineAmount } from '@/lib/ledger';
import { getInvoice, getInvoiceLines, getInvoiceReceipts } from '@/lib/sales-queries';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';
import { deleteInvoice, postInvoice, voidInvoice } from '../actions';

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const r = await getInvoice(id);
  if (!r) notFound();
  const [lines, receipts, log, files] = await Promise.all([
    getInvoiceLines(id), getInvoiceReceipts(id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'invoice' and g.entity_id = ${id} order by g.at`,
    listAttachments('invoice', id),
  ]);
  const finance = hasRole(user, 'finance');
  const open = r.total - r.received;
  const today = new Date().toISOString().slice(0, 10);
  const state = r.status === 'posted' ? (open <= 0.004 ? 'received' : r.received ? 'part received' : 'open') : r.status;
  return (
    <>
      <div className="head">
        <div><h1>{r.no} <span className={'pill ' + (r.status === 'void' ? 'rejected' : r.status === 'posted' ? (open <= 0.004 ? 'posted' : 'pending') : '')}>{state}</span></h1>
          <p dir="auto">{r.date}{r.due ? ` · due ${r.due}` : ''} · {r.customer}{r.project_code ? ` · ${r.project_code}` : ''}{r.ref ? ` · Ref ${r.ref}` : ''}</p></div>
        <div className="row">
          <a className="btn" href={`/print/sales-invoice/${id}`} target="_blank">Print</a>
          {r.status === 'draft' && finance && <Link className="btn" href={`/sales-invoices/${id}/edit`}>Edit</Link>}
          {r.status === 'draft' && finance && <form action={deleteInvoice.bind(null, id)}><button className="btn bad">Delete</button></form>}
          {r.status === 'draft' && finance && <form action={postInvoice.bind(null, id)}><button className="btn pri">Post invoice</button></form>}
          {r.status === 'posted' && open > 0.004 && finance && <Link className="btn pri" href={`/receipts/new?customer=${r.party_id}`}>Record receipt</Link>}
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}

      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>Revenue GL code</th><th className="hide-sm">Description</th><th className="hide-sm">Project</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td dir="auto"><span className="mono">{l.account}</span> · {l.name}</td><td className="hide-sm" dir="auto">{l.description}</td><td className="hide-sm">{l.project_code ?? r.project_code ?? '—'}</td>
            <td className="num">{l.qty}</td><td className="num">{fmt(l.price)}</td><td className="num">{fmt(lineAmount(l))}</td></tr>))}
          <tr><td colSpan={5}>Subtotal</td><td className="num">{fmt(r.subtotal)}</td></tr>
          {r.vat ? <tr><td colSpan={5}>VAT {r.vat_rate}%</td><td className="num">{fmt(r.vat)}</td></tr> : null}
        </tbody>
        <tfoot><tr><td colSpan={5}>Invoice total</td><td className="num">{fmt(r.total)}</td></tr></tfoot>
      </table></div>
      <p className="muted" style={{ fontStyle: 'italic' }}>{amountInWords(r.total)}</p>

      {r.status === 'posted' && (
        <div className="card">Posted as <Link href={`/entries/${r.entry_id}`}>{r.entry_no}</Link> · received {fmt(r.received)} · still open {fmt(open)}
          {receipts.length > 0 && <table style={{ marginTop: 10 }}><thead><tr><th>Receipt</th><th>Date</th><th className="num">Allocated</th></tr></thead>
            <tbody>{receipts.map(p => <tr key={p.id}><td className="mono">{p.no}{p.entry_id ? <> · <Link href={`/entries/${p.entry_id}`}>{p.entry_no}</Link></> : null}</td><td className="mono">{p.date}</td><td className="num">{fmt(p.amount)}</td></tr>)}</tbody></table>}
        </div>)}
      {r.status === 'void' && <div className="msg bad">This invoice was voided; its entry <Link href={`/entries/${r.entry_id}`}>{r.entry_no}</Link> has been reversed.</div>}

      {r.status === 'posted' && finance && receipts.length === 0 && (
        <details className="card"><summary>Void this invoice</summary>
          <form action={voidInvoice.bind(null, id)} className="grid g3" style={{ marginTop: 10, alignItems: 'end' }}>
            <label className="f"><span>Reversal date</span><input className="inp" type="date" name="date" defaultValue={today} /></label>
            <label className="f"><span>Reason</span><input className="inp" name="reason" dir="auto" /></label>
            <button className="btn bad">Void and reverse</button>
          </form></details>)}

      <Attachments entity="invoice" id={id} path={`/sales-invoices/${id}`} items={files} userId={user.id} canRemove={finance} locked={r.status !== 'draft'} />
      <div className="card"><h2>History</h2>
        <div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? 'Imported'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
