import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { employeeOf } from '@/lib/attendance';
import { balanceOf, canDecide, getLeave } from '@/lib/leave';
import { cancelLeaveAction, decideLeaveAction } from '../actions';

export default async function LeaveRequest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const r = await getLeave(id);
  if (!r) notFound();
  const me = await employeeOf(user.id);
  const own = me?.id === r.employee_id;
  if (!own && !hasRole(user, 'hr', 'finance') && r.head_user_id !== user.id) notFound();
  const [balance, log] = await Promise.all([
    balanceOf(r.employee_id, Number(r.from_date.slice(0, 4))),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'leave' and g.entity_id = ${id} order by g.at`,
  ]);
  const decide = canDecide(user, r);
  const open = ['head', 'hr'].includes(r.status);
  const steps = [
    { name: r.head_user_id ? `Department head${r.head_name ? ` · ${r.head_name}` : ''}` : 'Department head (none: straight to HR)', done: !!r.head_at || !r.head_user_id, cur: r.status === 'head', by: r.head_signer, at: r.head_at },
    { name: 'HR', done: !!r.hr_at, cur: r.status === 'hr', by: r.hr_signer, at: r.hr_at },
  ];
  return (
    <>
      <div className="head"><div><h1 dir="auto">{r.name} · {r.type_label}</h1><p>{r.from_date} to {r.to_date} · {r.days} working days · <span className={'pill ' + (r.status === 'approved' ? 'posted' : open ? 'pending' : 'rejected')}>{r.status === 'head' ? 'with the head' : r.status === 'hr' ? 'with HR' : r.status}</span></p></div>
        <Link className="btn" href="/leave">Back to leave</Link></div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="steps">{steps.map(st => <div key={st.name} className={st.cur ? 'cur' : ''}><b>{st.name}</b><div className="muted" style={{ fontSize: 12 }}>{st.done ? (st.by ? `signed by ${st.by} · ${st.at}` : 'skipped') : st.cur ? 'waiting' : 'next'}</div></div>)}</div>
      <div className="card">
        {r.reason && <p dir="auto" style={{ marginTop: 0 }}>Reason: {r.reason}</p>}
        {r.decision_note && <p dir="auto">Note: {r.decision_note}</p>}
        <p className="muted" style={{ fontSize: 13 }}>Annual balance {balance.year}: {balance.entitlement} days, {balance.taken} taken, {balance.pending} waiting, {balance.balance - balance.pending} left. Asked on {r.created_at}.</p>
        {decide && open && (
          <form className="row" style={{ marginTop: 8 }}>
            <input className="inp" name="note" dir="auto" placeholder="Note (optional)" style={{ flex: 1, minWidth: 160 }} />
            <button className="btn pri" formAction={decideLeaveAction.bind(null, id, true)}>Approve</button>
            <button className="btn bad" formAction={decideLeaveAction.bind(null, id, false)}>Reject</button>
          </form>)}
        {((own && open) || (hasRole(user, 'hr') && r.status === 'approved')) && <form action={cancelLeaveAction.bind(null, id)} style={{ marginTop: 8 }}><button className="btn">{own && open ? 'Withdraw my request' : 'Cancel this leave'}</button></form>}
      </div>
      <div className="card log"><h2 style={{ marginTop: 0 }}>History</h2>{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? ''} · {g.action}{g.note ? ` — ${g.note}` : ''}</div>)}</div>
    </>
  );
}
