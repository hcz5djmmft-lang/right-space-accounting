import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { listProjects } from '@/lib/queries';
import { WO_ACCOUNT, WO_CATEGORIES, getWOLines, getWorkOrder } from '@/lib/procurement';
import { workOrderAction } from '../../procurement-actions';

/** A work order to a subcontractor: project, category, items with rates, retention and advance. `?edit=` reopens a draft. */
export default async function NewWorkOrder({ searchParams }: { searchParams: Promise<{ edit?: string; error?: string; project?: string }> }) {
  await requireUser();
  const { edit, error, project } = await searchParams;
  const cur = edit ? await getWorkOrder(edit) : null;
  const lines = cur ? await getWOLines(cur.id) : [];
  const [projects, vendors, codes] = await Promise.all([
    listProjects(), sql<{ id: string; name: string; categories: string[] }[]>`select id, name, categories from parties where type = 'vendor' order by name`,
    sql<{ code: string; name: string; project_id: string }[]>`select code, name, project_id from accounts where project_id is not null and postable and type = 'expense' order by code`,
  ]);
  const byProject: Record<string, { code: string; name: string }[]> = {};
  for (const c of codes) (byProject[c.project_id] ??= []).push(c);
  const rows = [...lines, ...Array.from({ length: Math.max(0, 8 - lines.length) }, () => ({ item: '', unit: 'lot', qty: '' as number | string, rate: '' as number | string }))].slice(0, 8);
  return (
    <>
      <div className="head"><div><h1>{cur ? `Edit ${cur.no}` : 'New work order'}</h1><p>Pick the project and the subcontractor, the work category and the GL code the work posts to, then the items with their rates. Save as a draft or send it to the department head.</p></div>
        <Link className="btn" href="/purchasing/work-orders">Work orders</Link></div>
      {error && <div className="msg bad">{error}</div>}
      <form action={workOrderAction} className="card">
        {cur && <input type="hidden" name="id" value={cur.id} />}
        <div className="grid g3">
          <label className="f"><span>Project</span><select className="inp" name="project" required defaultValue={cur?.project_id ?? project ?? ''}><option value="">Select…</option>{projects.filter(p => !p.is_office).map(p => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</option>)}</select></label>
          <label className="f"><span>Subcontractor</span><select className="inp" name="vendor" required defaultValue={cur?.vendor_id ?? ''}><option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.categories.length ? ` · ${v.categories.join(', ')}` : ''}</option>)}</select></label>
          <label className="f"><span>Work category</span><select className="inp" name="category" defaultValue={cur?.category ?? 'other'}>{WO_CATEGORIES.map(c => <option key={c.no} value={c.no}>{c.no === 'other' ? 'Other' : `${c.no} · ${c.title}`}</option>)}</select></label>
          <label className="f" style={{ gridColumn: '1 / -1' }}><span>Work (title)</span><input className="inp" name="title" dir="auto" required defaultValue={cur?.title ?? ''} placeholder="Plumbing rough-in of the two bathrooms and the kitchen" /></label>
          <label className="f"><span>GL code (the project&apos;s copy)</span><select className="inp mono" name="account" required defaultValue={cur?.account ?? ''}><option value="">Select…</option>{Object.entries(byProject).flatMap(([pid, cs]) => cs.map(c => <option key={c.code} value={c.code}>{projects.find(p => p.id === pid)?.code} · {c.code} · {c.name}</option>))}</select></label>
          <label className="f"><span>Date</span><input className="inp" type="date" name="date" required defaultValue={cur?.date ?? today()} /></label>
          <label className="f"><span>VAT</span><select className="inp" name="vat_rate" defaultValue={String(cur?.vat_rate ?? 0)}><option value="0">0%</option><option value="14">14%</option></select></label>
          <label className="f"><span>Start</span><input className="inp" type="date" name="start" defaultValue={cur?.start_date ?? ''} /></label>
          <label className="f"><span>End</span><input className="inp" type="date" name="end" defaultValue={cur?.end_date ?? ''} /></label>
          <div className="grid g2" style={{ gap: 8 }}>
            <label className="f"><span>Retention %</span><input className="inp mono" name="retention_pct" inputMode="decimal" defaultValue={cur?.retention_pct ?? 5} /></label>
            <label className="f"><span>Advance %</span><input className="inp mono" name="advance_pct" inputMode="decimal" defaultValue={cur?.advance_pct ?? 0} /></label>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Usual GL codes per category: {Object.entries(WO_ACCOUNT).filter(([k]) => k !== 'other').map(([k, v]) => `${k} → ${v}`).join(', ')}; other → 26008 (labour).</p>
        <div className="tw"><table>
          <thead><tr><th>Item</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate</th></tr></thead>
          <tbody>{rows.map((l, i) => <tr key={i}><td><input className="inp" name={`item_${i}`} dir="auto" defaultValue={l.item} style={{ minWidth: 220 }} /></td><td><input className="inp" name={`unit_${i}`} defaultValue={l.unit} style={{ width: 80 }} /></td>
            <td className="num"><input className="inp mono" name={`qty_${i}`} inputMode="decimal" defaultValue={l.qty} style={{ width: 90, textAlign: 'right' }} /></td><td className="num"><input className="inp mono" name={`rate_${i}`} inputMode="decimal" defaultValue={l.rate} style={{ width: 110, textAlign: 'right' }} /></td></tr>)}</tbody>
        </table></div>
        <label className="f" style={{ marginTop: 8 }}><span>Notes and terms</span><textarea className="inp" name="notes" dir="auto" rows={2} defaultValue={cur?.notes ?? ''} /></label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" name="submit" value="0">Save draft</button><button className="btn pri" name="submit" value="1">Send for approval</button></div>
      </form>
    </>
  );
}
