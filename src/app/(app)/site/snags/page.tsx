import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { canPlan } from '@/lib/planning';
import { SNAG_PRIORITIES, SNAG_STATUSES, TRADES, canSite, label, listSnags, siteRows, snagCounts } from '@/lib/site';
import { snagAction, snagPhotoAction, snagStatusAction } from '../actions';
import { pillOf } from '../ui';

/** The snag list of a project: defects found on site or at the handover walk, who fixes them, and the check once fixed. */
export default async function SnagList({ searchParams }: { searchParams: Promise<{ project?: string; all?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { project = '', all, ok, error } = await searchParams;
  if (!project) {
    const rows = await siteRows(user);
    return (
      <>
        <div className="head"><div><h1>Snag list</h1><p>Pick the site.</p></div><Link className="btn" href="/site">Site execution</Link></div>
        {rows.length === 0 ? <div className="empty card">No project is in Execution yet.</div> : (
          <form className="card row" style={{ alignItems: 'end' }}>
            <label className="f" style={{ flex: 1 }}><span>Project</span><select className="inp" name="project" required><option value="">Choose…</option>{rows.map(p => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</option>)}</select></label>
            <button className="btn pri">Open the snag list</button>
          </form>)}
      </>);
  }
  const [p] = await sql<{ id: string; code: string; name: string }[]>`select id, code, name from projects where id = ${project} and not is_office`;
  if (!p) notFound();
  const [rows, counts, users, vendors, files] = await Promise.all([listSnags({ project, open: !all }), snagCounts(project),
    sql<{ id: string; name: string }[]>`select id, name from users where active order by name`,
    sql<{ id: string; name: string }[]>`select distinct v.id, v.name from parties v join work_orders w on w.vendor_id = v.id where w.project_id = ${project} order by v.name`,
    sql<{ entity_id: string; id: string }[]>`select a.entity_id, a.id from attachments a join snags s on s.id = a.entity_id where a.entity = 'snag' and s.project_id = ${project} order by a.uploaded_at`]);
  const site = await canSite(user, project), eng = canPlan(user);
  return (
    <>
      <div className="head"><div><h1>Snag list · {p.code}</h1><p dir="auto">{p.name !== p.code ? `${p.name} · ` : ''}Every defect found on site or at the handover walk: the site marks it fixed, the engineers verify it. The handover certificate is signed once all are verified.</p></div>
        <div className="row"><Link className="btn" href={`/print/snags/${project}`} target="_blank">Print</Link><Link className="btn" href={all ? `/site/snags?project=${project}` : `/site/snags?project=${project}&all=1`}>{all ? 'Open only' : 'Show verified too'}</Link><Link className="btn" href={`/site/handover/${project}`}>Handover</Link><Link className="btn" href="/site">Site execution</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Open</div><div className="v mono">{counts.open ? <span className="pill rejected">{counts.open}</span> : 0}</div></div>
        <div className="tile"><div className="k">Fixed, to verify</div><div className="v mono">{counts.fixed ? <span className="pill pending">{counts.fixed}</span> : 0}</div></div>
        <div className="tile"><div className="k">Verified</div><div className="v mono">{counts.verified}</div></div>
        <div className="tile"><div className="k">Cancelled</div><div className="v mono">{counts.cancelled}</div></div>
      </div>
      {site && (
        <form action={snagAction} className="card">
          <input type="hidden" name="project" value={project} />
          <h2 style={{ marginTop: 0 }}>Add a snag</h2>
          <div className="grid g3">
            <label className="f"><span>Where (room, wall)</span><input className="inp" name="area" dir="auto" placeholder="Master bedroom, wall by the window" /></label>
            <label className="f" style={{ gridColumn: 'span 2' }}><span>What is wrong</span><input className="inp" name="description" dir="auto" placeholder="Paint cracked above the door" required /></label>
            <label className="f"><span>Trade</span><input className="inp" name="trade" list="trades" dir="auto" /></label>
            <label className="f"><span>Priority</span><select className="inp" name="priority" defaultValue="normal">{SNAG_PRIORITIES.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
            <label className="f"><span>Due</span><input className="inp" type="date" name="due" /></label>
            <label className="f"><span>Who fixes it</span><select className="inp" name="assignee" defaultValue=""><option value="">The site engineer</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            {vendors.length > 0 && <label className="f"><span>Subcontractor</span><select className="inp" name="vendor" defaultValue=""><option value="">—</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
          </div>
          <datalist id="trades">{TRADES.map(t => <option key={t} value={t} />)}</datalist>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Add snag</button></div>
        </form>)}
      {rows.length === 0 ? <div className="empty card">{all ? 'No snag on this project.' : 'No open snag. Every finding is verified.'}</div> : (
        <div className="tw"><table>
          <thead><tr><th>#</th><th>Snag</th><th className="hide-sm">Trade · priority</th><th className="hide-sm">Who</th><th>Due</th><th>Photos</th><th>Status</th>{site && <th></th>}</tr></thead>
          <tbody>{rows.map(s => {
            const ph = files.filter(x => x.entity_id === s.id);
            const done = s.status === 'verified' || s.status === 'cancelled';
            return (
              <tr key={s.id}><td className="mono">S-{s.snag_no}</td>
                <td dir="auto">{s.area ? <b>{s.area} · </b> : ''}{s.description}{s.inspection_no ? <div className="muted" style={{ fontSize: 12 }}>from inspection {s.inspection_no}</div> : null}{s.fixed_note ? <div className="muted" style={{ fontSize: 12 }}>fixed: {s.fixed_note}</div> : null}</td>
                <td className="hide-sm" dir="auto">{s.trade}{s.priority !== 'normal' ? <span className={'pill ' + (s.priority === 'high' ? 'rejected' : '')} style={{ marginLeft: 6 }}>{s.priority}</span> : ''}</td>
                <td className="hide-sm">{s.vendor ? <>{s.vendor}<br /></> : null}{s.assignee ?? ''}</td>
                <td className="mono">{s.due ?? ''}</td>
                <td>{ph.map((x, i) => <a key={x.id} href={`/files/${x.id}`} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>photo {i + 1}</a>)}{site && !done && <form action={snagPhotoAction.bind(null, project, s.id)} className="row" style={{ gap: 4, marginTop: 4 }}><input type="file" name="file" accept="image/*" capture="environment" style={{ fontSize: 12, maxWidth: 150 }} required /><button className="btn sm">Add</button></form>}</td>
                <td><span className={'pill ' + pillOf(s.status)}>{label(SNAG_STATUSES, s.status)}</span><div className="muted" style={{ fontSize: 12 }}>{s.status === 'fixed' ? `${s.fixed_by_name ?? ''} · ${s.fixed_at}` : s.status === 'verified' ? `${s.verified_by_name ?? ''} · ${s.verified_at}` : `${s.found_by_name ?? ''} · ${s.found_at}`}</div></td>
                {site && <td><span className="row" style={{ gap: 6 }}>
                  {s.status === 'open' && <form action={snagStatusAction.bind(null, s.id, 'fixed', project)} className="row" style={{ gap: 4 }}><input className="inp" name="note" placeholder="How (optional)" dir="auto" style={{ width: 120 }} /><button className="btn sm pri">Fixed</button></form>}
                  {s.status === 'fixed' && <form action={snagStatusAction.bind(null, s.id, 'verified', project)}><button className="btn sm pri">Verified</button></form>}
                  {(s.status === 'fixed' || s.status === 'verified') && <form action={snagStatusAction.bind(null, s.id, 'open', project)}><button className="btn sm">Reopen</button></form>}
                  {!done && eng && <form action={snagStatusAction.bind(null, s.id, 'cancelled', project)}><button className="btn sm">Cancel</button></form>}</span></td>}
              </tr>);
          })}</tbody>
        </table></div>)}
      <p className="muted" style={{ fontSize: 13 }}>A failed inspection lands here by itself, assigned to the engineer who asked for it.</p>
    </>
  );
}
