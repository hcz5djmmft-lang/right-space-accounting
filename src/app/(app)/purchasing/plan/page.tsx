import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
const num = (v: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(v);
import { hasRole } from '@/lib/roles';
import { CALCULATORS } from '@/lib/qs-calc';
import { isProcurement } from '@/lib/purchasing';
import { planProjects, planRows } from '@/lib/procurement';
import { planRequestAction } from '../procurement-actions';

/** The material plan per project (from the accepted estimate, dated by the schedule's baseline), raised into purchase requests without retyping. */
export default async function MaterialPlanPage({ searchParams }: { searchParams: Promise<{ project?: string; error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { project, error, ok } = await searchParams;
  const [projects, proc] = await Promise.all([planProjects(), isProcurement(user)]);
  const may = proc || hasRole(user, 'finance', 'engineering', 'projects');
  const cur = projects.find(p => p.id === project) ?? null;
  const rows = cur ? await planRows(cur.id) : [];
  const open = rows.filter(r => !r.request_id);
  return (
    <>
      <div className="head"><div><h1>Material plan</h1><p>Every material the accepted estimate counted, per project, with the date it is needed on site (a week before its work starts, from the schedule&apos;s baseline). Tick lines and raise a purchase request: the materials come across as they are, nothing is retyped.</p></div>
        <Link className="btn" href="/purchasing">Purchase requests</Link></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {projects.length === 0 ? <div className="empty card">No material plan yet. A project gets one when the client accepts its estimate (QS and pricing).</div> : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="num">Lines</th><th className="num">Requested</th><th>Next needed</th><th className="num hide-sm">Value</th><th></th></tr></thead>
          <tbody>{projects.map(p => <tr key={p.id} style={cur?.id === p.id ? { background: 'var(--soft, #f6f6f4)' } : undefined}><td><Link href={`/cost-centers/${p.id}`}>{p.code}</Link><div className="muted" style={{ fontSize: 12 }} dir="auto">{p.name !== p.code ? p.name : ''}</div></td>
            <td className="num mono">{p.lines}</td><td className="num mono">{p.requested}</td><td className="mono">{p.next_needed ?? <span className="muted">not dated</span>}</td><td className="num mono hide-sm">{fmt(p.amount)}</td>
            <td><Link className="btn sm" href={`/purchasing/plan?project=${p.id}`}>Open</Link></td></tr>)}</tbody>
        </table></div>)}
      {cur && (
        <form action={planRequestAction.bind(null, cur.id)} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{cur.code} · material plan</h2>{may && open.length > 0 && <button className="btn pri">Raise a purchase request for the ticked lines</button>}</div>
          <div className="tw" style={{ marginTop: 8 }}><table>
            <thead><tr>{may && <th></th>}<th>Needed by</th><th>Calculator</th><th>No.</th><th>Material</th><th className="hide-sm">Size / brand</th><th>Unit</th><th className="num">Qty</th><th className="num hide-sm">Price</th><th className="num">Amount</th><th>Request</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id}>{may && <td>{!r.request_id && <input type="checkbox" name="line" value={r.id} defaultChecked={open.length <= 40} />}</td>}
              <td className="mono">{r.needed_by ?? <span className="muted">—</span>}</td><td>{CALCULATORS.find(c => c[0] === r.calculator)?.[1] ?? r.calculator}</td><td className="mono">{r.no}</td>
              <td dir="auto" style={{ fontSize: 13, maxWidth: 420 }}>{r.description}</td><td className="hide-sm muted" dir="auto" style={{ fontSize: 12 }}>{[r.size, r.brand].filter(Boolean).join(' · ')}</td><td dir="auto">{r.unit}</td>
              <td className="num mono">{num(r.qty)}</td><td className="num mono hide-sm">{fmt(r.price)}</td><td className="num mono">{fmt(r.amount)}</td>
              <td>{r.request_id ? <Link href={`/purchasing/${r.request_id}`} className="mono">{r.po_no ?? r.request_no}</Link> : <span className="muted">not yet</span>}</td></tr>)}</tbody>
          </table></div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{open.length} line{open.length === 1 ? '' : 's'} still to order{rows.length - open.length ? `, ${rows.length - open.length} on a request or PO` : ''}. Untick what is not ordered now.</p>
        </form>)}
    </>
  );
}
