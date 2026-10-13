import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { claimState, clientClaimState, listClientClaims, listSubClaims } from '@/lib/claims';

const TABS = [['sub', 'Subcontractors'], ['client', 'Client']] as const;
const pill = (s: string) => (['requested', 'invoiced'].includes(s) ? 'posted' : ['returned', 'cancelled'].includes(s) ? 'rejected' : s === 'draft' ? '' : 'pending');

/** Progress claims: the subcontractors' (certified by the site engineer, priced by Procurement, paid by Finance) and the client's (against the BOQ). */
export default async function Claims({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string; ok?: string; error?: string }> }) {
  await requireUser();
  const { tab = 'sub', project, ok, error } = await searchParams;
  return (
    <>
      <div className="head"><div><h1>Progress claims</h1><p>A subcontractor&apos;s claim follows the company form: the site engineer enters the quantities done (previous, current, cumulative and the execution %), Procurement prices the items, Finance raises the payment request, less the retention and the advance recovered. A client claim certifies the work done per BOQ line; Finance invoices the period.</p></div>
        <div className="row"><Link className="btn pri" href="/claims/new">New subcontractor claim</Link><Link className="btn" href="/claims/client/new">New client claim</Link><Link className="btn" href="/cost-control?tab=claims">Claims register</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/claims?tab=${k}${project ? `&project=${project}` : ''}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {tab === 'client' ? <ClientTable project={project} /> : <SubTable project={project} />}
    </>
  );
}

async function SubTable({ project }: { project?: string }) {
  const rows = await listSubClaims({ project });
  if (!rows.length) return <div className="empty card">No subcontractor claim yet. Start one from a work order or with &quot;New subcontractor claim&quot;.</div>;
  return (
    <div className="tw"><table>
      <thead><tr><th>No.</th><th>Date</th><th>Project</th><th>Subcontractor</th><th className="hide-sm">Work order</th><th className="hide-sm">Claim</th><th>Status</th><th className="num">Cumulative work</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td className="mono"><Link href={`/claims/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td><td>{r.code}</td><td dir="auto">{r.vendor}</td>
        <td className="hide-sm">{r.wo_no ? <Link href={`/purchasing/work-orders/${r.work_order_id}`}>{r.wo_no}</Link> : <span className="muted">{r.trade || '—'}</span>}</td><td className="hide-sm mono">{r.claim_no}</td>
        <td><span className={'pill ' + pill(r.status)}>{claimState(r)}</span></td><td className="num mono">{fmt(r.gross)}</td></tr>)}</tbody>
    </table></div>
  );
}
async function ClientTable({ project }: { project?: string }) {
  const rows = await listClientClaims({ project });
  if (!rows.length) return <div className="empty card">No client claim yet. &quot;New client claim&quot; certifies the work done against the project&apos;s BOQ.</div>;
  return (
    <div className="tw"><table>
      <thead><tr><th>No.</th><th>Date</th><th>Project</th><th className="hide-sm">Client</th><th className="hide-sm">Claim</th><th>Status</th><th className="num">Cumulative work</th><th className="num hide-sm">Contract</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td className="mono"><Link href={`/claims/client/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td><td>{r.code}</td><td className="hide-sm" dir="auto">{r.client ?? '—'}</td><td className="hide-sm mono">{r.claim_no}</td>
        <td><span className={'pill ' + pill(r.status)}>{clientClaimState(r)}</span></td><td className="num mono">{fmt(r.gross)}</td><td className="num mono hide-sm">{r.contract ? fmt(r.contract) : '—'}</td></tr>)}</tbody>
    </table></div>
  );
}
