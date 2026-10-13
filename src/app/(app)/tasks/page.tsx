import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listTasks, LINKS, STATUSES } from '@/lib/tasks';
import { statusAction } from './actions';
import { today } from '@/lib/dates';
import { pendingSteps } from '@/lib/pending';

export default async function Tasks({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab = 'all' } = await searchParams;
  const [list, steps] = await Promise.all([listTasks(tab === 'mine' ? { mine: user.id } : {}), pendingSteps(user)]);
  const todayStr = today();
  return (
    <>
      <div className="head"><div><h1>Tasks</h1><p>Follow-ups, month-end steps and anything the team needs to get done.</p></div>
        <Link className="btn pri" href="/tasks/new">New task</Link></div>
      {steps.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pending steps for you <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {steps.length}</span></h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Every step in the system that waits for your input: approvals, forms, drawings, estimates, schedules and the week&apos;s progress. Each clears by itself once it is done.</p>
          <div style={{ display: 'grid', gap: 6 }}>{steps.map((st, i) => <div key={i} className="row" style={{ gap: 8 }}><span className="pill pending" style={{ textTransform: 'capitalize' }}>{st.kind}</span><Link href={st.href} dir="auto">{st.title}</Link>{st.since && <span className="muted mono" style={{ fontSize: 12 }}>{st.since}</span>}</div>)}</div>
        </div>)}
      <div className="tabs"><Link href="/tasks?tab=all" className={tab === 'all' ? 'on' : ''}>All tasks</Link><Link href="/tasks?tab=mine" className={tab === 'mine' ? 'on' : ''}>Assigned to me</Link></div>
      <div className="board">{STATUSES.map(([k, label], i) => {
        const items = list.filter(t => t.status === k);
        const next = STATUSES[i + 1]?.[0];
        return (
          <div className="col" key={k}><h3>{label}<span>{items.length}</span></h3>
            {items.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 4 }}>No tasks</div>}
            {items.map(t => (
              <div className="task" key={t.id}>
                <Link href={`/tasks/${t.id}`} className="t" dir="auto">{t.title}</Link>
                {t.link_type && t.link_id && LINKS[t.link_type] && <div className="muted" style={{ fontSize: 12 }}>↳ <Link href={LINKS[t.link_type] + t.link_id}>{t.link_label || t.link_id}</Link></div>}
                <div className="m">
                  <span>{t.assignee ?? 'Unassigned'}{t.comments ? ` · ${t.comments} 💬` : ''}</span>
                  <span>{t.priority === 'high' && <span className="pill rejected">high</span>} {t.due && <span className="mono" style={t.due < todayStr && k !== 'done' ? { color: 'var(--bad)' } : undefined}>{t.due}</span>}</span>
                </div>
                {next && <form action={statusAction.bind(null, t.id, next)}><button className="lnk" style={{ fontSize: 12 }}>→ {STATUSES[i + 1][1]}</button></form>}
              </div>))}
          </div>);
      })}</div>
    </>
  );
}
