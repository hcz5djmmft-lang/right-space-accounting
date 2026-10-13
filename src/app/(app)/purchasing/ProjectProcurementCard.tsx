import Link from 'next/link';
import { fmt } from '@/lib/money';
import { sql } from '@/lib/db';
import { committedVsBudget } from '@/lib/procurement';

/** The project page's procurement card: the material plan's progress and committed cost against the BOQ budget. */
export async function ProjectProcurementCard({ id }: { id: string }) {
  const [[plan], budget, [pos]] = await Promise.all([
    sql<{ lines: number; requested: number; next_needed: string | null }[]>`select count(*)::int lines, count(request_id)::int requested, to_char(min(needed_by) filter (where request_id is null),'YYYY-MM-DD') next_needed from material_plan where project_id = ${id}`,
    committedVsBudget(id),
    sql<{ open: number; wos: number }[]>`select (select count(*)::int from purchase_requests r where r.project_id = ${id} and r.status = 'approved' and not r.closed) open, (select count(*)::int from work_orders w where w.project_id = ${id} and w.status in ('approved','closed')) wos`,
  ]);
  if (!plan.lines && !budget.rows.length && !pos.open && !pos.wos) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Procurement</h2>
        <div className="row"><Link className="btn sm" href={`/purchasing/plan?project=${id}`}>Material plan</Link><Link className="btn sm" href={`/purchasing/reports?tab=budget&project=${id}`}>Committed vs budget</Link></div></div>
      <div className="tiles" style={{ marginTop: 8, marginBottom: 0 }}>
        <div className="tile"><div className="k">Material plan ordered</div><div className="v mono">{plan.lines ? `${plan.requested} / ${plan.lines}` : '—'}</div>{plan.next_needed && <div className="muted" style={{ fontSize: 12 }}>next needed {plan.next_needed}</div>}</div>
        <div className="tile"><div className="k">Open POs · work orders</div><div className="v mono">{pos.open} · {pos.wos}</div></div>
        <div className="tile"><div className="k">Committed vs budget</div><div className="v mono" style={{ fontSize: 15 }}>{fmt(budget.total.committed)} / {fmt(budget.total.budget)}</div>{budget.total.over ? <span className="pill rejected">{budget.total.over} code{budget.total.over === 1 ? '' : 's'} over</span> : budget.total.budget ? <span className="pill posted">within budget</span> : null}</div>
      </div>
    </div>
  );
}
