import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { fmt } from '@/lib/money';
import { listProjects } from '@/lib/queries';
import { projectAccounts } from '@/lib/boq';
import { CLAIM_ROWS, claimTemplate, claimableWorkOrders, getSubClaim, getSubClaimLines, type SubClaimLineInput } from '@/lib/claims';
import { subClaimAction } from '../actions';

/**
 * A new subcontractor claim (his form): first the work order (or the project and the subcontractor when there is none), then the items
 * with the previous quantities already certified, this period's quantities and the execution %. `?edit=` reopens a draft or a returned claim.
 */
export default async function NewClaim({ searchParams }: { searchParams: Promise<{ edit?: string; wo?: string; project?: string; vendor?: string; error?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const cur = sp.edit ? await getSubClaim(sp.edit) : null;
  if (sp.edit && !cur) notFound();
  const woId = cur?.work_order_id ?? sp.wo ?? '';
  const projectId = cur?.project_id ?? sp.project ?? '';
  const vendorId = cur?.vendor_id ?? sp.vendor ?? '';
  const [projects, vendors, wos] = await Promise.all([listProjects(), sql<{ id: string; name: string }[]>`select id, name from parties where type = 'vendor' order by name`, claimableWorkOrders()]);
  const wo = woId ? wos.find(w => w.id === woId) ?? (await claimableWorkOrders()).find(w => w.id === woId) : null;
  const pId = wo?.project_id ?? projectId, vId = wo?.vendor_id ?? vendorId;
  const ready = !!(pId && vId);
  // step 1: pick the work order, or the project and the subcontractor
  if (!ready) {
    return (
      <>
        <div className="head"><div><h1>New subcontractor claim</h1><p>Pick the work order the claim is against. Work done without a work order: pick the project and the subcontractor instead.</p></div><Link className="btn" href="/claims">Claims</Link></div>
        {sp.error && <div className="msg bad">{sp.error}</div>}
        <form className="card grid g3" style={{ alignItems: 'end' }}>
          <label className="f"><span>Work order</span><select className="inp" name="wo" defaultValue={woId}><option value="">— none —</option>{wos.map(w => <option key={w.id} value={w.id}>{w.no} · {w.code} · {w.vendor ?? ''} · {w.title}</option>)}</select></label>
          <label className="f"><span>Or the project</span><select className="inp" name="project" defaultValue={projectId}><option value="">Select…</option>{projects.filter(p => !p.is_office).map(p => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</option>)}</select></label>
          <label className="f"><span>and the subcontractor</span><select className="inp" name="vendor" defaultValue={vendorId}><option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <div><button className="btn pri">Continue</button></div>
        </form>
      </>
    );
  }
  // step 2: the form
  const t = cur ? null : await claimTemplate(pId, vId, wo?.id ?? null);
  const curLines = cur ? await getSubClaimLines(cur.id) : [];
  const base: SubClaimLineInput[] = cur ? curLines.map(l => ({ wo_line_id: l.wo_line_id, item: l.item, unit: l.unit, rate: l.rate, current_qty: l.current_qty, previous_qty: l.previous_qty, pct: l.pct, notes: l.notes })) : t!.lines;
  const rows = [...base, ...Array.from({ length: Math.max(0, CLAIM_ROWS - base.length) }, () => ({ wo_line_id: null, item: '', unit: '', rate: '', current_qty: '', previous_qty: '', pct: 100, notes: '' }) as SubClaimLineInput)].slice(0, CLAIM_ROWS);
  const codes = await projectAccounts(pId);
  const project = projects.find(p => p.id === pId), vendor = vendors.find(v => v.id === vId);
  const prev = cur ? null : t!.prev;
  return (
    <>
      <div className="head"><div><h1>{cur ? `Edit ${cur.no}` : 'New subcontractor claim'}</h1>
        <p dir="auto">{project?.code} · {vendor?.name}{wo ? <> · <Link href={`/purchasing/work-orders/${wo.id}`}>{wo.no}</Link> {wo.title}</> : ''} · interim claim {cur?.claim_no ?? t!.claim_no}. Enter this period&apos;s quantities (the previous ones come from the last claim); the execution % is 100 unless an item is partly done. Procurement fills the rates it does not know.</p></div>
        <Link className="btn" href="/claims">Claims</Link></div>
      {sp.error && <div className="msg bad">{sp.error}</div>}
      {prev && prev.claimId && <div className="msg">Earlier claims on this work: cumulative {fmt(prev.gross)}, paid {fmt(prev.net)}, retention held {fmt(prev.retention)}, advance recovered {fmt(prev.advance)}.</div>}
      <form action={subClaimAction} className="card">
        {cur && <input type="hidden" name="id" value={cur.id} />}
        <input type="hidden" name="project" value={pId} /><input type="hidden" name="vendor" value={vId} /><input type="hidden" name="work_order" value={wo?.id ?? ''} />
        <div className="grid g3">
          <label className="f"><span>Date</span><input className="inp" type="date" name="date" required defaultValue={cur?.date ?? today()} /></label>
          <label className="f" style={{ gridColumn: 'span 2' }}><span>Trade / work (نوع الأعمال)</span><input className="inp" name="trade" dir="auto" defaultValue={cur?.trade ?? t!.trade} placeholder="اعمال الحداده الكريتال" /></label>
          <label className="f"><span>Retention % (تأمين أعمال)</span><input className="inp mono" name="retention_pct" inputMode="decimal" defaultValue={cur?.retention_pct ?? t!.retention_pct} /></label>
          <label className="f"><span>Advance recovered on this claim (خصم دفعة تعاقد)</span><input className="inp mono" name="advance" inputMode="decimal" defaultValue={cur?.advance ?? 0} /></label>
          <label className="f"><span>VAT</span><select className="inp" name="vat_rate" defaultValue={String(cur?.vat_rate ?? t!.vat_rate)}><option value="0">0%</option><option value="14">14%</option></select></label>
          <label className="f" style={{ gridColumn: 'span 2' }}><span>GL code the work posts to (Procurement may change it)</span><select className="inp mono" name="account" defaultValue={cur?.account ?? t!.account ?? ''}><option value="">Procurement picks</option>{codes.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label>
          <label className="f"><span>Photo or signed form (optional)</span><input className="inp" type="file" name="file" accept="image/*,application/pdf" /></label>
        </div>
        <div className="tw" style={{ marginTop: 8 }}><table>
          <thead><tr><th>#</th><th>Item (البيان)</th><th>Unit</th><th className="num">Rate</th><th className="num">Current qty</th><th className="num">Previous qty</th><th className="num">Exec. %</th><th>Notes</th></tr></thead>
          <tbody>{rows.map((l, i) => <tr key={i}><td className="mono">{i + 1}<input type="hidden" name={`wol_${i}`} value={l.wo_line_id ?? ''} /></td>
            <td><input className="inp" name={`item_${i}`} dir="auto" defaultValue={l.item} style={{ minWidth: 200 }} /></td><td><input className="inp" name={`unit_${i}`} dir="auto" defaultValue={l.unit ?? ''} style={{ width: 70 }} placeholder="يوم" /></td>
            <td className="num"><input className="inp mono" name={`rate_${i}`} inputMode="decimal" defaultValue={l.rate === 0 ? '' : l.rate} style={{ width: 95, textAlign: 'right' }} /></td>
            <td className="num"><input className="inp mono" name={`cur_${i}`} inputMode="decimal" defaultValue={l.current_qty === 0 ? '' : l.current_qty} style={{ width: 85, textAlign: 'right' }} /></td>
            <td className="num"><input className="inp mono" name={`prev_${i}`} inputMode="decimal" defaultValue={l.previous_qty === 0 || l.previous_qty === '' ? '' : l.previous_qty} style={{ width: 85, textAlign: 'right' }} /></td>
            <td className="num"><input className="inp mono" name={`pct_${i}`} inputMode="decimal" defaultValue={l.pct ?? 100} style={{ width: 65, textAlign: 'right' }} /></td>
            <td><input className="inp" name={`notes_${i}`} dir="auto" defaultValue={l.notes ?? ''} style={{ minWidth: 120 }} /></td></tr>)}</tbody>
        </table></div>
        <label className="f" style={{ marginTop: 8 }}><span>Notes</span><textarea className="inp" name="notes" dir="auto" rows={2} defaultValue={cur?.notes ?? ''} /></label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" name="submit" value="0">Save draft</button><button className="btn pri" name="submit" value="1">Certify and send to Procurement</button></div>
      </form>
    </>
  );
}
