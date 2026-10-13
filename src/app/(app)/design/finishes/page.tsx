import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { canDesign, listFinishes } from '@/lib/design';
import { addFinishAction, decideFinishAction, removeFinishAction } from '../actions';

export default async function Finishes({ searchParams }: { searchParams: Promise<{ project?: string; saved?: string; error?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { project, saved, error } = await searchParams;
  if (!project) notFound();
  const [p] = await sql<{ id: string; code: string; name: string }[]>`select id, code, name from projects where id = ${project} and not is_office`;
  if (!p) notFound();
  const rows = await listFinishes(p.id);
  const edit = canDesign(user);
  return (
    <>
      <div className="head"><div><h1>{p.code} · Finishes & materials</h1><p dir="auto">{p.name} · what is chosen with the client: floors, walls, ceilings, kitchen, bathrooms, doors…</p></div>
        <div className="row"><Link className="btn" href="/design">All design</Link><Link className="btn" href={`/cost-centers/${p.id}`}>Project page</Link></div></div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      {edit && (
        <form action={addFinishAction.bind(null, p.id)} className="card grid g4" style={{ alignItems: 'end' }}>
          <label className="f"><span>Area (room)</span><input className="inp" name="area" dir="auto" placeholder="Reception" required /></label>
          <label className="f"><span>Item</span><input className="inp" name="item" dir="auto" placeholder="Floor" required /></label>
          <label className="f"><span>Material / finish</span><input className="inp" name="material" dir="auto" placeholder="Marble, Carrara" /></label>
          <label className="f"><span>Brand / reference</span><input className="inp" name="ref" dir="auto" /></label>
          <label className="f" style={{ gridColumn: '1 / -2' }}><span>Note</span><input className="inp" name="note" dir="auto" /></label>
          <button className="btn pri">Add to the list</button>
        </form>)}
      <div className="tw"><table>
        <thead><tr><th>Area</th><th>Item</th><th>Material</th><th className="hide-sm">Reference</th><th>Client</th><th className="hide-sm">Note</th>{edit && <th></th>}</tr></thead>
        <tbody>{rows.length === 0 && <tr><td colSpan={7} className="muted">Nothing on the list yet.</td></tr>}
          {rows.map(r => (
            <tr key={r.id}><td dir="auto">{r.area}</td><td dir="auto">{r.item}</td><td dir="auto">{r.material}</td><td className="hide-sm" dir="auto">{r.ref}</td>
              <td>{r.status === 'approved' ? <span className="pill posted">approved{r.decided_at ? ` · ${r.decided_at}` : ''}</span> : r.status === 'rejected' ? <span className="pill rejected">rejected</span> : <span className="pill pending">proposed</span>}</td>
              <td className="hide-sm" dir="auto">{r.note}</td>
              {edit && <td><span className="row" style={{ gap: 6 }}>
                {r.status !== 'approved' && <form action={decideFinishAction.bind(null, p.id, r.id, true)}><button className="btn sm">Client approved</button></form>}
                {r.status === 'proposed' && <form action={decideFinishAction.bind(null, p.id, r.id, false)}><button className="btn sm">Rejected</button></form>}
                {r.status === 'proposed' && <form action={removeFinishAction.bind(null, p.id, r.id)}><button className="lnk bad" style={{ fontSize: 12 }}>remove</button></form>}</span></td>}
            </tr>))}
        </tbody></table></div>
    </>
  );
}
