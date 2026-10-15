import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { getSettings } from '@/lib/books';
import { isProcurement, unpaidBills } from '@/lib/purchasing';
import { hasRole } from '@/lib/roles';
import { payLabel, vendorTypes } from '@/lib/parties';
import { PartyFields } from '@/components/PartyFields';
import { subAction, updatePartyAction } from './actions';
import { listHref } from '../list';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';

/** A vendor's or customer's account: what is unpaid, and every posted movement on payables (or receivables). */
export default async function PartyAccount({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const q = await searchParams;
  const [p] = await sql<{ id: string; code: string | null; type: 'customer' | 'vendor'; name: string; full_name: string | null; phone: string | null; email: string | null; bank_name: string | null; account_no: string | null; iban: string | null;
    tax_id: string | null; wht_rate: number; is_sub: boolean; vendor_type: string | null; pay_method: string | null; instapay_no: string | null; instapay_to: string | null }[]>`
    select id, code, type, name, full_name, phone, email, bank_name, account_no, iban, tax_id, wht_rate::float wht_rate, is_sub, vendor_type, pay_method, instapay_no, instapay_to from parties where id = ${id}`;
  if (!p) notFound();
  const s = await getSettings();
  const vendor = p.type === 'vendor';
  const kind = vendor ? (p.is_sub ? 'sub' : 'vendor') : 'customer';
  const may = hasRole(user, 'finance') || (vendor && await isProcurement(user));
  const types = vendor ? await vendorTypes() : [];
  const ctrl = vendor ? s.account_map.ap : s.account_map.ar;
  const [files, lines, bills, requests] = await Promise.all([
    vendor ? listAttachments('vendor', id) : Promise.resolve([]),
    sql<{ entry_id: string; no: string; date: string; memo: string; payment_ref: string | null; dr: number; cr: number }[]>`
      select e.id entry_id, e.no, to_char(e.date,'YYYY-MM-DD') date, coalesce(nullif(l.description, ''), e.memo) memo, e.payment_ref, l.dr, l.cr
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where l.party_id = ${id} and l.account = ${ctrl} order by e.date, e.no, l.line_no`,
    vendor ? unpaidBills(id) : Promise.resolve([]),
    vendor ? sql<{ id: string; no: string; date: string; net: number; paid: number; status: string }[]>`
      select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.net, invoice_paid(i.id) paid, i.status from invoices i
      where i.kind = 'purchase' and not i.is_bill and i.party_id = ${id} and i.status in ('pending', 'posted') and i.net - invoice_paid(i.id) > 0.004 order by i.date, i.no` : Promise.resolve([]),
  ]);
  const sign = vendor ? -1 : 1;
  let run = 0;
  const balance = lines.reduce((t, l) => t + sign * (l.dr - l.cr), 0);
  return (
    <>
      <div className="head"><div><h1>{p.name} <span className="muted mono" style={{ fontSize: 16 }}>{p.code}</span></h1>
        <p dir="auto">{[vendor ? (p.is_sub ? 'Subcontractor' : 'Vendor') : 'Customer', p.vendor_type, p.full_name !== p.name ? p.full_name : null, p.phone, p.email, vendor ? payLabel(p, may) : p.tax_id ? `ID ${p.tax_id}` : null].filter(Boolean).join(' · ')}</p></div>
        <div className="row">{vendor && <Link className="btn pri" href="/payment-requests/new">Pay a vendor or subcontractor</Link>}<Link className="btn" href={listHref(kind)}>All {vendor ? (p.is_sub ? 'subcontractors' : 'vendors') : 'customers'}</Link></div></div>
      {q.error && <div className="msg bad">{q.error}</div>}
      {q.ok && <div className="msg good">{q.ok}</div>}
      <div className="tiles"><div className="tile"><div className="k">{vendor ? 'We owe them' : 'They owe us'}</div><div className="v mono">{fmt(balance)}</div></div></div>

      {vendor && (
        <div className="card">
          <h2>Unpaid invoices</h2>
          {bills.length === 0 && requests.length === 0 ? <p className="muted">Nothing unpaid.</p> : (
            <div className="tw"><table>
              <thead><tr><th>Document</th><th>Date</th><th className="hide-sm">Vendor&apos;s no. / PO</th><th>Payment</th><th className="num">Unpaid</th></tr></thead>
              <tbody>
                {bills.map(b => <tr key={b.id}><td className="mono"><Link href={`/purchasing/invoices/${b.id}`}>{b.no}</Link></td><td className="mono">{b.date}</td><td className="hide-sm">{b.ref}{b.po_no ? ` · ${b.po_no}` : ''}</td>
                  <td>{b.request_id ? <Link href={`/payment-requests/${b.request_id}`}>{b.request_no}</Link> : <span className="muted">not yet requested</span>}</td><td className="num">{fmt(b.open)}</td></tr>)}
                {requests.map(r => <tr key={r.id}><td className="mono"><Link href={`/payment-requests/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td><td className="hide-sm">Payment request</td>
                  <td>{r.status === 'posted' ? 'approved' : 'waiting for approval'}</td><td className="num">{fmt(r.net - r.paid)}</td></tr>)}
              </tbody></table></div>)}
        </div>)}

      {vendor && <div className="card"><h2>Documents</h2>
        <p className="muted" style={{ marginTop: 0 }}>The Tax ID card (required) and the commercial record.</p>
        <Attachments entity="vendor" id={id} path={`/vendors/${id}`} items={files} userId={user.id} canRemove={may} locked={false} /></div>}

      <div className="card">
        <h2>Account · {ctrl}</h2>
        {lines.length === 0 ? <p className="muted">No posted movements.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Date</th><th>Entry</th><th className="hide-sm">Ref</th><th>Description</th><th className="num">{vendor ? 'Paid' : 'Invoiced'}</th><th className="num">{vendor ? 'Invoiced' : 'Received'}</th><th className="num">Balance</th></tr></thead>
            <tbody>{lines.map((l, i) => { run += sign * (l.dr - l.cr); return (
              <tr key={i}><td className="mono">{l.date}</td><td className="mono"><Link href={`/entries/${l.entry_id}`}>{l.no}</Link></td><td className="mono hide-sm">{l.payment_ref ?? ''}</td><td dir="auto">{l.memo}</td>
                <td className="num">{l.dr ? fmt(l.dr) : ''}</td><td className="num">{l.cr ? fmt(l.cr) : ''}</td><td className="num">{fmt(run)}</td></tr>); })}</tbody>
          </table></div>)}
      </div>
      {may && <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit details</summary>
        <form action={updatePartyAction.bind(null, id, p.type)} style={{ marginTop: 10 }}>
          <PartyFields kind={kind} types={types} p={p} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            {vendor ? <button className="btn" formAction={subAction.bind(null, id, !p.is_sub)} formNoValidate>{p.is_sub ? 'Move to Vendors' : 'Move to Subcontractors'}</button> : <span />}
            <button className="btn pri">Save</button></div>
        </form></details>}
    </>
  );
}
