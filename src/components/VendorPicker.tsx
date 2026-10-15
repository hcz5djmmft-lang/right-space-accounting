'use client';
import { useId, useState } from 'react';

type V = { id: string; code: string | null; name: string; is_sub?: boolean };
const label = (v: V) => `${v.name}${v.code ? ` · ${v.code}` : ''}${v.is_sub ? ' (subcontractor)' : ''}`;

/** A vendor box you type in (update 20, item 18): the list narrows as you type; picking one sets the vendor. */
export function VendorPicker({ vendors, value, onChange, name, required, placeholder = 'Type the name or code…' }: {
  vendors: V[]; value: string; onChange?: (id: string) => void; name?: string; required?: boolean; placeholder?: string;
}) {
  const list = useId();
  const [text, setText] = useState(() => { const v = vendors.find(x => x.id === value); return v ? label(v) : ''; });
  const pick = (t: string) => {
    setText(t);
    const v = vendors.find(x => label(x) === t) ?? vendors.find(x => x.name.toLowerCase() === t.trim().toLowerCase() || (x.code ?? '').toLowerCase() === t.trim().toLowerCase());
    onChange?.(v?.id ?? '');
  };
  const chosen = vendors.find(x => x.id === value);
  return (
    <>
      <input className="inp" list={list} value={text} onChange={e => pick(e.target.value)} placeholder={placeholder} dir="auto" required={required} autoComplete="off"
        style={text && !chosen ? { borderColor: 'var(--bad)' } : undefined} />
      <datalist id={list}>{vendors.map(v => <option key={v.id} value={label(v)} />)}</datalist>
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}
