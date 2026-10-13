import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { employeeOf, getHr, listRecords, listSessions, openRecord, openSession } from '@/lib/attendance';
import { fmtMin, officeSet } from '@/lib/attendance-calc';
import { ClockCard } from '@/components/ClockCard';
import { startDesignAction, stopDesignAction } from './actions';

export default async function Clock({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const me = await employeeOf(user.id);
  if (!me) return (
    <>
      <div className="head"><div><h1>Clock in</h1></div></div>
      <div className="card">Your login is not linked to an employee file yet, so there is nothing to clock. {hasRole(user, 'hr') ? <>Open <Link href="/hr">Employees</Link>, the person&apos;s file, the Login tab, and link this login.</> : 'Ask HR to link it from your employee file.'}</div>
    </>);
  const period = today().slice(0, 7);
  const [s, open, session, month, sessions, projects] = await Promise.all([
    getHr(), openRecord(me.id), openSession(me.id), listRecords({ employee: me.id, period }), listSessions({ employee: me.id, period }),
    sql<{ id: string; code: string; name: string }[]>`select id, code, name from projects where not is_office and status = 'Active' order by code`,
  ]);
  const tot = month.reduce((a, r) => ({ worked: a.worked + r.worked_min, late: a.late + r.late_min, ot: a.ot + r.overtime_min }), { worked: 0, late: 0, ot: 0 });
  const designMin = sessions.reduce((a, x) => a + x.minutes, 0);
  return (
    <>
      <div className="head"><div><h1>Clock in</h1><p>{me.name} · {me.work_location === 'site' ? 'Site staff: clock in anywhere, HR sees where' : 'Office staff'}</p></div></div>
      {error && <div className="msg bad">{error}</div>}
      <ClockCard open={!!open} inTime={open?.in_time ?? null} place={open?.in_place ?? null} needOffice={me.work_location === 'office' && officeSet(s)} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Design work on a project</h2>
        {session ? (
          <form action={stopDesignAction} className="row" style={{ justifyContent: 'space-between' }}>
            <span>Working on <b className="mono">{session.project_code}</b> since <b className="mono">{session.start_time}</b>{session.note ? ` · ${session.note}` : ''}</span>
            <button className="btn pri">Stop</button>
          </form>
        ) : (
          <form action={startDesignAction} className="grid g3" style={{ alignItems: 'end' }}>
            <label className="f"><span>Project</span><select className="inp" name="project" required><option value="">Choose…</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code === p.name ? p.code : `${p.code} · ${p.name}`}</option>)}</select></label>
            <label className="f"><span>What (optional)</span><input className="inp" name="note" dir="auto" placeholder="Concept 3D, shop drawings…" /></label>
            <button className="btn">Start design work</button>
          </form>)}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>The hours go to the project with their cost; start when you begin designing, stop when you move to something else.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>This month</h2>
        <div className="sumbar" style={{ justifyContent: 'flex-start' }}>
          <span>Days <b>{month.length}</b></span><span>Worked <b className="mono">{fmtMin(tot.worked)}</b></span><span>Late <b className="mono">{fmtMin(tot.late)}</b></span><span>Overtime <b className="mono">{fmtMin(tot.ot)}</b></span><span>Design <b className="mono">{fmtMin(designMin)}</b></span>
        </div>
        {month.length > 0 && <div className="tw"><table>
          <thead><tr><th>Day</th><th>In</th><th>Out</th><th className="hide-sm">Place</th><th className="num">Late</th><th className="num">Overtime</th></tr></thead>
          <tbody>{month.map(r => <tr key={r.id}><td className="mono">{r.day}</td><td className="mono">{r.in_time}</td><td className="mono">{r.out_time ?? '…'}</td><td className="hide-sm">{r.in_place}</td>
            <td className="num mono">{r.late_min ? fmtMin(r.late_min) : ''}</td><td className="num mono">{r.overtime_min ? fmtMin(r.overtime_min) : ''}</td></tr>)}</tbody>
        </table></div>}
        {sessions.length > 0 && <div className="tw" style={{ marginTop: 10 }}><table>
          <thead><tr><th>Day</th><th>Project</th><th>From</th><th>To</th><th className="num">Hours</th></tr></thead>
          <tbody>{sessions.map(x => <tr key={x.id}><td className="mono">{x.day}</td><td className="mono">{x.project_code}</td><td className="mono">{x.start_time}</td><td className="mono">{x.end_time ?? '…'}</td><td className="num mono">{x.minutes ? fmtMin(x.minutes) : ''}</td></tr>)}</tbody>
        </table></div>}
      </div>
    </>
  );
}
