'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { payLine, type PayRates } from '@/lib/payroll-calc';
import type { Dept, Proj } from '@/lib/queries';

export type EmployeeInitial = { id?: string; code: string; name: string; job_title: string; dept_id: string; project_id: string; hire_date: string; basic: string; allowances: string; insurable: string; no_deductions: boolean; active: boolean; bank_account: string };

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(String(s).replace(/[,\s]/g, '')) || 0;

export function EmployeeForm({ initial, projects, departments, rates, inRuns, save, remove }: {
  initial: EmployeeInitial; projects: Proj[]; departments: Dept[]; rates: PayRates; inRuns: boolean;
  save: (x: unknown) => Promise<{ error?: string; id?: string }>; remove?: () => Promise<{ error?: string }>;
}) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const router = useRouter();
  const set = (p: Partial<EmployeeInitial>) => setF(x => ({ ...x, ...p }));
  const est = payLine({ basic: num(f.basic), allowances: num(f.allowances), insurable: num(f.insurable), no_deductions: f.no_deductions }, 0, 0, rates);
  const submit = () => start(async () => {
    setErr('');
    const res = await save({ ...f, code: f.code.trim(), name: f.name.trim(), job_title: f.job_title.trim(), bank_account: f.bank_account.trim(),
      dept_id: f.dept_id || null, project_id: f.project_id || null, hire_date: f.hire_date || null,
      basic: num(f.basic), allowances: num(f.allowances), insurable: num(f.insurable) });
    if (res.error) setErr(res.error); else router.push('/payroll?tab=employees');
  });
  const del = () => { if (!remove || !confirm(`Delete ${f.name}?`)) return; start(async () => { const r = await remove(); if (r.error) setErr(r.error); else router.push('/payroll?tab=employees'); }); };
  const inp = (k: keyof EmployeeInitial, label: string, extra: Record<string, unknown> = {}) => (
    <label className="f"><span>{label}</span><input className="inp" value={String(f[k])} onChange={e => set({ [k]: e.target.value })} {...extra} /></label>);
  return (
    <div>
      {err && <div className="msg bad">{err}</div>}
      <div className="card grid g3">
        {inp('code', 'Employee code', { className: 'inp mono', placeholder: 'Blank = next number' })}
        {inp('name', 'Full name', { dir: 'auto' })}
        {inp('job_title', 'Job title', { dir: 'auto' })}
        <label className="f"><span>Department</span><select className="inp" value={f.dept_id} onChange={e => set({ dept_id: e.target.value })}><option value="">—</option>{departments.filter(d => d.active || d.id === f.dept_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="f"><span>Cost center (project)</span><select className="inp" value={f.project_id} onChange={e => set({ project_id: e.target.value })}><option value="">— salary charged to the department —</option>{projects.filter(p => !p.is_office && (p.status !== 'Closed' || p.id === f.project_id)).map(p => <option key={p.id} value={p.id}>{p.code === p.name ? p.name : `${p.code} · ${p.name}`}</option>)}</select></label>
        {inp('hire_date', 'Hire date', { type: 'date' })}
        {inp('basic', 'Basic salary (monthly)', { className: 'inp mono', inputMode: 'decimal' })}
        {inp('allowances', 'Allowances (monthly)', { className: 'inp mono', inputMode: 'decimal' })}
        {inp('insurable', 'Social insurance wage', { className: 'inp mono', inputMode: 'decimal', placeholder: f.no_deductions ? 'Not insured' : 'Blank = basic + allowances', disabled: f.no_deductions })}
        {inp('bank_account', 'Bank account / IBAN', { className: 'inp mono' })}
        <label className="row" style={{ alignSelf: 'end', fontSize: 14 }}><input type="checkbox" checked={f.active} onChange={e => set({ active: e.target.checked })} /> Active (included in new payroll runs)</label>
        <label className="row" style={{ alignSelf: 'end', fontSize: 14 }}><input type="checkbox" checked={f.no_deductions} onChange={e => set({ no_deductions: e.target.checked })} /> No social insurance or salary tax (paid the full salary)</label>
      </div>
      <div className="card" style={{ fontSize: 14 }}>Monthly estimate: gross <b className="mono">{fmt(est.gross)}</b> · social insurance (employee) <b className="mono">{fmt(est.soc_emp)}</b> · salary tax <b className="mono">{fmt(est.tax)}</b> · net <b className="mono">{fmt(est.net)}</b> · company insurance cost <b className="mono">{fmt(est.soc_co)}</b></div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>{remove && !inRuns && <button type="button" className="btn bad" disabled={busy} onClick={del}>Delete</button>}</div>
        <div className="row"><button type="button" className="btn" disabled={busy} onClick={() => router.back()}>Cancel</button><button type="button" className="btn pri" disabled={busy} onClick={submit}>Save</button></div>
      </div>
    </div>
  );
}
