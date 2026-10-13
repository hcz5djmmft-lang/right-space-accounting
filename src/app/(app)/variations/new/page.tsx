import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { today } from '@/lib/dates';
import { listProjects } from '@/lib/queries';
import { projectAccounts } from '@/lib/boq';
import { VO_ROWS, getVariation, getVariationLines } from '@/lib/claims';
import { variationAction } from '../actions';

/** A variation order: the project, a title, the priced lines with the GL code each adds budget to. `?edit=` reopens a draft or a declined one. */
export default async function NewVariation({ searchParams }: { searchParams: Promise<{ edit?: string; project?: string; error?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const cur = sp.edit ? await getVariation(sp.edit) : null;
  if (sp.edit && !cur) notFound();
  const projectId = cur?.project_id ?? sp.project ?? '';
  const projects = (await listProjects()).filter(p => !p.is_office);
  if (!projectId) {
    return (
      <>
        <div className="head"><div><h1>New variation order</h1><p>Pick the project the change belongs to.</p></div><Link className="btn" href="/variations">Variation orders</Link></div>
        {sp.error && <div className="msg bad">{sp.error}</div>}
        <form className="card row" style={{ alignItems: 'end' }}>
          <label className="f" style={{ flex: 1 }}><span>Project</span><select className="inp" name="project" required defaultValue=""><option value="">Select…</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</option>)}</select></label>
          <button className="btn pri">Continue</button>
        </form>
      </>
    );
  }
  const project = projects.find(p => p.id === projectId);
  if (!project) notFound();
  const [codes, lines] = await Promise.all([projectAccounts(projectId), cur ? getVariationLines(cur.id) : []]);
  const rows = [...lines, ...Array.from({ length: Math.max(0, VO_ROWS - lines.length) }, () => ({ description: '', unit: '', qty: '' as number | string, rate: '' as number | string, account: null as string | null }))].slice(0, VO_ROWS);
  return (
    <>
      <div className="head"><div><h1>{cur ? `Edit ${cur.no}` : 'New variation order'}</h1><p dir="auto">{project.code}{project.name !== project.code ? ` · ${project.name}` : ''}. Describe and price the change; a negative quantity takes work out. The GL code is where the approved line adds budget.</p></div>
        <Link className="btn" href="/variations">Variation orders</Link></div>
      {sp.error && <div className="msg bad">{sp.error}</div>}
      <form action={variationAction} className="card">
        {cur && <input type="hidden" name="id" value={cur.id} />}
        <input type="hidden" name="project" value={projectId} />
        <div className="grid g3">
          <label className="f" style={{ gridColumn: 'span 2' }}><span>Title</span><input className="inp" name="title" dir="auto" required defaultValue={cur?.title ?? ''} placeholder="Extra kitchen cabinets and a second sink" /></label>
          <label className="f"><span>Date</span><input className="inp" type="date" name="date" required defaultValue={cur?.date ?? today()} /></label>
          <label className="f"><span>Client reference (email, letter, meeting)</span><input className="inp" name="client_ref" dir="auto" defaultValue={cur?.client_ref ?? ''} /></label>
          <label className="f" style={{ gridColumn: 'span 2' }}><span>Notes</span><input className="inp" name="notes" dir="auto" defaultValue={cur?.notes ?? ''} /></label>
        </div>
        <div className="tw" style={{ marginTop: 8 }}><table>
          <thead><tr><th>Description</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate (client)</th><th>GL code</th></tr></thead>
          <tbody>{rows.map((l, i) => <tr key={i}><td><input className="inp" name={`desc_${i}`} dir="auto" defaultValue={l.description} style={{ minWidth: 220 }} /></td><td><input className="inp" name={`unit_${i}`} defaultValue={l.unit} style={{ width: 70 }} /></td>
            <td className="num"><input className="inp mono" name={`qty_${i}`} inputMode="decimal" defaultValue={l.qty} style={{ width: 85, textAlign: 'right' }} /></td><td className="num"><input className="inp mono" name={`rate_${i}`} inputMode="decimal" defaultValue={l.rate} style={{ width: 110, textAlign: 'right' }} /></td>
            <td><select className="inp mono" name={`acc_${i}`} defaultValue={l.account ?? ''}><option value="">—</option>{codes.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></td></tr>)}</tbody>
        </table></div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" name="submit" value="0">Save draft</button><button className="btn pri" name="submit" value="1">Send to the client</button></div>
      </form>
    </>
  );
}
