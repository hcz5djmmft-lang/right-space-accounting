'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Dept, Proj } from '@/lib/queries';

type Line = { material: string; qty: string; description: string };
export type PurchaseInitial = { id?: string; date: string; neededBy: string; assign: string; notes: string; lines: Line[] };
export type MaterialOption = { id: string; code: string; name: string; name_ar: string | null; unit: string; account_base: string };

const num = (s: string) => Number(String(s).replace(/[,\s]/g, '')) || 0;
const blank: Line = { material: '', qty: '1', description: '' };

/** A purchase request: the project or department it is for, and materials from the list with quantities. Procurement prices it. */
export function PurchaseForm({ initial, materials, projects, departments, save }: {
  initial: PurchaseInitial; materials: MaterialOption[]; projects: Proj[]; departments: Dept[];
  save: (x: unknown) => Promise<{ error?: string; id?: string }>;
}) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const router = useRouter();
  const set = (p: Partial<PurchaseInitial>) => setF(x => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<Line>) => setF(x => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  const submit = (submit: boolean) => start(async () => {
    setErr('');
    const res = await save({
      id: f.id, submit, date: f.date, neededBy: f.neededBy || null, notes: f.notes,
      project: f.assign.startsWith('p:') ? f.assign.slice(2) : null, dept: f.assign.startsWith('d:') ? f.assign.slice(2) : null,
      lines: f.lines.filter(l => l.material).map(l => ({ material: l.material, qty: num(l.qty), description: l.description.trim() })),
    });
    if (res.error) setErr(res.error); else router.push('/purchasing/' + res.id);
  });
  return (
    <div>
      {err && <div className="msg bad">{err}</div>}
      <div className="card grid g4">
        <label className="f" style={{ gridColumn: 'span 2' }}><span>For project / department</span>
          <select className="inp" value={f.assign} onChange={e => set({ assign: e.target.value })}>
            <option value="">Select…</option>
            <optgroup label="Projects">{projects.filter(p => !p.is_office && p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{p.code === p.name ? p.name : `${p.code} · ${p.name}`}</option>)}</optgroup>
            <optgroup label="Departments">{departments.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
          </select></label>
        <label className="f"><span>Date</span><input className="inp" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></label>
        <label className="f"><span>Needed by</span><input className="inp" type="date" value={f.neededBy} onChange={e => set({ neededBy: e.target.value })} /></label>
        <label className="f" style={{ gridColumn: '1 / -1' }}><span>Notes for Procurement</span><input className="inp" dir="auto" value={f.notes} onChange={e => set({ notes: e.target.value })} /></label>
      </div>
      <div className="card">
        <h2>Materials</h2>
        <div className="tw"><table>
          <thead><tr><th>Material</th><th className="num">Qty</th><th>Unit</th><th className="hide-sm">Details</th><th></th></tr></thead>
          <tbody>{f.lines.map((l, i) => {
            const m = materials.find(x => x.id === l.material);
            return (
              <tr key={i}>
                <td><select className="inp" value={l.material} onChange={e => setLine(i, { material: e.target.value })} style={{ minWidth: 200 }}>
                  <option value="">Select material…</option>
                  {materials.map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}{x.name_ar ? ` · ${x.name_ar}` : ''}</option>)}</select></td>
                <td className="num"><input className="inp mono" style={{ maxWidth: 100 }} inputMode="decimal" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} /></td>
                <td>{m?.unit ?? ''}</td>
                <td className="hide-sm"><input className="inp" dir="auto" value={l.description} placeholder="Size, colour, brand…" onChange={e => setLine(i, { description: e.target.value })} /></td>
                <td><button type="button" className="btn sm" aria-label="Remove line" onClick={() => set({ lines: f.lines.length > 1 ? f.lines.filter((_, k) => k !== i) : [blank] })}>✕</button></td>
              </tr>);
          })}</tbody></table></div>
        <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => set({ lines: [...f.lines, blank] })}>Add material</button>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" disabled={busy} onClick={() => router.back()}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => submit(false)}>Save draft</button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => submit(true)}>Submit to Procurement</button>
      </div>
    </div>
  );
}
