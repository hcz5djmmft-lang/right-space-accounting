'use client';
import { useState } from 'react';
import type { Acc, Dept, Proj } from '@/lib/queries';

/** A new petty cash voucher: paid only out of the office cash. The GL codes follow the project (its own codes) or the department (the Office codes). */
export function PettyCashForm({ accounts, projects, departments, people, cash, date, action }: {
  accounts: Acc[]; projects: Proj[]; departments: Dept[]; people: { id: string; name: string; detail: string }[];
  cash: { code: string; name: string; balance: string }; date: string; action: (f: FormData) => Promise<void>;
}) {
  const [assign, setAssign] = useState('');
  const office = projects.find(p => p.is_office)?.id;
  const gl = assign.startsWith('p:') ? accounts.filter(a => a.type === 'expense' && a.postable && a.project_id === assign.slice(2))
    : assign.startsWith('d:') ? accounts.filter(a => a.type === 'expense' && a.postable && (a.project_id === office || !a.project_id)) : [];
  return (
    <form action={action} className="card" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>New petty cash</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Paid in cash from <b>{cash.code} · {cash.name}</b> (now {cash.balance}). Never from the bank.</p>
      <div className="grid g2">
        <label className="f"><span>Amount (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" required /></label>
        <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={date} required /></label>
      </div>
      <label className="f"><span>Paid to</span><select className="inp" name="paid_to" required defaultValue="">
        <option value="">Choose the employee…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}{p.detail ? ` · ${p.detail}` : ''}</option>)}</select></label>
      <label className="f"><span>Purpose</span><input className="inp" name="purpose" dir="auto" placeholder="e.g. Transport to site, small tools" required /></label>
      <div className="grid g2">
        <label className="f"><span>Project or department</span>
          <select className="inp" name="assign" value={assign} onChange={e => setAssign(e.target.value)} required>
            <option value="">Choose…</option>
            <optgroup label="Projects">{projects.filter(p => !p.is_office && p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{p.code === p.name ? p.code : `${p.code} · ${p.name}`}</option>)}</optgroup>
            <optgroup label="Departments">{departments.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
          </select></label>
        <label className="f"><span>GL code</span>
          <select className="inp" name="account" key={assign} required disabled={!gl.length} defaultValue="">
            <option value="">{assign ? 'Choose…' : 'Choose the project or department first'}</option>
            {gl.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
          </select></label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Pay petty cash</button></div>
    </form>
  );
}
