import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { canDesign, listSamples } from '@/lib/design';
import { listProjects } from '@/lib/queries';
import { addSampleAction, decideSampleAction, photoAction, sendSampleAction } from './actions';

const pill = (s: string) => (s === 'approved' ? 'posted' : s === 'rejected' ? 'rejected' : s === 'sent' ? 'pending' : '');
const LABEL: Record<string, string> = { proposed: 'proposed', sent: 'with the client', approved: 'approved', rejected: 'rejected' };

/**
 * Material and sample approvals: every finish chosen with the client, the sample sent (with its photo) and the client's answer,
 * so nothing is bought before the client approves it. Shared with Design > Finishes & materials.
 */
export default async function Samples({ searchParams }: { searchParams: Promise<{ project?: string; all?: string; ok?: string; error?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { project = '', all, ok, error } = await searchParams;
  const open = !all;
  const [rows, projects] = await Promise.all([listSamples({ project: project || undefined, open }), listProjects()]);
  const ids = rows.map(r => r.id);
  const photos = ids.length ? await sql<{ entity_id: string; id: string; file_name: string }[]>`select entity_id, id, file_name from attachments where entity = 'finish' and entity_id in ${sql(ids)} order by uploaded_at` : [];
  const edit = canDesign(user);
  const p = projects.find(x => x.id === project);
  return (
    <>
      <div className="head"><div><h1>Samples and material approvals</h1><p>Each finish or material goes to the client as a sample (photo attached) before Procurement buys it. The list shows what still waits for the client first.</p></div>
        <div className="row">{p && <Link className="btn" href={`/design/finishes?project=${p.id}`}>Finishes of {p.code}</Link>}<Link className="btn" href={`/samples?${new URLSearchParams({ ...(project ? { project } : {}), ...(open ? { all: '1' } : {}) })}`}>{open ? 'Show decided too' : 'Open only'}</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <form className="card row" style={{ alignItems: 'end' }}>
        {all && <input type="hidden" name="all" value="1" />}
        <label className="f" style={{ flex: 1 }}><span>Project</span><select className="inp" name="project" defaultValue={project}><option value="">All projects</option>{projects.filter(x => !x.is_office).map(x => <option key={x.id} value={x.id}>{x.code}{x.name !== x.code ? ` · ${x.name}` : ''}</option>)}</select></label>
        <button className="btn">Show</button>
      </form>
      {edit && p && (
        <form action={addSampleAction.bind(null, p.id)} className="card grid g4" style={{ alignItems: 'end' }}>
          <label className="f"><span>Area (room)</span><input className="inp" name="area" dir="auto" placeholder="Reception" required /></label>
          <label className="f"><span>Item</span><input className="inp" name="item" dir="auto" placeholder="Floor" required /></label>
          <label className="f"><span>Material / finish</span><input className="inp" name="material" dir="auto" placeholder="Marble, Carrara" /></label>
          <label className="f"><span>Brand / reference</span><input className="inp" name="ref" dir="auto" /></label>
          <label className="f"><span>Sample ref. (code on the sample)</span><input className="inp" name="sample_ref" dir="auto" /></label>
          <label className="f"><span>Photo</span><input className="inp" type="file" name="file" accept="image/*,application/pdf" capture="environment" /></label>
          <label className="f"><span>Note</span><input className="inp" name="note" dir="auto" /></label>
          <button className="btn pri">Add sample</button>
        </form>)}
      {rows.length === 0 ? <div className="empty card">{open ? 'Nothing waits for the client.' : 'No sample on the list.'}{edit && !p ? ' Pick a project above to add one.' : ''}</div> : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th>Area · item</th><th>Material</th><th className="hide-sm">Sample ref.</th><th>Photos</th><th>Client</th>{edit && <th></th>}</tr></thead>
          <tbody>{rows.map(r => {
            const ph = photos.filter(x => x.entity_id === r.id);
            return (
              <tr key={r.id}><td><Link href={`/samples?project=${r.project_id}${all ? '&all=1' : ''}`}>{r.code}</Link></td><td dir="auto"><b>{r.area}</b> · {r.item}</td><td dir="auto">{r.material}{r.ref ? <span className="muted"> · {r.ref}</span> : null}</td><td className="hide-sm" dir="auto">{r.sample_ref}</td>
                <td>{ph.map((x, i) => <a key={x.id} href={`/files/${x.id}`} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>photo {i + 1}</a>)}{edit && r.status !== 'approved' && <form action={photoAction.bind(null, project, r.id)} className="row" style={{ gap: 4, marginTop: 4 }}><input type="file" name="file" accept="image/*,application/pdf" capture="environment" style={{ fontSize: 12, maxWidth: 150 }} required /><button className="btn sm">Add</button></form>}</td>
                <td><span className={'pill ' + pill(r.status)}>{LABEL[r.status] ?? r.status}{r.status === 'sent' && r.sent_at ? ` · ${r.sent_at}` : r.decided_at ? ` · ${r.decided_at}` : ''}</span>{r.note && <div className="muted" style={{ fontSize: 12 }} dir="auto">{r.note}</div>}</td>
                {edit && <td><span className="row" style={{ gap: 6 }}>
                  {['proposed', 'rejected'].includes(r.status) && <form action={sendSampleAction.bind(null, project, r.id)} className="row" style={{ gap: 4 }}><input className="inp" name="sample_ref" placeholder="Sample ref." defaultValue={r.sample_ref} style={{ width: 110 }} /><button className="btn sm pri">Send to client</button></form>}
                  {r.status === 'sent' && <form action={decideSampleAction.bind(null, project, r.id, true)}><button className="btn sm pri">Client approved</button></form>}
                  {r.status === 'sent' && <form action={decideSampleAction.bind(null, project, r.id, false)} className="row" style={{ gap: 4 }}><input className="inp" name="note" placeholder="Why" style={{ width: 110 }} /><button className="btn sm bad">Rejected</button></form>}</span></td>}
              </tr>);
          })}</tbody>
        </table></div>)}
    </>
  );
}
