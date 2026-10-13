import Link from 'next/link';
import type { User } from '@/lib/roles';
import { today } from '@/lib/dates';
import { summarize } from '@/lib/planning-calc';
import { canPlan, getSchedule, listActivities } from '@/lib/planning';
import { startScheduleAction } from './actions';

/** The project page's schedule card: where the plan stands, or the way to start it. */
export async function ProjectPlanCard({ id, user, phase }: { id: string; user: User; phase: string | null }) {
  const [schedule, acts] = await Promise.all([getSchedule(id), listActivities(id)]);
  if (!schedule && !['planning', 'execution', 'handover'].includes(phase ?? '')) return null;
  const s = summarize(acts, today());
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Schedule</h2>
        {schedule ? <Link className="btn sm" href={`/planning/${id}`}>Open the schedule</Link> : canPlan(user) && <form action={startScheduleAction.bind(null, id)}><button className="btn sm pri">Start the schedule</button></form>}</div>
      {!schedule ? <p className="muted" style={{ marginBottom: 0 }}>No schedule yet: the planning engineer dates each work category and sets the baseline.</p> : (
        <div className="tiles" style={{ marginTop: 8, marginBottom: 0 }}>
          <div className="tile"><div className="k">Baseline</div><div className="v mono" style={{ fontSize: 15 }}>{schedule.baselined_at ?? 'not set'}</div></div>
          <div className="tile"><div className="k">Planned · done</div><div className="v mono">{s.dated ? `${s.planned_pct} % · ${s.actual_pct} %` : '—'}</div></div>
          <div className="tile"><div className="k">Expected finish</div><div className="v mono" style={{ fontSize: 15 }}>{s.expected_end ?? '—'}{s.slip_days > 0 ? <span className="pill rejected" style={{ marginLeft: 6 }}>+{s.slip_days} d</span> : ''}</div></div>
        </div>)}
    </div>
  );
}
