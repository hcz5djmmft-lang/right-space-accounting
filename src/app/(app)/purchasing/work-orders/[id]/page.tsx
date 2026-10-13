import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
const num = (v: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(v);
import { TZ } from '@/lib/dates';
import { categoryTitle } from '@/lib/planning-calc';
import { listAttachments } from '@/lib/attachments';
import { isProcurement } from '@/lib/purchasing';
import { canActOnWO, getWOApprovals, getWOLines, getWorkOrder, woFigures, woState } from '@/lib/procurement';
import { Attachments } from '@/components/Attachments';
import { approveWOAction, cancelWOAction, closeWOAction, returnWOAction } from '../../procurement-actions';

export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const w = await getWorkOrder(id);
  if (!w) notFound();
  const [lines, approvals, proc, mayAct, files, log] = await Promise.all([getWOLines(id), getWOApprovals(id), isProcurement(user), canActOnWO(user, w), listAttachments('workorder', id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'workorder' and g.entity_id = ${id} order by g.at`]);
  const f = woFigures(w);
  const finance = hasRole(user, 'finance');
  const issued = w.status === 'approved' || w.status === 'closed';
  const mayEdit = ['draft', 'rejected'].includes(w.status) && (w.created_by === user.id || proc);
  const mayCancel = w.status !== 'cancelled' && (issued ? proc || finance : w.created_by === user.id || proc);
  const lastReturn = [...log].reverse().find(g => g.action === 'Returned for changes');
  const chain = [{ key: 'procurement', name: 'Procurement' }, { key: 'head', name: w.approver_label ?? 'Department head' }, { key: 'management', name: 'Management' }]
    .map(s => { const a = approvals.find(x => x.step === s.key); return { ...s, note: a ? `✓ ${a.who ?? ''} · ${a.at}` : w.status === s.key ? 'Waiting' + (s.key === 'head' && w.approver_name ? ` for ${w.approver_name}` : '') : '—', cur: w.status === s.key }; });
  return (
    <>
      <div className="head">
        <div><h1>{w.no} <span className={'pill ' + (issued ? 'posted' : w.status === 'rejected' || w.status === 'cancelled' ? 'rejected' : 'pending')}>{woState(w)}</span></h1>
          <p dir="auto"><Link href={`/cost-centers/${w.project_id}`}>{w.code}</Link> · {w.vendor ?? 'no subcontractor'} · {w.category === 'other' ? 'Other' : `${w.category} · ${categoryTitle(w.category)}`} · {w.date}{w.start_date ? ` · ${w.start_date} to ${w.end_date ?? '…'}` : ''} · raised by {w.created_by_name ?? '—'}</p></div>
        <div className="row">
          {mayEdit && <Link className="btn" href={`/purchasing/work-orders/new?edit=${id}`}>Edit</Link>}
          {issued && (proc || finance) && <form action={closeWOAction.bind(null, id, w.status !== 'closed')}><button className="btn">{w.status === 'closed' ? 'Reopen' : 'Close work order'}</button></form>}
          {mayCancel && <form action={cancelWOAction.bind(null, id)}><button className="btn bad">Cancel</button></form>}
          <Link className="btn" href="/purchasing/work-orders">All work orders</Link>
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {w.status === 'rejected' && lastReturn && <div className="msg bad">Returned by {lastReturn.who}: {lastReturn.note || 'no reason given'}</div>}
      <h2 style={{ margin: '0 0 8px' }} dir="auto">{w.title}</h2>
      {w.notes && <div className="card" dir="auto"><b>Notes and terms:</b> {w.notes}</div>}
      <div className="steps">{chain.map(c => <div key={c.key} className={c.cur ? 'cur' : ''}><b>{c.name}</b><div className="muted" style={{ fontSize: 13 }}>{c.note}</div></div>)}</div>
      {mayAct && (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <form action={returnWOAction.bind(null, id)} className="row" style={{ flex: 1 }}><input className="inp" name="reason" placeholder="Reason, if returning for changes" style={{ flex: 1, minWidth: 180 }} /><button className="btn bad">Return</button></form>
          <form action={approveWOAction.bind(null, id)}><button className="btn pri">Approve as {w.status === 'head' ? w.approver_label ?? 'department head' : 'Management'}</button></form>
        </div>)}
      <div className="tiles">
        <div className="tile"><div className="k">Amount before VAT</div><div className="v mono">{fmt(f.amount)}</div></div>
        <div className="tile"><div className="k">VAT {w.vat_rate} %</div><div className="v mono">{fmt(f.vat)}</div></div>
        <div className="tile"><div className="k">Retention {w.retention_pct} % (held from each claim)</div><div className="v mono">{fmt(f.retention)}</div></div>
        <div className="tile"><div className="k">Advance {w.advance_pct} % (recovered from the claims)</div><div className="v mono">{fmt(f.advance)}</div></div>
      </div>
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>No.</th><th>Item</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id}><td className="mono">{l.line_no}</td><td dir="auto">{l.item}</td><td dir="auto">{l.unit}</td><td className="num mono">{num(l.qty)}</td><td className="num mono">{fmt(l.rate)}</td><td className="num mono">{fmt(Math.round(l.qty * l.rate * 100) / 100)}</td></tr>)}
          <tr className="tot"><td colSpan={5}><b>Total before VAT</b> <span className="muted" style={{ fontWeight: 400 }}>· GL code {w.account}{w.account_name ? ` · ${w.account_name}` : ''}</span></td><td className="num mono"><b>{fmt(f.amount)}</b></td></tr></tbody>
      </table></div>
      <div className="card"><h2 style={{ marginTop: 0 }}>Progress claims</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>The subcontractor&apos;s claims against this work order (previous, current and cumulative quantities per item) are certified by the site engineer, priced by Procurement and paid by Finance, less the retention and the advance recovery. Nothing certified yet.</p></div>
      <div className="card"><h2 style={{ marginTop: 0 }}>Files</h2><p className="muted" style={{ fontSize: 13 }}>The signed work order, the subcontractor&apos;s offer, drawings.</p>
        <Attachments entity="workorder" id={id} path={`/purchasing/work-orders/${id}`} items={files} userId={user.id} canRemove={proc || finance} locked={false} /></div>
      <div className="card"><h2>History</h2><div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? '—'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
