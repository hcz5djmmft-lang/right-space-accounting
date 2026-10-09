'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Acc, Dept, Party, Proj } from '@/lib/queries';

type Line = { assign: string; acc: string; desc: string; qty: string; price: string };
export type PRInitial = {
  id?: string; date: string; due: string; party: string; assign: string; costType: string; ref: string; requester: string;
  vatRate: string; whtRate: string; siRate: string; retRate: string; dpAmount: string; lines: Line[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => r2(Number(String(s).replace(/[,\s]/g, '')) || 0);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (v: string) => ({ project: v.startsWith('p:') ? v.slice(2) : null, dept: v.startsWith('d:') ? v.slice(2) : null });
const blank: Line = { assign: '', acc: '', desc: '', qty: '1', price: '' };

export function PRForm({ initial, accounts, projects, departments, vendors, save }: {
  initial: PRInitial; accounts: Acc[]; projects: Proj[]; departments: Dept[]; vendors: Party[];
  save: (x: unknown) => Promise<{ error?: string; id?: string }>;
}) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const router = useRouter();
  const office = projects.find(p => p.is_office)?.id;
  const set = (p: Partial<PRInitial>) => setF(x => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<Line>) => setF(x => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  const glFor = (assign: string) => {
    const a = parse(assign || f.assign);
    if (a.project) return accounts.filter(x => x.postable && x.project_id === a.project);
    if (a.dept) return accounts.filter(x => x.postable && x.project_id === office);
    return [];
  };
  const sub = r2(f.lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0));
  const pct = (r: string) => r2(sub * num(r) / 100);
  const vat = pct(f.vatRate), wht = pct(f.whtRate), si = pct(f.siRate), ret = pct(f.retRate), dp = num(f.dpAmount);
  const net = r2(sub + vat - wht - si - ret - dp);

  const submit = (submit: boolean) => start(async () => {
    setErr('');
    const h = parse(f.assign);
    const res = await save({
      id: f.id, submit, date: f.date, due: f.due || null, party: f.party, project: h.project, dept: h.dept,
      costType: f.costType || null, ref: f.ref.trim(), requester: f.requester.trim() || null,
      vatRate: num(f.vatRate), whtRate: num(f.whtRate), siRate: num(f.siRate), retRate: num(f.retRate), dpAmount: dp,
      lines: f.lines.filter(l => l.acc || num(l.price)).map(l => ({ acc: l.acc, desc: l.desc.trim(), qty: num(l.qty), price: num(l.price), ...parse(l.assign) })),
    });
    if (res.error) setErr(res.error); else router.push('/payment-requests/' + res.id);
  });

  const assignSelect = (value: string, onChange: (v: string) => void, blankLabel: string) => (
    <select className="inp" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{blankLabel}</option>
      <optgroup label="Projects">{projects.filter(p => p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{p.code === p.name ? p.name : `${p.code} · ${p.name}`}</option>)}</optgroup>
      <optgroup label="Departments">{departments.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
    </select>);
  const rate = (k: 'vatRate' | 'whtRate', label: string, opts: number[]) => (
    <label className="f"><span>{label}</span><select className="inp" value={f[k]} onChange={e => set({ [k]: e.target.value })}>{opts.map(o => <option key={o} value={String(o)}>{o}%</option>)}</select></label>);

  return (
    <div>
      {err && <div className="msg bad">{err}</div>}
      <div className="card grid g4">
        <label className="f"><span>Vendor</span><select className="inp" value={f.party} onChange={e => set({ party: e.target.value })}>
          <option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="f"><span>Project / department</span>{assignSelect(f.assign, v => set({ assign: v, lines: f.lines.map(l => (l.assign ? l : { ...l, acc: '' })) }), '— Per line —')}</label>
        <label className="f"><span>Date</span><input className="inp" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></label>
        <label className="f"><span>Due</span><input className="inp" type="date" value={f.due} onChange={e => set({ due: e.target.value })} /></label>
        <label className="f"><span>Vendor invoice no.</span><input className="inp" value={f.ref} onChange={e => set({ ref: e.target.value })} /></label>
        <label className="f"><span>Budget type</span><select className="inp" value={f.costType} onChange={e => set({ costType: e.target.value })}><option value="">—</option><option>Opex</option><option>Capex</option></select></label>
        <label className="f" style={{ gridColumn: 'span 2' }}><span>Requester (if not you)</span><input className="inp" dir="auto" value={f.requester} onChange={e => set({ requester: e.target.value })} /></label>
      </div>

      <div className="card">
        <div className="lines-grid">{f.lines.map((l, i) => {
          const list = glFor(l.assign);
          return (
            <div className="line-card pr" key={i}>
              <label className="f"><span>Assigned to</span>{assignSelect(l.assign, v => setLine(i, { assign: v, acc: '' }), 'Same as above')}</label>
              <label className="f"><span>GL code</span><select className="inp" value={l.acc} onChange={e => setLine(i, { acc: e.target.value })}>
                <option value="">{list.length ? 'Select GL code…' : 'Choose the project or department first'}</option>
                {list.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
              <label className="f"><span>Description</span><input className="inp" dir="auto" value={l.desc} onChange={e => setLine(i, { desc: e.target.value })} /></label>
              <label className="f"><span>Qty</span><input className="inp mono" inputMode="decimal" value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} /></label>
              <label className="f"><span>Unit price</span><input className="inp mono" inputMode="decimal" value={l.price} onChange={e => setLine(i, { price: e.target.value })} /></label>
              <button type="button" className="btn sm" aria-label="Remove line" onClick={() => set({ lines: f.lines.length > 1 ? f.lines.filter((_, k) => k !== i) : [blank] })}>✕</button>
            </div>);
        })}</div>
        <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={() => set({ lines: [...f.lines, { ...blank, assign: f.lines.at(-1)?.assign ?? '' }] })}>Add line</button>
      </div>

      <div className="grid g2">
        <div className="card grid g3">
          {rate('vatRate', 'VAT', [0, 14])}
          {rate('whtRate', 'WHT', [0, 1, 3, 5])}
          <label className="f"><span>Social insurance %</span><input className="inp mono" inputMode="decimal" value={f.siRate} onChange={e => set({ siRate: e.target.value })} /></label>
          <label className="f"><span>Retention %</span><input className="inp mono" inputMode="decimal" value={f.retRate} onChange={e => set({ retRate: e.target.value })} /></label>
          <label className="f" style={{ gridColumn: 'span 2' }}><span>Down payment recovered (EGP)</span><input className="inp mono" inputMode="decimal" value={f.dpAmount} onChange={e => set({ dpAmount: e.target.value })} /></label>
        </div>
        <div className="card"><table><tbody>
          <tr><td>Subtotal</td><td className="num">{fmt(sub)}</td></tr>
          {vat ? <tr><td>VAT</td><td className="num">{fmt(vat)}</td></tr> : null}
          {wht ? <tr><td>Less WHT</td><td className="num">({fmt(wht)})</td></tr> : null}
          {si ? <tr><td>Less social insurance</td><td className="num">({fmt(si)})</td></tr> : null}
          {ret ? <tr><td>Less retention</td><td className="num">({fmt(ret)})</td></tr> : null}
          {dp ? <tr><td>Less down payment</td><td className="num">({fmt(dp)})</td></tr> : null}
        </tbody><tfoot><tr><td>Net to pay</td><td className="num">{fmt(net)}</td></tr></tfoot></table></div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" disabled={busy} onClick={() => router.back()}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => submit(false)}>Save draft</button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => submit(true)}>Submit for approval</button>
      </div>
    </div>
  );
}
