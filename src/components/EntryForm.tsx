'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Acc, Dept, Party, Proj } from '@/lib/queries';
import type { SaveResult } from '@/app/(app)/entries/actions';

type Kind = 'expense' | 'collection' | 'transfer';
type Item = { assign: string; acc: string; desc: string; amount: string };
export type EntryInitial = {
  id?: string; date: string; ref: string; memo: string; type: Kind; bank: string; toBank: string;
  party: string; vatRate: string; amount: string; items: Item[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => r2(Number(String(s).replace(/[,\s]/g, '')) || 0);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseAssign = (v: string) => ({ project: v.startsWith('p:') ? v.slice(2) : '', dept: v.startsWith('d:') ? v.slice(2) : '' });

export function EntryForm(props: {
  initial: EntryInitial; accounts: Acc[]; projects: Proj[]; departments: Dept[]; parties: Party[];
  arCode: string; canPost: boolean; save: (input: unknown) => Promise<SaveResult>;
}) {
  const { accounts, projects, departments, parties, canPost } = props;
  const [e, setE] = useState<EntryInitial>(props.initial);
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const router = useRouter();
  const officeId = projects.find(p => p.is_office)?.id;
  const banks = accounts.filter(a => a.is_bank && a.postable);
  const postable = accounts.filter(a => a.postable);

  /** The GL list follows the project or department picked on the line (same rule as the old app). */
  const glList = (assign: string) => {
    if (e.type === 'collection') return postable.filter(a => a.type === 'revenue' || a.code === props.arCode || a.code === 'L130');
    const { project, dept } = parseAssign(assign);
    if (project) return postable.filter(a => a.project_id === project);
    if (dept) return postable.filter(a => a.project_id === officeId);
    return [];
  };

  const set = (patch: Partial<EntryInitial>) => setE(x => ({ ...x, ...patch }));
  const setItem = (i: number, patch: Partial<Item>) => setE(x => ({ ...x, items: x.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }));
  const sub = useMemo(() => r2(e.items.reduce((s, i) => s + num(i.amount), 0)), [e.items]);
  const vat = e.type === 'expense' ? r2(sub * num(e.vatRate) / 100) : 0;
  const switchType = (type: Kind) => set({ type, items: [{ assign: e.items[0]?.assign ?? '', acc: type === 'collection' ? 'R110' : '', desc: '', amount: '' }] });

  const submit = (action: 'draft' | 'submit' | 'post') => start(async () => {
    setErr('');
    const res = await props.save({
      id: e.id, date: e.date, ref: e.ref, action,
      form: {
        type: e.type, memo: e.memo.trim(), bank: e.bank, toBank: e.toBank, party: e.party,
        vatRate: num(e.vatRate), amount: num(e.amount),
        items: e.type === 'transfer' ? [] : e.items.filter(i => i.acc || num(i.amount)).map(i => ({ ...parseAssign(i.assign), acc: i.acc, desc: i.desc.trim(), amount: num(i.amount) })),
      },
    });
    if (res.error) setErr(res.error);
    else router.push(`/entries/${res.id}`);
  });

  const accLabel = (a: Acc) => `${a.code} · ${a.name}`;
  const partyType = e.type === 'collection' ? 'customer' : 'vendor';
  return (
    <div>
      {!e.id && (
        <div className="tabs">
          {(['expense', 'collection', 'transfer'] as Kind[]).map(k => (
            <button key={k} type="button" className={e.type === k ? 'on' : ''} onClick={() => switchType(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
      )}
      {err && <div className="msg bad">{err}</div>}
      <div className="card grid g4">
        <label className="f"><span>Date</span><input type="date" className="inp" value={e.date} onChange={x => set({ date: x.target.value })} /></label>
        <label className="f"><span>{e.type === 'collection' ? 'Received into' : e.type === 'transfer' ? 'Transfer from' : 'Paid from'}</span>
          <select className="inp" value={e.bank} onChange={x => set({ bank: x.target.value })}>
            <option value="">Select…</option>{banks.map(a => <option key={a.code} value={a.code}>{accLabel(a)}</option>)}
          </select></label>
        {e.type === 'transfer' ? <>
          <label className="f"><span>Transfer to</span>
            <select className="inp" value={e.toBank} onChange={x => set({ toBank: x.target.value })}>
              <option value="">Select…</option>{banks.map(a => <option key={a.code} value={a.code}>{accLabel(a)}</option>)}
            </select></label>
          <label className="f"><span>Amount (EGP)</span><input className="inp mono" inputMode="decimal" value={e.amount} onChange={x => set({ amount: x.target.value })} /></label>
        </> : <>
          <label className="f"><span>{partyType === 'customer' ? 'Customer' : 'Vendor'} (optional)</span>
            <select className="inp" value={e.party} onChange={x => set({ party: x.target.value })}>
              <option value="">—</option>{parties.filter(p => p.type === partyType).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="f"><span>Reference</span><input className="inp" value={e.ref} placeholder="Receipt / invoice no." onChange={x => set({ ref: x.target.value })} /></label>
        </>}
        <label className="f" style={{ gridColumn: '1 / -1' }}><span>Description</span>
          <input className="inp" dir="auto" value={e.memo} onChange={x => set({ memo: x.target.value })}
            placeholder={e.type === 'collection' ? 'e.g. Second instalment, PH-B1302' : e.type === 'transfer' ? 'e.g. Top up petty cash' : 'e.g. Site electricity bill, September'} /></label>
      </div>

      {e.type !== 'transfer' && (
        <div className="card">
          <div className="lines-grid">
            {e.items.map((it, i) => {
              const list = glList(it.assign);
              return (
                <div className="line-card" key={i}>
                  <label className="f"><span>Project / department</span>
                    <select className="inp" value={it.assign} onChange={x => setItem(i, { assign: x.target.value, acc: e.type === 'collection' ? it.acc : '' })}>
                      <option value="">— Choose —</option>
                      <optgroup label="Projects">{projects.filter(p => p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{p.code === p.name ? p.name : `${p.code} · ${p.name}`}</option>)}</optgroup>
                      <optgroup label="Departments">{departments.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
                    </select></label>
                  <label className="f"><span>{e.type === 'collection' ? 'Collection type' : 'GL code'}</span>
                    <select className="inp" value={it.acc} onChange={x => setItem(i, { acc: x.target.value })}>
                      <option value="">{list.length ? 'Select GL code…' : 'Choose the project or department first'}</option>
                      {list.map(a => <option key={a.code} value={a.code}>{accLabel(a)}</option>)}
                    </select></label>
                  <label className="f"><span>Line description</span><input className="inp" dir="auto" value={it.desc} onChange={x => setItem(i, { desc: x.target.value })} /></label>
                  <label className="f"><span>Amount</span><input className="inp mono" inputMode="decimal" value={it.amount} onChange={x => setItem(i, { amount: x.target.value })} /></label>
                  <button type="button" className="btn sm" title="Remove line" aria-label="Remove line"
                    onClick={() => set({ items: e.items.length > 1 ? e.items.filter((_, k) => k !== i) : [{ assign: '', acc: '', desc: '', amount: '' }] })}>✕</button>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <button type="button" className="btn sm" onClick={() => set({ items: [...e.items, { assign: e.items.at(-1)?.assign ?? '', acc: e.type === 'collection' ? 'R110' : '', desc: '', amount: '' }] })}>Add line</button>
            {e.type === 'expense' && <label className="f" style={{ width: 110 }}><span>VAT %</span><input className="inp mono" inputMode="decimal" value={e.vatRate} onChange={x => set({ vatRate: x.target.value })} /></label>}
          </div>
        </div>
      )}

      <div className="sumbar">
        {e.type === 'transfer' ? <span>Amount <b className="mono">{fmt(num(e.amount))}</b></span> : <>
          <span>Lines <b className="mono">{fmt(sub)}</b></span>
          {vat ? <span>VAT <b className="mono">{fmt(vat)}</b></span> : null}
          <span>{e.type === 'collection' ? 'Total received' : 'Total paid'} <b className="mono">{fmt(sub + vat)}</b></span>
        </>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" disabled={busy} onClick={() => router.back()}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => submit('draft')}>Save draft</button>
        {canPost
          ? <button type="button" className="btn pri" disabled={busy} onClick={() => submit('post')}>Post</button>
          : <button type="button" className="btn pri" disabled={busy} onClick={() => submit('submit')}>Submit for approval</button>}
      </div>
    </div>
  );
}
