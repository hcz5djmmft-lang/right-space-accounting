import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { METHOD_LABEL, collectionsByProject, moneyReceived, receivedByType } from '@/lib/collections';

/** Collections by project: what each client was invoiced and paid (design, fit-out, furniture), and every receipt. */
export default async function Collections({ searchParams }: { searchParams: Promise<{ project?: string; from?: string; to?: string }> }) {
  await requireUser('finance');
  const { project = '', from = '', to = '' } = await searchParams;
  const [byType, byProject, rows, projects] = await Promise.all([
    receivedByType(from, to), collectionsByProject(), moneyReceived({ project, from, to }),
    sql<{ id: string; code: string }[]>`select id, code from projects where not is_office order by code`,
  ]);
  const period = from || to ? `${from || 'start'} to ${to || 'today'}` : 'all dates';
  const shownProjects = project ? byProject.filter(p => p.id === project) : byProject;
  const tot = (k: 'invoiced' | 'received' | 'open') => shownProjects.reduce((s, p) => s + p[k], 0);
  return (
    <>
      <div className="head"><div><h1>Collections</h1><p>Money collected from clients by project: design, fit-out and furniture, in cash or by bank transfer, each with a printed receipt.</p></div>
        <div className="row"><Link className="btn pri" href="/receipts/new">Money received</Link><Link className="btn" href="/sales-invoices/new">New invoice</Link><Link className="btn" href="/sales-invoices?tab=open">Not yet received</Link><Link className="btn" href="/collections/follow-up">Follow-up</Link></div></div>
      <form className="row card" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f"><span>Project</span><select className="inp" name="project" defaultValue={project}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
        <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
        <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
        <button className="btn">Show</button>
      </form>
      <div className="tiles">
        {byType.types.map(t => <div className="tile" key={t.id}><div className="k">{t.name} · {period}</div><div className="v mono">{fmt(t.amount)}</div></div>)}
        <div className="tile"><div className="k">Total collected · {period}</div><div className="v mono">{fmt(byType.total)}</div></div>
      </div>

      <div className="card">
        <h2>By project</h2>
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="hide-sm">Client</th><th className="num hide-sm">Contract</th><th className="num">Invoiced</th><th className="num">Collected</th><th className="num">Still to receive</th></tr></thead>
          <tbody>{shownProjects.map(p => (
            <tr key={p.id}><td><Link href={`/collections?project=${p.id}`}>{p.code}</Link>{p.name !== p.code ? <span className="muted"> · {p.name}</span> : null}</td><td className="hide-sm" dir="auto">{p.client ?? '—'}</td>
              <td className="num hide-sm">{p.contract ? fmt(p.contract) : '—'}</td><td className="num">{fmt(p.invoiced)}</td><td className="num">{fmt(p.received)}</td>
              <td className="num" style={p.open > 0.004 ? { color: 'var(--bad)' } : undefined}>{fmt(p.open)}</td></tr>))}
            {shownProjects.length === 0 && <tr><td colSpan={6} className="muted">No projects yet.</td></tr>}</tbody>
          <tfoot><tr><td colSpan={3}>Total</td><td className="num">{fmt(tot('invoiced'))}</td><td className="num">{fmt(tot('received'))}</td><td className="num">{fmt(tot('open'))}</td></tr></tfoot>
        </table></div>
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Collected counts receipts against invoices, advances received for the project and collections recorded straight to a revenue code.</p>
      </div>

      <h2>Money received · {period}</h2>
      {rows.length === 0 ? <div className="empty card">Nothing received{project || from || to ? ' for this selection' : ' yet'}. Use Money received when a client pays.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Date</th><th>Receipt</th><th>Client</th><th className="hide-sm">Project</th><th className="hide-sm">Type</th><th>How</th><th className="hide-sm">Into</th><th className="num">EGP</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.kind + r.id} style={r.status === 'void' ? { opacity: .55, textDecoration: 'line-through' } : undefined}>
              <td className="mono">{r.date}</td>
              <td className="mono"><Link href={r.kind === 'receipt' ? `/receipts/${r.id}` : `/entries/${r.id}`}>{r.no}</Link>{r.invoices ? <span className="muted"> · {r.invoices}</span> : null}</td>
              <td dir="auto">{r.customer ?? '—'}</td><td className="hide-sm">{r.project_code ?? '—'}</td>
              <td className="hide-sm">{r.types ?? (r.kind === 'receipt' ? 'Advance' : 'Other')}</td>
              <td>{METHOD_LABEL[r.method]}</td><td className="hide-sm mono">{r.account ?? ''}</td>
              <td className="num">{fmt(r.amount)}{r.wht > 0 ? <span className="muted"> (WHT {fmt(r.wht)})</span> : null}</td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
