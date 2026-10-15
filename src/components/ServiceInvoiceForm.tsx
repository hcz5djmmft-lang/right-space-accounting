'use client';
import { useState } from 'react';
import type { Acc, Dept, Party, Proj } from '@/lib/queries';
import { VendorPicker } from './VendorPicker';

/** A vendor invoice for a service with no purchase order (update 20, item 21): one cost center, lines with GL codes. */
export function ServiceInvoiceForm({ accounts, projects, departments, vendors, date, action }: {
  accounts: Acc[]; projects: Proj[]; departments: Dept[]; vendors: Party[]; date: string; action: (f: FormData) => Promise<void>;
}) {
  const [party, setParty] = useState('');
  const [assign, setAssign] = useState('');
  const [lines, setLines] = useState([0]);
  const office = projects.find(p => p.is_office)?.id;
  const gl = assign.startsWith('p:') ? accounts.filter(a => a.postable && a.project_id === assign.slice(2))
    : assign.startsWith('d:') ? accounts.filter(a => a.postable && a.project_id === office) : [];
  return (
    <form action={action} className="card" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Record a service invoice (no purchase order)</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Invoices for goods on a PO are recorded from the PO with Receive and invoice. Either way the invoice posts to the vendor&apos;s account now and is paid later by a payment request.</p>
      <div className="grid g3">
        <label className="f"><span>Vendor or subcontractor</span><VendorPicker vendors={vendors} value={party} onChange={setParty} name="party" required /></label>
        <label className="f"><span>Vendor&apos;s invoice no.</span><input className="inp" name="ref" required /></label>
        <label className="f"><span>Project or department</span>
          <select className="inp" name="assign" value={assign} onChange={e => setAssign(e.target.value)} required>
            <option value="">Choose…</option>
            <optgroup label="Projects">{projects.filter(p => !p.is_office && p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{p.code === p.name ? p.code : `${p.code} · ${p.name}`}</option>)}</optgroup>
            <optgroup label="Departments">{departments.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
          </select></label>
        <label className="f"><span>Invoice date</span><input className="inp" type="date" name="date" defaultValue={date} required /></label>
        <label className="f"><span>Due</span><input className="inp" type="date" name="due" /></label>
        <div className="grid g2">
          <label className="f"><span>VAT</span><select className="inp" name="vat" defaultValue="0">{[0, 14].map(o => <option key={o} value={o}>{o}%</option>)}</select></label>
          <label className="f"><span>WHT</span><select className="inp" name="wht" defaultValue="0">{[0, 1, 3, 5].map(o => <option key={o} value={o}>{o}%</option>)}</select></label>
        </div>
      </div>
      <div className="tw"><table>
        <thead><tr><th>GL code</th><th>Description</th><th className="num">Amount before VAT</th><th></th></tr></thead>
        <tbody>{lines.map((k, n) => (
          <tr key={k}>
            <td><select className="inp" name="account" key={assign} required disabled={!gl.length} defaultValue="" style={{ minWidth: 200 }}>
              <option value="">{assign ? 'Choose…' : 'Choose the project or department first'}</option>
              {gl.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></td>
            <td><input className="inp" name="desc" dir="auto" /></td>
            <td className="num"><input className="inp mono" name="amount" inputMode="decimal" required style={{ maxWidth: 140, textAlign: 'end' }} /></td>
            <td>{lines.length > 1 && <button type="button" className="btn sm" onClick={() => setLines(l => l.filter((_, i) => i !== n))}>✕</button>}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn sm" onClick={() => setLines(l => [...l, Math.max(...l) + 1])}>+ Add a line</button>
        <button className="btn pri" disabled={!party}>Record invoice</button>
      </div>
    </form>
  );
}
