import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { today } from '@/lib/dates';
import { employeeOf } from '@/lib/attendance';
import { balanceOf, leaveWaitingFor, listLeave } from '@/lib/leave';
import { LEAVE_TYPES } from '@/lib/leave-calc';
import { listEmployeeFiles } from '@/lib/hr';
import { requestLeaveAction } from './actions';

const pill = (st: string) => <span className={'pill ' + (st === 'approved' ? 'posted' : st === 'rejected' || st === 'cancelled' ? 'rejected' : 'pending')}>{st === 'head' ? 'with the head' : st === 'hr' ? 'with HR' : st}</span>;

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; year?: string }> }) {
  const user = await requireUser();
  const { tab = 'mine', error, year: y } = await searchParams;
  const todayStr = today();
  const year = Number(y ?? todayStr.slice(0, 4));
  const hr = hasRole(user, 'hr');
  const me = await employeeOf(user.id);
  const [balance, mine, waiting, all, employees] = await Promise.all([
    me ? balanceOf(me.id, year) : null, me ? listLeave({ employee: me.id, year }) : [], leaveWaitingFor(user),
    hr && tab === 'all' ? listLeave({ year }) : [], hr && tab === 'all' ? listEmployeeFiles() : [],
  ]);
  const table = (rows: typeof mine, who = false) => (
    <div className="tw"><table>
      <thead><tr>{who && <th>Employee</th>}<th>Kind</th><th>From</th><th>To</th><th className="num">Days</th><th>Status</th><th className="hide-sm">Reason</th></tr></thead>
      <tbody>{rows.length === 0 && <tr><td colSpan={7} className="muted">Nothing here.</td></tr>}
        {rows.map(r => <tr key={r.id}>{who && <td dir="auto"><Link href={`/leave/${r.id}`}>{r.name}</Link></td>}<td><Link href={`/leave/${r.id}`}>{r.type_label}</Link></td><td className="mono">{r.from_date}</td><td className="mono">{r.to_date}</td>
          <td className="num">{r.days}</td><td>{pill(r.status)}</td><td className="hide-sm" dir="auto">{r.reason}</td></tr>)}
      </tbody></table></div>);
  return (
    <>
      <div className="head"><div><h1>Leave</h1><p>Ask for leave from the phone; the head of your department signs it, then HR.</p></div></div>
      <div className="tabs">
        <Link href="/leave" className={tab === 'mine' ? 'on' : ''}>My leave</Link>
        <Link href="/leave?tab=waiting" className={tab === 'waiting' ? 'on' : ''}>Waiting for me{waiting.length ? ` (${waiting.length})` : ''}</Link>
        {hr && <Link href="/leave?tab=all" className={tab === 'all' ? 'on' : ''}>All requests (HR)</Link>}
      </div>
      {error && <div className="msg bad">{error}</div>}

      {tab === 'mine' && (!me ? <div className="card">Your login is not linked to an employee file, so there is no leave balance to show. Ask HR to link it.</div> : (
        <>
          <div className="tiles">
            <div className="tile"><div className="k">Annual leave {year}</div><div className="v">{balance!.entitlement} days{balance!.thirty ? ' (30: ten years or age 50)' : ''}</div></div>
            <div className="tile"><div className="k">Taken</div><div className="v">{balance!.taken}</div></div>
            <div className="tile"><div className="k">Waiting</div><div className="v">{balance!.pending}</div></div>
            <div className="tile"><div className="k">Left</div><div className="v">{balance!.balance - balance!.pending}</div></div>
          </div>
          <form action={requestLeaveAction} className="card grid g4" style={{ alignItems: 'end' }}>
            <label className="f"><span>Kind</span><select className="inp" name="type">{LEAVE_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="f"><span>First day</span><input className="inp" type="date" name="from" required min={`${year}-01-01`} /></label>
            <label className="f"><span>Last day</span><input className="inp" type="date" name="to" required /></label>
            <label className="f"><span>Reason (optional)</span><input className="inp" name="reason" dir="auto" /></label>
            <button className="btn pri">Ask for leave</button>
          </form>
          {table(mine)}
        </>))}

      {tab === 'waiting' && table(waiting, true)}

      {tab === 'all' && hr && (
        <>
          <form action={requestLeaveAction} className="card grid g4" style={{ alignItems: 'end' }}>
            <label className="f"><span>Employee (HR files it for them)</span><select className="inp" name="employee_id" required><option value="">Choose…</option>{employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label className="f"><span>Kind</span><select className="inp" name="type">{LEAVE_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="f"><span>First day</span><input className="inp" type="date" name="from" required /></label>
            <label className="f"><span>Last day</span><input className="inp" type="date" name="to" required /></label>
            <label className="f" style={{ gridColumn: '1 / -2' }}><span>Reason</span><input className="inp" name="reason" dir="auto" /></label>
            <button className="btn">File the request</button>
          </form>
          <div className="row" style={{ marginBottom: 10 }}><Link className="btn sm" href={`/leave?tab=all&year=${year - 1}`}>‹ {year - 1}</Link><b>{year}</b><Link className="btn sm" href={`/leave?tab=all&year=${year + 1}`}>{year + 1} ›</Link><Link className="btn sm" href="/hr/reports?tab=leave">Balances</Link></div>
          {table(all, true)}
        </>)}
    </>
  );
}
