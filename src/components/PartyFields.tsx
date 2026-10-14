'use client';
import { useState } from 'react';

type P = { name?: string; phone?: string | null; email?: string | null; tax_id?: string | null; wht_rate?: number; vendor_type?: string | null; pay_method?: string | null;
  bank_name?: string | null; account_no?: string | null; iban?: string | null; instapay_no?: string | null; instapay_to?: string | null };

/** The boxes of a customer, vendor or subcontractor. A customer has an ID number; a vendor or subcontractor a type and how it is paid (Bank or InstaPay). */
export function PartyFields({ kind, p = {}, types }: { kind: 'customer' | 'vendor' | 'sub'; p?: P; types: string[] }) {
  const [method, setMethod] = useState(p.pay_method ?? (p.bank_name || p.account_no || p.iban ? 'bank' : 'bank'));
  const [type, setType] = useState(p.vendor_type ?? '');
  const customer = kind === 'customer';
  return (
    <>
      <div className="grid g4">
        <label className="f"><span>Name</span><input className="inp" name="name" dir="auto" defaultValue={p.name ?? ''} required /></label>
        <label className="f"><span>Phone</span><input className="inp" name="phone" inputMode="tel" defaultValue={p.phone ?? ''} /></label>
        <label className="f"><span>Email</span><input className="inp" name="email" type="email" defaultValue={p.email ?? ''} /></label>
        <label className="f"><span>{customer ? 'ID number' : 'Tax ID'}</span><input className="inp" name="tax_id" inputMode={customer ? 'numeric' : undefined} defaultValue={p.tax_id ?? ''} placeholder={customer ? 'National ID' : ''} /></label>
        {customer ? <>
          <label className="f"><span>Bank name</span><input className="inp" name="bank_name" defaultValue={p.bank_name ?? ''} /></label>
          <label className="f"><span>Account no.</span><input className="inp" name="account_no" defaultValue={p.account_no ?? ''} /></label>
          <label className="f"><span>IBAN</span><input className="inp" name="iban" defaultValue={p.iban ?? ''} /></label>
        </> : <>
          <label className="f"><span>Vendor type</span><select className="inp" name="vendor_type" value={type} onChange={e => setType(e.target.value)}>
            <option value="">Choose…</option>{[...new Set([...types, ...(p.vendor_type ? [p.vendor_type] : [])])].map(t => <option key={t}>{t}</option>)}<option value="+">+ New type…</option></select></label>
          {type === '+' && <label className="f"><span>New type</span><input className="inp" name="new_type" dir="auto" placeholder="e.g. Marble" required /></label>}
          <label className="f"><span>Paid by</span><select className="inp" name="pay_method" value={method} onChange={e => setMethod(e.target.value)}>
            <option value="bank">Bank</option><option value="instapay">InstaPay</option></select></label>
        </>}
        <label className="f"><span>WHT %</span><select className="inp" name="wht_rate" defaultValue={String(p.wht_rate ?? 0)}><option>0</option><option>1</option><option>3</option><option>5</option></select></label>
      </div>
      {!customer && (method === 'instapay'
        ? <div className="grid g4" style={{ marginTop: 10 }}>
            <label className="f"><span>InstaPay number</span><input className="inp mono" name="instapay_no" inputMode="tel" defaultValue={p.instapay_no ?? ''} required /></label>
            <label className="f"><span>Transfer to</span><select className="inp" name="instapay_to" defaultValue={p.instapay_to ?? ''} required>
              <option value="">Choose…</option><option value="account">Bank account</option><option value="wallet">Wallet</option></select></label>
          </div>
        : <div className="grid g4" style={{ marginTop: 10 }}>
            <label className="f"><span>Bank name</span><input className="inp" name="bank_name" defaultValue={p.bank_name ?? ''} /></label>
            <label className="f"><span>Account no.</span><input className="inp" name="account_no" defaultValue={p.account_no ?? ''} /></label>
            <label className="f"><span>IBAN</span><input className="inp" name="iban" defaultValue={p.iban ?? ''} /></label>
          </div>)}
    </>
  );
}
