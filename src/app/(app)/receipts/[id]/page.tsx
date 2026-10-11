import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { METHOD_LABEL, getReceipt, getReceiptAllocations } from '@/lib/collections';
import { TZ, today } from '@/lib/dates';
import { voidReceipt } from '../actions';

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  await requireUser('finance');
  const { id } = await params;
  const { error, done } = await searchParams;
  const r = await getReceipt(id);
  if (!r) notFound();
  const [alloc, log] = await Promise.all([
    getReceiptAllocations(id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'payment' and g.entity_id = ${id} order by g.at`,
  ]);
  const settled = alloc.reduce((s, a) => s + a.amount, 0);
  const advance = r.amount - settled;
  const title = r.method === 'cash' ? 'Cash receipt' : 'Bank transfer receipt';
  return (
    <>
      <div className="head">
        <div><h1>{r.no} <span className={'pill ' + (r.status === 'void' ? 'rejected' : 'posted')}>{r.status}</span></h1>
          <p dir="auto">{title} · {r.date} · {r.customer}{r.project_code ? ` · ${r.project_code}` : ''} · into {r.bank} · {r.account_name}{r.ref ? ` · Ref ${r.ref}` : ''}</p></div>
        <div className="row"><a className="btn pri" href={`/print/receipt/${id}`} target="_blank">Print receipt</a><Link className="btn" href="/receipts/new">Money received</Link><Link className="btn" href="/collections">Collections</Link></div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {done && <div className="msg good">Receipt {r.no} posted. Print it for the client.</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Received · {METHOD_LABEL[r.method]}</div><div className="v mono">{fmt(r.amount - r.wht)}</div></div>
        {r.wht > 0 && <div className="tile"><div className="k">WHT withheld by the client</div><div className="v mono">{fmt(r.wht)}</div></div>}
        <div className="tile"><div className="k">Settles invoices</div><div className="v mono">{fmt(settled)}</div></div>
        {advance > 0.004 && <div className="tile"><div className="k">Advance on account</div><div className="v mono">{fmt(advance)}</div></div>}
      </div>
      <p className="muted" style={{ fontStyle: 'italic' }}>{amountInWords(r.amount - r.wht)}</p>
      {alloc.length > 0 && (
        <div className="tw" style={{ marginBottom: 14 }}><table>
          <thead><tr><th>Invoice</th><th>Date</th><th className="hide-sm">Type</th><th className="hide-sm">Project</th><th className="num">Invoice total</th><th className="num">Settled</th></tr></thead>
          <tbody>{alloc.map(a => <tr key={a.invoice_id}><td className="mono"><Link href={`/sales-invoices/${a.invoice_id}`}>{a.no}</Link></td><td className="mono">{a.date}</td>
            <td className="hide-sm">{a.type ?? '—'}</td><td className="hide-sm">{a.project_code ?? '—'}</td><td className="num">{fmt(a.total)}</td><td className="num">{fmt(a.amount)}</td></tr>)}</tbody>
        </table></div>)}
      {r.entry_id && <div className="card">Posted as <Link href={`/entries/${r.entry_id}`}>{r.entry_no}</Link>{r.memo ? <span dir="auto"> · {r.memo}</span> : null}{r.created_by_name ? ` · received by ${r.created_by_name}` : ''}</div>}
      {r.status === 'void' && <div className="msg bad">This receipt was voided; its entry has been reversed and the invoices it settled are open again.</div>}
      {r.status === 'posted' && (
        <details className="card"><summary>Void this receipt</summary>
          <form action={voidReceipt.bind(null, id)} className="grid g3" style={{ marginTop: 10, alignItems: 'end' }}>
            <label className="f"><span>Reversal date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
            <label className="f"><span>Reason</span><input className="inp" name="reason" dir="auto" /></label>
            <button className="btn bad">Void and reverse</button>
          </form></details>)}
      <div className="card"><h2>History</h2>
        <div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? 'Imported'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
