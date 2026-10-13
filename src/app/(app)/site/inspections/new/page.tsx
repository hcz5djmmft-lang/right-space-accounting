import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { addDays } from '@/lib/planning-calc';
import { listActivities } from '@/lib/planning';
import { canSite, defaultInspector, siteRows } from '@/lib/site';
import { inspectionAction } from '../../actions';

/** The site engineer asks for an inspection before a work is covered; the inspector gets a task due that day. */
export default async function NewInspection({ searchParams }: { searchParams: Promise<{ project?: string; error?: string }> }) {
  const user = await requireUser();
  const { project = '', error } = await searchParams;
  if (!project) {
    const rows = await siteRows(user);
    return (
      <>
        <div className="head"><div><h1>Ask for inspection</h1><p>Pick the site.</p></div><Link className="btn" href="/site">Site execution</Link></div>
        {rows.length === 0 ? <div className="empty card">No project is in Execution yet.</div> : (
          <form className="card row" style={{ alignItems: 'end' }}>
            <label className="f" style={{ flex: 1 }}><span>Project</span><select className="inp" name="project" required><option value="">Choose…</option>{rows.map(p => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</option>)}</select></label>
            <button className="btn pri">Continue</button>
          </form>)}
      </>);
  }
  const [p] = await sql<{ id: string; code: string; name: string }[]>`select id, code, name from projects where id = ${project} and not is_office`;
  if (!p) notFound();
  if (!(await canSite(user, project))) return <><div className="head"><div><h1>Ask for inspection</h1></div></div><div className="card">Only the project&apos;s site engineer, its manager or the engineers ask for inspections.</div></>;
  const [acts, users, dflt] = await Promise.all([listActivities(project), sql<{ id: string; name: string }[]>`select id, name from users where active order by name`, defaultInspector(project)]);
  return (
    <>
      <div className="head"><div><h1>Ask for inspection · {p.code}</h1><p dir="auto">{p.name !== p.code ? `${p.name} · ` : ''}Before covering a work (rough-in before plastering, waterproofing before tiling…), ask the inspector to check it. They get a task for the day.</p></div>
        <Link className="btn" href="/site">Site execution</Link></div>
      {error && <div className="msg bad">{error}</div>}
      <form action={inspectionAction} className="card">
        <input type="hidden" name="project" value={project} />
        <div className="grid g2">
          <label className="f"><span>What is to be inspected</span><input className="inp" name="title" dir="auto" placeholder="Bathroom 1 plumbing rough-in" required /></label>
          <label className="f"><span>Where</span><input className="inp" name="location" dir="auto" placeholder="Master bathroom" /></label>
          {acts.length > 0 && <label className="f"><span>Work category</span><select className="inp" name="activity" defaultValue=""><option value="">—</option>{acts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
          <label className="f"><span>Inspection day</span><input className="inp" type="date" name="requested_for" defaultValue={addDays(today(), 1)} min={today()} required /></label>
          <label className="f"><span>Inspector</span><select className="inp" name="inspector" defaultValue={dflt ?? ''}><option value="">Choose…</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>The inspector is the project manager unless you pick someone else; photos can be added once the request is saved.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Ask for inspection</button></div>
      </form>
    </>
  );
}
