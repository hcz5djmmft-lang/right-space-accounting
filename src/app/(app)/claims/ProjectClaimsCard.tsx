import Link from 'next/link';
import { fmt } from '@/lib/money';
import { sql } from '@/lib/db';

/** The project page's claims card: client claims against the contract, subcontractor claims, approved variations, samples waiting, budget alerts. */
export async function ProjectClaimsCard({ id }: { id: string }) {
  const [[r]] = await Promise.all([sql<{ contract: number | null; client_claims: number; client_certified: number; sub_claims: number; sub_certified: number; vo_approved: number; samples_open: number; alerts: number }[]>`
    select p.contract::float contract,
      (select count(*)::int from client_claims c where c.project_id = p.id and c.status <> 'cancelled') client_claims,
      coalesce((select sum(round(x.pct / 100 * l.amount, 2)) from client_claims c join client_claim_lines x on x.claim_id = c.id join boq_lines l on l.id = x.boq_line_id
        where c.project_id = p.id and c.status in ('certified', 'invoiced') and c.claim_no = (select max(claim_no) from client_claims y where y.project_id = p.id and y.status in ('certified', 'invoiced'))), 0)::float client_certified,
      (select count(*)::int from sub_claims c where c.project_id = p.id and c.status <> 'cancelled') sub_claims,
      coalesce((select sum(round(l.pct / 100 * (l.current_qty + l.previous_qty) * l.rate, 2)) from sub_claims c join sub_claim_lines l on l.claim_id = c.id where c.project_id = p.id and c.status in ('finance', 'requested')
        and c.claim_no = (select max(y.claim_no) from sub_claims y where y.project_id = p.id and y.vendor_id = c.vendor_id and coalesce(y.work_order_id, '') = coalesce(c.work_order_id, '') and y.status in ('finance', 'requested'))), 0)::float sub_certified,
      coalesce((select sum(round(l.qty * l.rate, 2)) from variation_orders v join variation_lines l on l.vo_id = v.id where v.project_id = p.id and v.status = 'approved'), 0)::float vo_approved,
      (select count(*)::int from finishes f where f.project_id = p.id and f.status in ('proposed', 'sent')) samples_open,
      (select count(*)::int from budget_alerts b where b.project_id = p.id) alerts
    from projects p where p.id = ${id}`]);
  if (!r || (!r.client_claims && !r.sub_claims && !r.vo_approved && !r.samples_open && !r.alerts)) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Claims, variations and samples</h2>
        <div className="row"><Link className="btn sm" href={`/claims?tab=client&project=${id}`}>Client claims</Link><Link className="btn sm" href={`/claims?project=${id}`}>Subcontractor claims</Link><Link className="btn sm" href={`/variations?project=${id}`}>Variations</Link><Link className="btn sm" href={`/samples?project=${id}`}>Samples</Link></div></div>
      <div className="tiles" style={{ marginTop: 8, marginBottom: 0 }}>
        <div className="tile"><div className="k">Certified to the client</div><div className="v mono" style={{ fontSize: 15 }}>{fmt(r.client_certified)}{r.contract ? ` / ${fmt(r.contract)}` : ''}</div>{r.contract && r.client_certified ? <div className="muted" style={{ fontSize: 12 }}>{Math.round(r.client_certified / r.contract * 1000) / 10}% of the contract · {r.client_claims} claim{r.client_claims === 1 ? '' : 's'}</div> : <div className="muted" style={{ fontSize: 12 }}>{r.client_claims} claim{r.client_claims === 1 ? '' : 's'}</div>}</div>
        <div className="tile"><div className="k">Subcontractors certified</div><div className="v mono" style={{ fontSize: 15 }}>{fmt(r.sub_certified)}</div><div className="muted" style={{ fontSize: 12 }}>{r.sub_claims} claim{r.sub_claims === 1 ? '' : 's'}</div></div>
        <div className="tile"><div className="k">Approved variations</div><div className="v mono" style={{ fontSize: 15 }}>{fmt(r.vo_approved)}</div></div>
        <div className="tile"><div className="k">Samples with the client · budget alerts</div><div className="v mono">{r.samples_open} · {r.alerts ? <span className="pill rejected">{r.alerts}</span> : 0}</div></div>
      </div>
    </div>
  );
}
