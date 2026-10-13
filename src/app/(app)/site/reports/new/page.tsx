import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { listActivities } from '@/lib/planning';
import { MANPOWER_ROWS, TRADES, WEATHER, canSite, getReport, listManpower, listWork, reportFor, siteRows } from '@/lib/site';
import { reportAction } from '../../actions';

/** The daily site report from the phone: manpower per trade, what was worked on, materials received, issues; photos are added once the draft is saved. */
export default async function NewReport({ searchParams }: { searchParams: Promise<{ project?: string; day?: string; edit?: string; error?: string }> }) {
  const user = await requireUser();
  const { project = '', day = today(), edit = '', error } = await searchParams;
  const r = edit ? await getReport(edit) : null;
  if (edit && !r) notFound();
  const projectId = r?.project_id ?? project;
  if (!projectId) {
    const rows = await siteRows(user);
    return (
      <>
        <div className="head"><div><h1>Site report</h1><p>Pick the site and the day.</p></div><Link className="btn" href="/site">Site execution</Link></div>
        {rows.length === 0 ? <div className="empty card">No project is in Execution yet.</div> : (
          <form className="card grid g3" style={{ alignItems: 'end' }}>
            <label className="f"><span>Project</span><select className="inp" name="project" required><option value="">Choose…</option>{rows.map(p => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</option>)}</select></label>
            <label className="f"><span>Day</span><input className="inp" type="date" name="day" defaultValue={day} max={today()} required /></label>
            <button className="btn pri">Continue</button>
          </form>)}
      </>);
  }
  if (!r) {
    const existing = await reportFor(projectId, day);
    if (existing) redirect(`/site/reports/${existing.id}`);
  }
  if (!(await canSite(user, projectId))) return <><div className="head"><div><h1>Site report</h1></div></div><div className="card">Only the project&apos;s site engineer, its manager or the engineers write the site report.</div></>;
  const [[p], acts, man, work] = await Promise.all([
    sql<{ code: string; name: string }[]>`select code, name from projects where id = ${projectId}`,
    listActivities(projectId), r ? listManpower(r.id) : [], r ? listWork(r.id) : []]);
  if (!p) notFound();
  const worked = new Set(work.map(w => w.activity_id));
  return (
    <>
      <div className="head"><div><h1>{r ? `${r.no} · edit` : 'Site report'} · {p.code}</h1><p dir="auto">{p.name !== p.code ? `${p.name} · ` : ''}{r ? r.day : day}</p></div>
        <Link className="btn" href={r ? `/site/reports/${r.id}` : '/site'}>{r ? 'Back to the report' : 'Site execution'}</Link></div>
      {error && <div className="msg bad">{error}</div>}
      <form action={reportAction} className="card">
        <input type="hidden" name="project" value={projectId} />
        {r && <input type="hidden" name="id" value={r.id} />}
        <div className="grid g3">
          <label className="f"><span>Day</span><input className="inp" type="date" name="day" defaultValue={r?.day ?? day} max={today()} required /></label>
          <label className="f"><span>Weather</span><select className="inp" name="weather" defaultValue={r?.weather ?? ''}><option value="">—</option>{WEATHER.map(w => <option key={w} value={w}>{w}</option>)}{r?.weather && !WEATHER.includes(r.weather) ? <option value={r.weather}>{r.weather}</option> : null}</select></label>
          <label className="f"><span>Visitors (client, consultant…)</span><input className="inp" name="visitors" dir="auto" defaultValue={r?.visitors ?? ''} /></label>
        </div>
        <h2>Manpower on site</h2>
        <div className="tw"><table>
          <thead><tr><th>Trade</th><th className="num">People</th><th className="num">Hours each</th></tr></thead>
          <tbody>{Array.from({ length: MANPOWER_ROWS }, (_, i) => { const m = man[i]; return (
            <tr key={i}><td><input className="inp" name={`trade_${i}`} list="trades" defaultValue={m?.trade ?? ''} dir="auto" placeholder={i === 0 ? 'Plumbing' : ''} /></td>
              <td className="num"><input className="inp" type="number" inputMode="numeric" min={0} step={1} name={`head_${i}`} defaultValue={m?.headcount ?? ''} style={{ width: 80, textAlign: 'right' }} /></td>
              <td className="num"><input className="inp" type="number" inputMode="decimal" min={0} max={24} step={0.5} name={`hours_${i}`} defaultValue={m?.hours ?? 8} style={{ width: 80, textAlign: 'right' }} /></td></tr>); })}</tbody>
        </table></div>
        <datalist id="trades">{TRADES.map(t => <option key={t} value={t} />)}</datalist>
        {acts.length > 0 && <>
          <h2>Worked on today</h2>
          <div className="grid g2" style={{ marginBottom: 10 }}>{acts.map(a => <label key={a.id} className="row" style={{ gap: 8, alignItems: 'center' }}><input type="checkbox" name="activity" value={a.id} defaultChecked={worked.has(a.id)} /><span dir="auto">{a.name}</span><span className="muted mono" style={{ fontSize: 12 }}>{a.progress} %</span></label>)}</div>
        </>}
        <label className="f"><span>Work done today</span><textarea className="inp" name="work_done" rows={4} dir="auto" defaultValue={r?.work_done ?? ''} placeholder="What was done, where, by whom" /></label>
        <div className="grid g2">
          <label className="f"><span>Materials received</span><textarea className="inp" name="materials" rows={2} dir="auto" defaultValue={r?.materials ?? ''} /></label>
          <label className="f"><span>Issues, delays, safety</span><textarea className="inp" name="issues" rows={2} dir="auto" defaultValue={r?.issues ?? ''} /></label>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>{r ? 'Photos are added on the report page.' : 'Save the draft first: the photo buttons appear on the report, then send it.'}</p>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" name="submit" value="0">Save draft</button>
          {r?.status !== 'submitted' && <button className="btn pri" name="submit" value="1">Send the report</button>}
          {r?.status === 'submitted' && <button className="btn pri" name="submit" value="0">Save changes</button>}
        </div>
      </form>
    </>
  );
}
