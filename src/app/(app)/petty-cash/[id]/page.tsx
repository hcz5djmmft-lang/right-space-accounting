import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { fmt } from '@/lib/money';
import { STATUS_LABEL, canSignPetty, getPetty, pettyLines } from '@/lib/petty-docs';
import { approvePettyAction, payPettyAction, returnPettyAction, voidPettyAction } from '../voucher-actions';

const KIND = { employee: 'Employee', vendor: 'Vendor', sub: 'Subcontractor', other: 'Other' } as const;

/** One petty cash (update 20): its lines, where it stands in the approvals, and Pay once approved. */
export default async function PettyDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const q = await searchParams;
  const d = await getPetty(id);
  if (!d) notFound();
  const lines = await pettyLines(id);
  const finance = hasRole(user, 'finance');
  const sign = canSignPetty(user, d);
  return (
    <>
      <div className="head"><div><h1>Petty cash {d.no}</h1><p>{d.date} · made by {d.who ?? '—'} · {d.cc}</p></div>
        <div className="row"><Link className="btn" href={`/print/petty-cash/${id}`} target="_blank">Print</Link>{finance && <Link className="btn" href="/petty-cash">All petty cash</Link>}</div></div>
      {q.ok && <div className="msg good">{q.ok}</div>}
      {q.error && <div className="msg bad">{q.error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Amount</div><div className="v mono">{fmt(d.total)}</div></div>
        <div className="tile"><div className="k">Status</div><div className="v" style={{ fontSize: 18 }}>{STATUS_LABEL[d.status]}{d.status === 'head' && d.approver_label ? ` (${d.approver_label})` : ''}</div></div>
      </div>
      <div className="card">
        <p style={{ marginTop: 0 }}><b>Paid to:</b> <span dir="auto">{d.paid_to_name}</span> <span className="muted">· {KIND[d.paid_to_kind]}</span><br /><b>For:</b> <span dir="auto">{d.purpose}</span></p>
        <div className="tw"><table>
          <thead><tr><th>GL code</th><th>Description</th><th className="num">EGP</th></tr></thead>
          <tbody>{lines.map(l => <tr key={l.line_no}><td><span className="mono">{l.account}</span> · <span dir="auto">{l.account_name}</span></td><td dir="auto">{l.description}</td><td className="num">{fmt(l.amount)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{fmt(d.total)}</b></td></tr></tfoot>
        </table></div>
        <p className="muted" style={{ fontSize: 13 }}>
          {d.head_name ? <>Approved by {d.head_name} ({d.head_at}). </> : null}{d.mgmt_name ? <>Management: {d.mgmt_name} ({d.mgmt_at}). </> : null}
          {d.entry_id ? <>Paid · entry <Link href={`/entries/${d.entry_id}`}>{d.entry_no}</Link>. </> : null}{d.decision_note ? <>Note: <span dir="auto">{d.decision_note}</span></> : null}</p>
      </div>
      {sign && <div className="card row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
        <form action={approvePettyAction.bind(null, id)}><button className="btn pri">Approve</button></form>
        <form action={returnPettyAction.bind(null, id)} className="row" style={{ alignItems: 'end' }}>
          <label className="f"><span>Why not</span><input className="inp" name="note" required /></label><button className="btn">Return</button></form>
      </div>}
      {finance && d.status === 'approved' && <form action={payPettyAction.bind(null, id)} className="card row" style={{ justifyContent: 'space-between' }}>
        <span>Hand over the cash, then record it: the entry posts out of the office cash as {d.no}.</span><button className="btn pri">Pay petty cash</button></form>}
      {finance && d.status !== 'voided' && <details className="card"><summary style={{ cursor: 'pointer' }}>Void</summary>
        <form action={voidPettyAction.bind(null, id)} className="row" style={{ marginTop: 8 }}><input className="inp" name="reason" placeholder="Why" required /><button className="btn bad">Void{d.entry_id ? ' (the cash comes back)' : ''}</button></form></details>}
    </>
  );
}
