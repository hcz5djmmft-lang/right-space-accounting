import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { today } from '@/lib/dates';
import { siteStock, stockIssues, stockProjects } from '@/lib/procurement';
import { stockIssueAction } from '../procurement-actions';

const num = (v: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(v);

/** Site stock per project: delivered on the project's POs, used by the site, on hand. */
export default async function SiteStockPage({ searchParams }: { searchParams: Promise<{ project?: string; error?: string; ok?: string }> }) {
  await requireUser();
  const { project, error, ok } = await searchParams;
  const projects = await stockProjects();
  const cur = projects.find(p => p.id === project) ?? projects[0] ?? null;
  const [rows, issues] = cur ? await Promise.all([siteStock(cur.id), stockIssues(cur.id)]) : [[], []];
  return (
    <>
      <div className="head"><div><h1>Site stock</h1><p>What each project&apos;s site holds: delivered on its purchase orders, less what the site engineer records as used.</p></div>
        <Link className="btn" href="/purchasing">Purchasing</Link></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {projects.length === 0 ? <div className="empty card">No deliveries recorded yet. Record them on the purchase order.</div> : (
        <>
          <div className="tabs">{projects.map(p => <Link key={p.id} href={`/purchasing/stock?project=${p.id}`} className={cur?.id === p.id ? 'on' : ''}>{p.code}{p.on_hand ? ` · ${p.on_hand}` : ''}</Link>)}</div>
          {cur && (
            <>
              <div className="card">
                <h2 style={{ marginTop: 0 }}>{cur.code} <span className="muted" style={{ fontWeight: 400 }} dir="auto">{cur.name !== cur.code ? cur.name : ''}</span></h2>
                <div className="tw"><table>
                  <thead><tr><th>Material</th><th>Unit</th><th className="num">Delivered</th><th className="num">Used</th><th className="num">On hand</th></tr></thead>
                  <tbody>{rows.map(r => <tr key={r.material_id}><td dir="auto">{r.name}{r.name_ar && r.name_ar !== r.name ? <span className="muted"> · {r.name_ar}</span> : null}</td><td dir="auto">{r.unit}</td>
                    <td className="num mono">{num(r.delivered)}</td><td className="num mono">{num(r.used)}</td><td className="num mono"><b>{num(r.on_hand)}</b></td></tr>)}</tbody>
                </table></div>
              </div>
              <form action={stockIssueAction.bind(null, cur.id)} className="card grid g4">
                <h2 style={{ gridColumn: '1 / -1', margin: 0 }}>Record what the site used</h2>
                <label className="f"><span>Material</span><select className="inp" name="material" required>{rows.filter(r => r.on_hand > 0).map(r => <option key={r.material_id} value={r.material_id}>{r.name} · {num(r.on_hand)} {r.unit}</option>)}</select></label>
                <label className="f"><span>Quantity</span><input className="inp mono" name="qty" inputMode="decimal" required /></label>
                <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} required /></label>
                <label className="f"><span>Note</span><input className="inp" name="note" dir="auto" placeholder="Where it went" /></label>
                <div className="row" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}><button className="btn pri">Record use</button></div>
              </form>
              {issues.length > 0 && <div className="card"><h2 style={{ marginTop: 0 }}>Used recently</h2><div className="log">{issues.map((s, i) => <div key={i}>{s.date} · {s.who ?? '—'} · {s.name}: {num(s.qty)} {s.unit}{s.note ? ` — ${s.note}` : ''}</div>)}</div></div>}
            </>)}
        </>)}
    </>
  );
}
