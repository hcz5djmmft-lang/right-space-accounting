'use client';
import { useState } from 'react';
import type { Acc, Dept, Proj } from '@/lib/queries';

type Who = { id: string; name: string; detail?: string };
const KINDS = [['employee', 'Employees'], ['vendor', 'Vendors'], ['sub', 'Subcontractors'], ['other', 'Other']] as const;

/**
 * A new petty cash (update 20): paid to an employee, a vendor, a subcontractor or someone else; one project or department;
 * several lines, each with its amount and GL code. It goes for approval first and is paid out of the office cash afterwards.
 * The GL codes follow the project (its own codes) or the department (the Office codes).
 */
export function PettyCashForm({ accounts, projects, departments, employees, vendors, subs, cash, date, action }: {
  accounts: Acc[]; projects: Proj[]; departments: Dept[]; employees: Who[]; vendors: Who[]; subs: Who[];
  cash: { code: string; name: string; balance: string }; date: string; action: (f: FormData) => Promise<void>;
}) {
  const [assign, setAssign] = useState('');
  const [kind, setKind] = useState('');
  const [lines, setLines] = useState([0]);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const office = projects.find(p => p.is_office)?.id;
  const gl = assign.startsWith('p:') ? accounts.filter(a => a.type === 'expense' && a.postable && a.project_id === assign.slice(2))
    : assign.startsWith('d:') ? accounts.filter(a => a.type === 'expense' && a.postable && (a.project_id === office || !a.project_id)) : [];
  const list = kind === 'employee' ? employees : kind === 'vendor' ? vendors : kind === 'sub' ? subs : [];
  const total = lines.reduce((t, k) => t + (Number(String(amounts[k] ?? '').replace(/,/g, '')) || 0), 0);
  return (
    <form action={action} className="card" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>New petty cash</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>It goes to the department head (a project&apos;s to the Director of Engineering), then Management. Once approved it is paid in cash from <b>{cash.code} · {cash.name}</b> (now {cash.balance}), never from the bank.</p>
      <div className="grid g3">
        <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={date} required /></label>
        <label className="f"><span>Paid to</span><select className="inp" name="kind" value={kind} onChange={e => setKind(e.target.value)} required>
          <option value="">Choose…</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {kind === 'other'
          ? <label className="f"><span>Receiver&apos;s name</span><input className="inp" name="paid_to" dir="auto" required placeholder="Type the name" /></label>
          : <label className="f"><span>{kind ? KINDS.find(k => k[0] === kind)![1] : 'Who'}</span>
              <select className="inp" name="paid_to" key={kind} required disabled={!kind} defaultValue="">
                <option value="">{kind ? 'Choose…' : 'Choose Paid to first'}</option>{list.map(p => <option key={p.id} value={p.id}>{p.name}{p.detail ? ` · ${p.detail}` : ''}</option>)}</select></label>}
      </div>
      <div className="grid g2">
        <label className="f"><span>Purpose</span><input className="inp" name="purpose" dir="auto" placeholder="e.g. Transport to site, small tools" required /></label>
        <label className="f"><span>Project or department (one per petty cash)</span>
          <select className="inp" name="assign" value={assign} onChange={e => setAssign(e.target.value)} required>
            <option value="">Choose…</option>
            <optgroup label="Projects">{projects.filter(p => !p.is_office && p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{p.code === p.name ? p.code : `${p.code} · ${p.name}`}</option>)}</optgroup>
            <optgroup label="Departments">{departments.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
          </select></label>
      </div>
      <div className="tw"><table>
        <thead><tr><th>GL code</th><th>Description</th><th className="num">Amount (EGP)</th><th></th></tr></thead>
        <tbody>{lines.map((k, n) => (
          <tr key={k}>
            <td><select className="inp" name="account" key={assign} required disabled={!gl.length} defaultValue="" style={{ minWidth: 200 }}>
              <option value="">{assign ? 'Choose…' : 'Choose the project or department first'}</option>
              {gl.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></td>
            <td><input className="inp" name="desc" dir="auto" placeholder="optional" /></td>
            <td className="num"><input className="inp mono" name="amount" inputMode="decimal" required style={{ maxWidth: 140, textAlign: 'end' }}
              value={amounts[k] ?? ''} onChange={e => setAmounts(a => ({ ...a, [k]: e.target.value }))} /></td>
            <td>{lines.length > 1 && <button type="button" className="btn sm" onClick={() => setLines(l => l.filter((_, i) => i !== n))}>✕</button>}</td>
          </tr>))}</tbody>
        <tfoot><tr><td colSpan={2}><button type="button" className="btn sm" onClick={() => setLines(l => [...l, Math.max(...l) + 1])}>+ Add a line</button></td>
          <td className="num mono"><b>{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></td><td /></tr></tfoot>
      </table></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Send for approval</button></div>
    </form>
  );
}
