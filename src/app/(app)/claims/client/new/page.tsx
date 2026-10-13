import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { today } from '@/lib/dates';
import { fmt } from '@/lib/money';
import { listProjects } from '@/lib/queries';
import { boqForClaim, clientClaimTemplate, getClientClaim } from '@/lib/claims';
import { clientClaimAction } from '../../actions';

/** A client progress claim: the % done of every BOQ line (cumulative; the previous claim's % is the floor), the retention and the advance recovered. */
export default async function NewClientClaim({ searchParams }: { searchParams: Promise<{ edit?: string; project?: string; error?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const cur = sp.edit ? await getClientClaim(sp.edit) : null;
  if (sp.edit && !cur) notFound();
  const projectId = cur?.project_id ?? sp.project ?? '';
  const projects = (await listProjects()).filter(p => !p.is_office);
  if (!projectId) {
    return (
      <>
        <div className="head"><div><h1>New client claim</h1><p>Pick the project. Its BOQ (the accepted estimate, plus the approved variation orders) is the base of the claim.</p></div><Link className="btn" href="/claims?tab=client">Claims</Link></div>
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
  const t = cur ? null : await clientClaimTemplate(projectId);
  const lines = cur ? await boqForClaim(projectId, cur.id) : t!.lines;
  const prev = t?.prev;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return (
    <>
      <div className="head"><div><h1>{cur ? `Edit ${cur.no}` : 'New client claim'}</h1>
        <p dir="auto">{project.code}{project.name !== project.code ? ` · ${project.name}` : ''} · claim {cur?.claim_no ?? t!.claim_no}. Type the cumulative % done of each BOQ line; lines not progressed keep the previous %. The amount is the % of the BOQ line.</p></div>
        <Link className="btn" href="/claims?tab=client">Claims</Link></div>
      {sp.error && <div className="msg bad">{sp.error}</div>}
      {!lines.length && <div className="msg bad">{project.code} has no BOQ yet: accept the estimate (QS and pricing) or upload the BOQ on the project page first.</div>}
      {prev?.claimId && <div className="msg">Earlier claims: cumulative work certified {fmt(prev.gross)}, retention held {fmt(prev.retention)}, advance recovered {fmt(prev.advance)}.</div>}
      <form action={clientClaimAction} className="card">
        {cur && <input type="hidden" name="id" value={cur.id} />}
        <input type="hidden" name="project" value={projectId} />
        <div className="grid g3">
          <label className="f"><span>Date</span><input className="inp" type="date" name="date" required defaultValue={cur?.date ?? today()} /></label>
          <label className="f"><span>Retention % the client holds</span><input className="inp mono" name="retention_pct" inputMode="decimal" defaultValue={cur?.retention_pct ?? t!.retention_pct} /></label>
          <label className="f"><span>Advance recovered on this claim</span><input className="inp mono" name="advance" inputMode="decimal" defaultValue={cur?.advance ?? 0} /></label>
        </div>
        <div className="tw" style={{ marginTop: 8 }}><table>
          <thead><tr><th>Item</th><th>Description</th><th className="hide-sm">Unit</th><th className="num hide-sm">Qty</th><th className="num">BOQ amount</th><th className="num">Previous %</th><th className="num">% done</th></tr></thead>
          <tbody>{lines.map(l => <tr key={l.id}><td className="mono">{l.item_no}{l.vo_no ? <span className="pill pending" style={{ marginLeft: 4 }}>VO</span> : null}</td><td dir="auto">{l.description}</td><td className="hide-sm">{l.unit}</td><td className="num mono hide-sm">{l.qty}</td><td className="num mono">{fmt(l.amount)}</td>
            <td className="num mono">{l.prev_pct}%</td><td className="num"><input className="inp mono" name={`pct_${l.id}`} inputMode="decimal" defaultValue={l.pct} min={l.prev_pct} style={{ width: 75, textAlign: 'right' }} /></td></tr>)}
            <tr className="tot"><td colSpan={4}><b>BOQ total</b></td><td className="num mono"><b>{fmt(total)}</b></td><td colSpan={2}></td></tr></tbody>
        </table></div>
        <label className="f" style={{ marginTop: 8 }}><span>Notes</span><textarea className="inp" name="notes" dir="auto" rows={2} defaultValue={cur?.notes ?? ''} /></label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" name="submit" value="0">Save draft</button><button className="btn pri" name="submit" value="1">Certify and send to Finance</button></div>
      </form>
    </>
  );
}
