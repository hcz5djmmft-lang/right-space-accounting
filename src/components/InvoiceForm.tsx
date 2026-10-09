'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Acc, Party, Proj } from '@/lib/queries';

type Line = { acc: string; desc: string; qty: string; price: string };
export type InvoiceInitial = { id?: string; date: string; due: string; party: string; project: string; ref: string; vatRate: string; lines: Line[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => r2(Number(String(s).replace(/[,\s]/g, '')) || 0);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blank: Line = { acc: '', desc: '', qty: '1', price: '' };

export function InvoiceForm({ initial, accounts, projects, customers, save }: {
  initial: InvoiceInitial; accounts: Acc[]; projects: Proj[]; customers: Party[];
  save: (x: unknown) => Promise<{ error?: string; id?: string }>;
}) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const router = useRouter();
  const set = (p: Partial<InvoiceInitial>) => setF(x => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<Line>) => setF(x => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  const revenue = accounts.filter(a => a.postable && a.type === 'revenue');
  const sub = r2(f.lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0));
  const vat = r2(sub * num(f.vatRate) / 100);
  const total = r2(sub + vat);
  const submit = (post: boolean) => start(async () => {
    setErr('');
    const res = await save({
      id: f.id, post, date: f.date, due: f.due || null, party: f.party, project: f.project || null, ref: f.ref.trim(), vatRate: num(f.vatRate),
      lines: f.lines.filter(l => l.acc || num(l.price)).map(l => ({ acc: l.acc, desc: l.desc.trim(), qty: num(l.qty), price: num(l.price) })),
    });
    if (res.error) setErr(res.error); else router.push('/sales-invoices/' + res.id);
  });
  return (
    <div>
      {err && <div className="msg bad">{err}</div>}
      <div className="card grid g4">
        <label className="f"><span>Customer</span><select className="inp" value={f.party} onChange={e => set({ party: e.target.value })}>
          <option value="">Select…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="f"><span>Project</span><select className="inp" value={f.project} onChange={e => set({ project: e.target.value })}>
          <option value="">— None —</option>{projects.filter(p => !p.is_office && p.status !== 'Closed').map(p => <option key={p.id} value={p.id}>{p.code === p.name ? p.name : `${p.code} · ${p.name}`}</option>)}</select></label>
        <label className="f"><span>Invoice date</span><input className="inp" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></label>
        <label className="f"><span>Due</span><input className="inp" type="date" value={f.due} onChange={e => set({ due: e.target.value })} /></label>
        <label className="f" style={{ gridColumn: 'span 2' }}><span>Contract / PO reference</span><input className="inp" dir="auto" value={f.ref} onChange={e => set({ ref: e.target.value })} /></label>
        <label className="f"><span>VAT</span><select className="inp" value={f.vatRate} onChange={e => set({ vatRate: e.target.value })}>{[0, 14].map(o => <option key={o} value={String(o)}>{o}%</option>)}</select></label>
      </div>

      <div className="card">
        <div className="lines-grid">{f.lines.map((l, i) => (
          <div className="line-card pr" key={i}>
            <label className="f" style={{ gridColumn: 'span 2' }}><span>Revenue GL code</span><select className="inp" value={l.acc} onChange={e => setLine(i, { acc: e.target.value })}>
              <option value="">Select revenue code…</option>{revenue.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
            <label className="f"><span>Description</span><input className="inp" dir="auto" value={l.desc} onChange={e => setLine(i, { desc: e.target.value })} /></label>
            <label className="f"><span>Qty</span><input className="inp mono" inputMode="decimal" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} /></label>
            <label className="f"><span>Unit price</span><input className="inp mono" inputMode="decimal" value={l.price} onChange={e => setLine(i, { price: e.target.value })} /></label>
            <button type="button" className="btn sm" aria-label="Remove line" onClick={() => set({ lines: f.lines.length > 1 ? f.lines.filter((_, k) => k !== i) : [blank] })}>✕</button>
          </div>))}</div>
        <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => set({ lines: [...f.lines, blank] })}>Add line</button>
      </div>

      <div className="grid g2">
        <div />
        <div className="card"><table><tbody>
          <tr><td>Subtotal</td><td className="num">{fmt(sub)}</td></tr>
          {vat ? <tr><td>VAT {f.vatRate}%</td><td className="num">{fmt(vat)}</td></tr> : null}
        </tbody><tfoot><tr><td>Invoice total</td><td className="num">{fmt(total)}</td></tr></tfoot></table></div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" disabled={busy} onClick={() => router.back()}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => submit(false)}>Save draft</button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => submit(true)}>Post invoice</button>
      </div>
    </div>
  );
}
