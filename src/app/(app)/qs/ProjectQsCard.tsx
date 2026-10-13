import Link from 'next/link';
import { fmt } from '@/lib/money';
import type { User } from '@/lib/roles';
import { statusClass } from '@/lib/qs-calc';
import { canQs, listEstimates } from '@/lib/qs';
import { createEstimateAction } from './actions';

/** The project page's QS and pricing card: the estimate revisions and the way to start one. */
export async function ProjectQsCard({ id, user }: { id: string; user: User }) {
  const estimates = await listEstimates(id);
  const open = estimates.find(e => ['draft', 'sent'].includes(e.status));
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>QS and pricing</h2>
        <span className="row"><Link className="btn sm" href="/qs?tab=summary">BOQ summary</Link>
          {!open && canQs(user) && <form action={createEstimateAction.bind(null, id)} style={{ display: 'inline' }}><button className="btn sm pri">{estimates.length ? 'New estimate' : 'Start the estimate'}</button></form>}</span></div>
      {estimates.length === 0 ? <p className="muted" style={{ marginBottom: 0 }}>No estimate yet. The technical office starts it here or under Projects › QS and pricing once the design is issued.</p> : (
        <div className="tw" style={{ marginTop: 8 }}><table>
          <thead><tr><th>Estimate</th><th>Status</th><th className="num">Dry cost</th><th className="num">Client price</th><th></th></tr></thead>
          <tbody>{estimates.map(e => <tr key={e.id}><td>rev {e.rev}</td><td><span className={statusClass(e.status)}>{e.status_label}</span></td><td className="num mono">{fmt(e.dry_cost)}</td><td className="num mono">{fmt(e.client_price)}</td><td><Link className="btn sm" href={`/qs/${e.id}`}>Open</Link></td></tr>)}</tbody>
        </table></div>)}
    </div>
  );
}
