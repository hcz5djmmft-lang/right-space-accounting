import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { today } from '@/lib/dates';
import { employeeOf, getHr, lastRecord, listRecords, listSessions, openRecord, openSession, projectPins } from '@/lib/attendance';
import { fmtMin, officeSet, placeLabel } from '@/lib/attendance-calc';
import { categoryOf, defaultPick, offeredCategories, whatLabel } from '@/lib/clock-categories';
import { ClockCard } from '@/components/ClockCard';
import { CategoryPicker } from '@/components/CategoryPicker';
import { switchAction } from './actions';

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
  const [s, open, session, month, sessions, projects, last] = await Promise.all([
    getHr(), openRecord(me.id), openSession(me.id), listRecords({ employee: me.id, period }), listSessions({ employee: me.id, period }), projectPins(), lastRecord(me.id),
  ]);
  const categories = offeredCategories(me, user).map(c => ({ key: c.key, label: c.label, project: c.project, rule: c.rule }));
  const pick = defaultPick(me, last);
  const office = { set: officeSet(s), radius: s.office_radius_m };
  const what = (category: string, code: string | null) => whatLabel(categoryOf(category), code);
  const tot = month.reduce((a, r) => ({ worked: a.worked + r.worked_min, late: a.late + r.late_min, ot: a.ot + r.overtime_min }), { worked: 0, late: 0, ot: 0 });
  const designMin = sessions.filter(x => x.category === 'design').reduce((a, x) => a + x.minutes, 0);
  const now = session ?? open;
  return (
    <>
      <div className="head"><div><h1>Clock in</h1><p>{me.name} · {me.work_location === 'site' ? 'Site staff' : 'Office staff'}. Say what the day is for when you clock in; Switch when it changes.</p></div></div>
      {error && <div className="msg bad">{error}</div>}
      <ClockCard open={open ? { in_time: open.in_time, what: what((now ?? open).category, (now ?? open).project_code), where: placeLabel(open.in_place, open.in_lat !== null) } : null}
        categories={categories} projects={projects} pick={{ category: pick.category, project: pick.projectId }} office={office} />

      {open && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Switch during the day</h2>
          <p className="muted" style={{ marginTop: 0 }}>Now: <b>{now ? what(now.category, now.project_code) : ''}</b>{session ? <> since <b className="mono">{session.start_time}</b>{session.note ? ` · ${session.note}` : ''}</> : null}.
            Moving to something else? Pick it here: each stretch keeps its hours, and design hours go to the project with their cost.</p>
          <form action={switchAction}>
            <CategoryPicker title="Switch to" categories={categories} projects={projects} category={now?.category ?? pick.category} project={now?.project_id ?? pick.projectId} office={office} checkPosition={false} />
            <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <input className="inp" name="note" dir="auto" placeholder="What (optional): Concept 3D, shop drawings…" style={{ flex: 1, minWidth: 180 }} />
              <button className="btn">Switch</button>
            </div>
          </form>
        </div>)}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>This month</h2>
        <div className="sumbar" style={{ justifyContent: 'flex-start' }}>
          <span>Days <b>{month.length}</b></span><span>Worked <b className="mono">{fmtMin(tot.worked)}</b></span><span>Late <b className="mono">{fmtMin(tot.late)}</b></span><span>Overtime <b className="mono">{fmtMin(tot.ot)}</b></span>{designMin > 0 && <span>Design <b className="mono">{fmtMin(designMin)}</b></span>}
        </div>
        {month.length > 0 && <div className="tw"><table>
          <thead><tr><th>Day</th><th>In</th><th>Out</th><th className="num">Late</th><th className="num">Overtime</th></tr></thead>
          <tbody>{month.map(r => <tr key={r.id}><td><span className="mono">{r.day}</span><div className="muted" style={{ fontSize: 11 }}>{what(r.category, r.project_code)} · <span className={r.in_place === 'away' ? 'pill nocap rejected' : ''}>{placeLabel(r.in_place, r.in_lat !== null)}</span></div></td><td className="mono">{r.in_time}</td><td className="mono">{r.out_time ?? '…'}</td>
            <td className="num mono">{r.late_min ? fmtMin(r.late_min) : ''}</td><td className="num mono">{r.overtime_min ? fmtMin(r.overtime_min) : ''}</td></tr>)}</tbody>
        </table></div>}
        {sessions.length > 0 && <div className="tw" style={{ marginTop: 10 }}><table>
          <thead><tr><th>Day</th><th>What</th><th>From</th><th>To</th><th className="num">Hours</th></tr></thead>
          <tbody>{sessions.map(x => <tr key={x.id}><td className="mono">{x.day}</td><td>{what(x.category, x.project_code)}{x.note ? <span className="muted" dir="auto"> · {x.note}</span> : ''}</td><td className="mono">{x.start_time}</td><td className="mono">{x.end_time ?? '…'}</td><td className="num mono">{x.minutes ? fmtMin(x.minutes) : ''}</td></tr>)}</tbody>
        </table></div>}
      </div>
    </>
  );
}
