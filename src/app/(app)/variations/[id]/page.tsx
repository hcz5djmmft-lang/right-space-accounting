import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt, r2 } from '@/lib/money';
import { TZ } from '@/lib/dates';
import { canEngineer, getVariation, getVariationLines, voState } from '@/lib/claims';
import { cancelVariationAction, decideVariationAction, sendVariationAction } from '../actions';

const num = (v: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(v);

export default async function VariationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const v = await getVariation(id);
  if (!v) notFound();
  const [lines, log] = await Promise.all([getVariationLines(id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'variation' and g.entity_id = ${id} order by g.at`]);
  const may = canEngineer(user) || hasRole(user, 'finance');
  const mayEdit = ['draft', 'rejected'].includes(v.status) && may;
  const pillClass = v.status === 'approved' ? 'posted' : ['rejected', 'cancelled'].includes(v.status) ? 'rejected' : v.status === 'draft' ? '' : 'pending';
  return (
    <>
      <div className="head">
        <div><h1>{v.no} <span className={'pill ' + pillClass}>{voState(v)}</span></h1>
          <p dir="auto"><Link href={`/cost-centers/${v.project_id}`}>{v.code}</Link> · {v.date}{v.client_ref ? ` · client ref. ${v.client_ref}` : ''} · raised by {v.created_by_name ?? '—'}{v.decided_at ? ` · decided ${v.decided_at} (${v.decided_by_name ?? ''})` : ''}</p></div>
        <div className="row">
          {mayEdit && <Link className="btn" href={`/variations/new?edit=${id}`}>Edit</Link>}
          {v.status === 'draft' && may && <form action={sendVariationAction.bind(null, id)}><button className="btn pri">Send to the client</button></form>}
          {!['approved', 'cancelled'].includes(v.status) && may && <form action={cancelVariationAction.bind(null, id)}><button className="btn bad">Cancel</button></form>}
          <Link className="btn" href="/variations">All variation orders</Link>
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      <h2 style={{ margin: '0 0 8px' }} dir="auto">{v.title}</h2>
      {v.notes && <div className="card" dir="auto"><b>Notes:</b> {v.notes}</div>}
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>#</th><th>Description</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th className="hide-sm">GL code</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id}><td className="mono">{l.line_no}</td><td dir="auto">{l.description}</td><td>{l.unit}</td><td className="num mono">{num(l.qty)}</td><td className="num mono">{fmt(l.rate)}</td><td className="num mono">{fmt(r2(l.qty * l.rate))}</td><td className="hide-sm mono">{l.account ?? '—'}{l.account_name ? <span className="muted"> · {l.account_name}</span> : null}{l.boq_line_id ? <span className="pill posted" style={{ marginLeft: 6 }}>in the BOQ</span> : null}</td></tr>)}
          <tr className="tot"><td colSpan={5}><b>Total</b> <span className="muted" style={{ fontWeight: 400 }}>· before VAT{v.status === 'approved' ? ' · added to the contract' : ''}</span></td><td className="num mono"><b>{fmt(v.total)}</b></td><td className="hide-sm"></td></tr></tbody>
      </table></div>
      {['sent', 'draft'].includes(v.status) && may && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>The client&apos;s answer</h2>
          <p className="muted" style={{ fontSize: 13 }}>Approved: the lines join {v.code}&apos;s BOQ and the contract grows by {fmt(v.total)}. Declined: the order is kept for the record and can be edited and sent again.</p>
          <div className="grid g2">
            <form action={decideVariationAction.bind(null, id, true)} className="row" style={{ alignItems: 'end' }}><label className="f" style={{ flex: 1 }}><span>Client reference</span><input className="inp" name="client_ref" dir="auto" defaultValue={v.client_ref} placeholder="Email of …" /></label><button className="btn pri">Client approved</button></form>
            <form action={decideVariationAction.bind(null, id, false)} className="row" style={{ alignItems: 'end' }}><label className="f" style={{ flex: 1 }}><span>Reason</span><input className="inp" name="note" dir="auto" /></label><button className="btn bad">Client declined</button></form>
          </div>
        </div>)}
      <div className="card"><h2>History</h2><div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? '—'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
