'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Acc, Dept, Proj } from '@/lib/queries';
import { shrink } from './shrink';

export type ExpenseInitial = { date: string; amount: string; assign: string; account: string; description: string; paid_from: string };

/** New expense on the phone: receipt photo, amount, what for, project or department, GL code, paid from. */
export function ExpenseForm({ initial, accounts, projects, departments, paidFrom, save, action, submitLabel = 'Send for approval' }: {
  initial: ExpenseInitial; accounts: Acc[]; projects: Proj[]; departments: Dept[]; paidFrom: { code: string; name: string; kind: string }[];
  save?: (f: FormData) => Promise<{ error?: string; id?: string }>; action?: (f: FormData) => Promise<void>; submitLabel?: string;
}) {
  const [assign, setAssign] = useState(initial.assign);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const cam = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const office = projects.find(p => p.is_office)?.id;
  const gl = assign.startsWith('p:') ? accounts.filter(a => a.type === 'expense' && a.postable && a.project_id === assign.slice(2))
    : assign.startsWith('d:') ? accounts.filter(a => a.type === 'expense' && a.postable && (a.project_id === office || !a.project_id)) : [];

  async function pick(input: HTMLInputElement) {
    const f = input.files?.[0];
    if (!f) return;
    const small = await shrink(f);
    setPhoto(small);
    setPreview(small.type.startsWith('image/') && small.type !== 'image/heic' ? URL.createObjectURL(small) : '');
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    if (!save) return; // correcting a returned expense: the form posts to its server action
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.delete('receipt');
    if (photo) fd.append('receipt', photo);
    start(async () => {
      setErr('');
      const r = await save(fd);
      if (r.error) setErr(r.error); else router.push(`/expenses/${r.id}?ok=${encodeURIComponent('Sent for approval.')}`);
    });
  }
  return (
    <form onSubmit={submit} action={save ? undefined : action} className="card" style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
      {save && <div>
        <input ref={cam} type="file" name="receipt" accept="image/*,application/pdf" capture="environment" hidden onChange={e => pick(e.currentTarget)} />
        <button type="button" className={'btn' + (photo ? '' : ' pri')} onClick={() => cam.current?.click()}>📷 {photo ? 'Take the photo again' : 'Photo of the receipt'}</button>
        {photo && <span className="muted" style={{ marginInlineStart: 8, fontSize: 13 }}>{photo.name} · {(photo.size / 1024).toFixed(0)} KB</span>}
        {preview && <img src={preview} alt="Receipt" style={{ display: 'block', maxWidth: 220, maxHeight: 220, marginTop: 8, borderRadius: 8, border: '1px solid var(--line)' }} />}
      </div>}
      <div className="grid g2">
        <label className="f"><span>Amount (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" defaultValue={initial.amount} required /></label>
        <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={initial.date} required /></label>
      </div>
      <label className="f"><span>What for</span><input className="inp" name="description" dir="auto" defaultValue={initial.description} placeholder="e.g. Taxi to site, nails and screws" required /></label>
      <label className="f"><span>Project or department</span>
        <select className="inp" name="assign" value={assign} onChange={e => setAssign(e.target.value)} required>
          <option value="">Choose…</option>
          <optgroup label="Projects">{projects.filter(p => !p.is_office && p.status === 'Active').map(p => <option key={p.id} value={'p:' + p.id}>{p.code} · {p.name}</option>)}</optgroup>
          <optgroup label="Departments">{departments.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
        </select></label>
      <label className="f"><span>GL code</span>
        <select className="inp" name="account" defaultValue={initial.account} key={assign} required disabled={!gl.length}>
          <option value="">{assign ? 'Choose…' : 'Choose the project or department first'}</option>
          {gl.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
        </select></label>
      <label className="f"><span>Paid from</span>
        <select className="inp" name="paid_from" defaultValue={initial.paid_from} required>
          <option value="">Choose…</option>
          {paidFrom.map(o => <option key={o.code} value={o.code}>{o.kind === 'card' ? 'Credit card' : 'Office cash'} · {o.name}</option>)}
          <option value="own">My own money (Finance reimburses me)</option>
        </select></label>
      {err && <div className="msg bad">{err}</div>}
      <div><button className="btn pri" disabled={busy}>{busy ? 'Sending…' : submitLabel}</button></div>
    </form>
  );
}
