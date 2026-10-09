import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { amountInWords, lineAmount } from '@/lib/ledger';
import { canSign, getSteps } from '@/lib/documents';
import { getPR, getPRApprovals, getPRLines } from '@/lib/pr-queries';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';
import { approvePR, deletePR, returnPR } from '../actions';

export default async function PRPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const r = await getPR(id);
  if (!r) notFound();
  const [lines, approvals, steps, log, [paid], files] = await Promise.all([
    getPRLines(id), getPRApprovals(id), getSteps(),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'invoice' and g.entity_id = ${id} order by g.at`,
    sql<{ v: number }[]>`select coalesce(sum(a.amount),0) v from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' where a.invoice_id = ${id}`,
    listAttachments('invoice', id),
  ]);
  const cur = r.status === 'pending' ? steps[approvals.length] : undefined;
  const mayAct = canSign(user, cur);
  const mayEdit = ['draft', 'rejected'].includes(r.status) && (r.created_by === user.id || hasRole(user, 'finance'));
  const lastReturn = [...log].reverse().find(g => g.action === 'Returned for changes');
  const ded = [[`Less WHT (${r.wht_rate}%)`, r.wht], [`Less social insurance (${r.si_rate}%)`, r.si], [`Less retention (${r.ret_rate}%)`, r.retention], ['Less down payment', r.dp_amount]] as const;
  const open = r.net - paid.v;
  return (
    <>
      <div className="head">
        <div><h1>{r.no} <span className={'pill ' + r.status}>{r.status === 'rejected' ? 'returned' : r.status}</span></h1>
          <p dir="auto">{r.date} · {r.vendor} · {r.cc ?? 'per line'}{r.ref ? ` · Invoice ${r.ref}` : ''} · raised by {r.requester || r.created_by_name || 'imported'}</p></div>
        <div className="row">
          <a className="btn" href={`/print/payment-request/${id}`} target="_blank">Print</a>
          {mayEdit && <Link className="btn" href={`/payment-requests/${id}/edit`}>Edit</Link>}
          {mayEdit && <form action={deletePR.bind(null, id)}><button className="btn bad">Delete</button></form>}
          {r.status === 'posted' && open > 0.004 && hasRole(user, 'finance') && <Link className="btn pri" href={`/payments/new?vendor=${r.party_id}`}>Pay</Link>}
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {r.status === 'rejected' && lastReturn && <div className="msg bad">Returned by {lastReturn.who}: {lastReturn.note || 'no reason given'}</div>}

      <div className="steps">{steps.map((s, i) => {
        const a = approvals[i];
        return <div key={s.position} className={cur?.position === s.position ? 'cur' : ''}><b>{s.name}</b>
          <div className="muted" style={{ fontSize: 13 }}>{a ? `✓ ${a.who ?? ''} · ${a.at}` : cur?.position === s.position ? 'Waiting for approval' : '—'}</div></div>;
      })}</div>

      {mayAct && (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <form action={returnPR.bind(null, id)} className="row" style={{ flex: 1 }}>
            <input className="inp" name="reason" placeholder="Reason, if returning for changes" style={{ flex: 1, minWidth: 180 }} />
            <button className="btn bad">Return</button></form>
          <form action={approvePR.bind(null, id)}><button className="btn pri">Approve as {cur!.name}</button></form>
        </div>)}

      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>GL code</th><th className="hide-sm">Description</th><th className="hide-sm">Assigned to</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td dir="auto"><span className="mono">{l.account}</span> · {l.name}</td><td className="hide-sm" dir="auto">{l.description}</td><td className="hide-sm">{l.cc ?? r.cc}</td>
            <td className="num">{l.qty}</td><td className="num">{fmt(l.price)}</td><td className="num">{fmt(lineAmount(l))}</td></tr>))}
          <tr><td colSpan={5}>Subtotal</td><td className="num">{fmt(r.subtotal)}</td></tr>
          {r.vat ? <tr><td colSpan={5}>VAT {r.vat_rate}%</td><td className="num">{fmt(r.vat)}</td></tr> : null}
          {ded.filter(d => d[1]).map(d => <tr key={d[0]}><td colSpan={5}>{d[0]}</td><td className="num">({fmt(d[1])})</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={5}>Net to pay</td><td className="num">{fmt(r.net)}</td></tr></tfoot>
      </table></div>
      <p className="muted" style={{ fontStyle: 'italic' }}>{amountInWords(r.net)}</p>
      <Attachments entity="invoice" id={id} path={`/payment-requests/${id}`} items={files} userId={user.id} canRemove={hasRole(user, 'finance')} locked={r.status === 'posted'} />
      {r.status === 'posted' && <div className="card">Posted as <Link href={`/entries/${r.entry_id}`}>{r.entry_no}</Link> · paid {fmt(paid.v)} · open {fmt(open)}</div>}
      <div className="card"><h2>History</h2>
        <div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? 'Imported'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
