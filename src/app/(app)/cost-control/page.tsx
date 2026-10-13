import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { budgetAlerts, clientRegister, raiseBudgetAlerts, subRegister, toWorkload, variationsByProject } from '@/lib/claims';

const TABS = [['alerts', 'Budget alerts'], ['variations', 'Variation orders'], ['claims', 'Claims register'], ['workload', 'Technical Office workload']] as const;

/** Cost control: codes over budget (as tasks for Cost control), variation orders per project, the claims registers, and the Technical Office's open tasks and turnaround. */
export default async function CostControl({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { tab = 'alerts' } = await searchParams;
  return (
    <>
      <div className="head"><div><h1>Cost control</h1><p>Where a project&apos;s committed or posted cost passed its BOQ budget (one task to Cost control per code until it is back within budget), what the client approved as variations, what was claimed, certified, paid and collected, and the Technical Office&apos;s workload.</p></div>
        <div className="row"><Link className="btn" href="/purchasing/reports?tab=budget">Committed vs budget</Link><Link className="btn" href="/claims">Claims</Link><Link className="btn" href="/variations">Variation orders</Link></div></div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/cost-control?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {tab === 'alerts' && <Alerts user={user} />}
      {tab === 'variations' && <Variations />}
      {tab === 'claims' && <Claims />}
      {tab === 'workload' && <Workload />}
    </>
  );
}

async function Alerts({ user }: { user: Awaited<ReturnType<typeof requireUser>> }) {
  const raised = await raiseBudgetAlerts(user).catch(e => { console.error(e); return 0; });
  const rows = await budgetAlerts();
  return (
    <>
      {raised > 0 && <div className="msg">{raised} new alert{raised === 1 ? '' : 's'} raised as tasks for Cost control.</div>}
      {rows.length === 0 ? <div className="empty card">Every project is within its BOQ budget on every GL code.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th>GL code</th><th className="num">Over budget by</th><th className="hide-sm">Since</th><th>Task</th><th className="hide-sm">Assigned to</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.project_id + r.code}><td><Link href={`/purchasing/reports?tab=budget&project=${r.project_id}`}>{r.project_code}</Link></td><td className="mono">{r.code}<span className="muted"> · {r.name}</span></td><td className="num mono"><span className="pill rejected">{fmt(r.over_by)}</span></td><td className="hide-sm mono">{r.raised_at}</td>
            <td>{r.task_id ? <Link href={`/tasks/${r.task_id}`}>{r.task_status === 'done' ? 'done' : r.task_status ?? 'task'}</Link> : '—'}</td><td className="hide-sm">{r.assignee ?? '—'}</td></tr>)}</tbody>
        </table></div>)}
      <p className="muted" style={{ fontSize: 13 }}>Budget = the BOQ lines on the code (the accepted estimate plus approved variation orders). Committed = issued purchase orders and work orders. Posted = the journal. The alert goes to the holder of the Cost control position, else the Technical Office head, else the Engineering head.</p>
    </>
  );
}

async function Variations() {
  const rows = await variationsByProject();
  if (!rows.length) return <div className="empty card">No variation order yet.</div>;
  return (
    <div className="tw"><table>
      <thead><tr><th>Project</th><th className="num">Contract</th><th className="num">Orders</th><th className="num">Approved</th><th className="num">Approved value</th><th className="num hide-sm">% of contract</th><th className="num">With the client</th><th className="num hide-sm">Declined</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.project_id}><td><Link href={`/variations?project=${r.project_id}`}>{r.code}</Link><span className="muted hide-sm"> · {r.name}</span></td><td className="num mono">{r.contract ? fmt(r.contract) : '—'}</td><td className="num mono">{r.orders}</td><td className="num mono">{r.approved}</td><td className="num mono">{fmt(r.approved_total)}</td>
        <td className="num mono hide-sm">{r.contract ? `${Math.round(r.approved_total / r.contract * 1000) / 10}%` : ''}</td><td className="num mono">{r.pending ? `${r.pending} · ${fmt(r.pending_total)}` : '—'}</td><td className="num mono hide-sm">{r.declined}</td></tr>)}</tbody>
    </table></div>
  );
}

async function Claims() {
  const [client, sub] = await Promise.all([clientRegister(), subRegister()]);
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Client claims</h2>
      {client.length === 0 ? <div className="empty card">No client claim yet.</div> : (
        <div className="tw" style={{ marginBottom: 18 }}><table>
          <thead><tr><th>Project</th><th className="num">Contract</th><th className="num">Claims</th><th className="num">Claimed to date</th><th className="num">Certified</th><th className="num">Invoiced (with VAT)</th><th className="num">Collected</th><th className="num">Retention held by the client</th></tr></thead>
          <tbody>{client.map(r => <tr key={r.project_id}><td><Link href={`/claims?tab=client&project=${r.project_id}`}>{r.code}</Link></td><td className="num mono">{r.contract ? fmt(r.contract) : '—'}</td><td className="num mono">{r.claims}</td><td className="num mono">{fmt(r.claimed)}</td><td className="num mono">{fmt(r.certified)}</td><td className="num mono">{fmt(r.invoiced)}</td><td className="num mono">{fmt(r.collected)}</td><td className="num mono">{fmt(r.retention)}</td></tr>)}</tbody>
        </table></div>)}
      <h2>Subcontractor claims</h2>
      {sub.length === 0 ? <div className="empty card">No subcontractor claim yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th>Subcontractor</th><th className="hide-sm">Work order</th><th className="num">Claims</th><th className="num">Claimed to date</th><th className="num">Certified (priced)</th><th className="num">Paid</th><th className="num">Retention held</th></tr></thead>
          <tbody>{sub.map((r, i) => <tr key={i}><td><Link href={`/claims?project=${r.project_id}`}>{r.code}</Link></td><td dir="auto">{r.vendor}</td><td className="hide-sm mono">{r.wo_no ?? '—'}</td><td className="num mono">{r.claims}</td><td className="num mono">{fmt(r.claimed)}</td><td className="num mono">{fmt(r.certified)}</td><td className="num mono">{fmt(r.paid)}</td><td className="num mono">{fmt(r.retention)}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}

async function Workload() {
  const rows = await toWorkload();
  if (!rows.length) return <div className="empty card">No one holds a Technical Office, site or procurement position yet: Settings &gt; Org chart.</div>;
  return (
    <>
      <div className="tw"><table>
        <thead><tr><th>Engineer</th><th className="hide-sm">Positions</th><th className="num">Open tasks</th><th className="num">Overdue</th><th className="hide-sm">Oldest open since</th><th className="num">Done in 90 days</th><th className="num">Average days to finish</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.user_id}><td>{r.name}</td><td className="hide-sm muted" style={{ fontSize: 12 }}>{r.positions}</td><td className="num mono">{r.open}</td><td className="num mono">{r.overdue ? <span className="pill rejected">{r.overdue}</span> : 0}</td><td className="hide-sm mono">{r.oldest ?? ''}</td><td className="num mono">{r.done_90}</td><td className="num mono">{r.turnaround ?? '—'}</td></tr>)}</tbody>
      </table></div>
      <p className="muted" style={{ fontSize: 13 }}>Tasks assigned to the login or to the employee file count; the pending steps (drawing sets, estimates, claims) show on each person&apos;s Overview.</p>
    </>
  );
}
