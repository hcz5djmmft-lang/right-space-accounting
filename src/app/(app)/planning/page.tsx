import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { phaseLabel } from '@/lib/projects';
import { canPlan, scheduleRows } from '@/lib/planning';
import { startScheduleAction } from './actions';

export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { tab = 'schedules', error, saved } = await searchParams;
  const rows = await scheduleRows();
  const may = canPlan(user);
  return (
    <>
      <div className="head"><div><h1>Planning</h1><p>A schedule per project: the planning engineer dates each work category, sets the baseline (the project then moves to Execution and procurement gets the materials&apos; needed-by dates), and the site engineer records the week&apos;s progress; anything behind the plan becomes a task.</p></div></div>
      <div className="tabs"><Link href="/planning?tab=schedules" className={tab === 'schedules' ? 'on' : ''}>Schedules</Link><Link href="/planning?tab=progress" className={tab === 'progress' ? 'on' : ''}>Schedule progress</Link></div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      {rows.length === 0 ? <div className="empty card">No project is in planning yet. A project gets here once the client accepts its estimate.</div> : tab === 'progress' ? (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="hide-sm">Phase</th><th className="num">Planned</th><th className="num">Actual</th><th className="num">Behind</th><th className="hide-sm">Baseline finish</th><th>Expected finish</th><th className="num">Slip</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td><Link href={`/planning/${r.id}`}>{r.code}</Link></td><td className="hide-sm">{phaseLabel(r.phase ?? '')}</td>
            <td className="num mono">{r.dated ? `${r.planned_pct} %` : ''}</td><td className="num mono">{r.dated ? `${r.actual_pct} %` : ''}</td>
            <td className="num">{r.behind ? <span className="pill rejected">{r.behind}</span> : r.dated ? 0 : ''}</td>
            <td className="hide-sm mono">{r.base_end ?? ''}</td><td className="mono">{r.expected_end ?? <span className="muted">not planned</span>}</td>
            <td className="num">{r.slip_days > 0 ? <span className="pill rejected">+{r.slip_days} d</span> : r.dated ? 'on time' : ''}</td></tr>)}</tbody>
        </table></div>) : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="hide-sm">Phase</th><th className="num">Activities</th><th className="hide-sm">Baseline</th><th className="num">Planned</th><th className="num">Actual</th><th>Expected finish</th><th></th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td><Link href={`/cost-centers/${r.id}`}>{r.code}</Link><div className="muted" style={{ fontSize: 12 }} dir="auto">{r.name !== r.code ? r.name : ''}</div></td><td className="hide-sm">{phaseLabel(r.phase ?? '')}</td>
            <td className="num mono">{r.has_schedule ? `${r.dated} / ${r.activities}` : ''}</td><td className="hide-sm">{r.baselined_at ? <span className="pill posted">{r.baselined_at}</span> : r.has_schedule ? <span className="pill pending">not set</span> : ''}</td>
            <td className="num mono">{r.dated ? `${r.planned_pct} %` : ''}</td><td className="num mono">{r.dated ? `${r.actual_pct} %` : ''}</td><td className="mono">{r.expected_end ?? ''}</td>
            <td>{r.has_schedule ? <Link className="btn sm" href={`/planning/${r.id}`}>Open</Link> : may && <form action={startScheduleAction.bind(null, r.id)}><button className="btn sm pri">Start the schedule</button></form>}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
