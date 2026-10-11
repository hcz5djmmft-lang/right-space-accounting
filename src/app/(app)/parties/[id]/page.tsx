import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { getSettings } from '@/lib/books';
import { unpaidBills } from '@/lib/purchasing';

/** A vendor's or customer's account: what is unpaid, and every posted movement on payables (or receivables). */
export default async function PartyAccount({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [p] = await sql<{ id: string; code: string | null; type: 'customer' | 'vendor'; name: string; full_name: string | null; phone: string | null; email: string | null; bank_name: string | null; iban: string | null }[]>`
    select id, code, type, name, full_name, phone, email, bank_name, iban from parties where id = ${id}`;
  if (!p) notFound();
  const s = await getSettings();
  const vendor = p.type === 'vendor';
  const ctrl = vendor ? s.account_map.ap : s.account_map.ar;
  const [lines, bills, requests] = await Promise.all([
    sql<{ entry_id: string; no: string; date: string; memo: string; payment_ref: string | null; dr: number; cr: number }[]>`
      select e.id entry_id, e.no, to_char(e.date,'YYYY-MM-DD') date, coalesce(nullif(l.description, ''), e.memo) memo, e.payment_ref, l.dr, l.cr
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where l.party_id = ${id} and l.account = ${ctrl} order by e.date, e.no, l.line_no`,
    vendor ? unpaidBills(id) : Promise.resolve([]),
    vendor ? sql<{ id: string; no: string; date: string; net: number; paid: number; status: string }[]>`
      select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.net, invoice_paid(i.id) paid, i.status from invoices i
      where i.kind = 'purchase' and i.po_id is null and i.party_id = ${id} and i.status in ('pending', 'posted') and i.net - invoice_paid(i.id) > 0.004 order by i.date, i.no` : Promise.resolve([]),
  ]);
  const sign = vendor ? -1 : 1;
  let run = 0;
  const balance = lines.reduce((t, l) => t + sign * (l.dr - l.cr), 0);
  return (
    <>
      <div className="head"><div><h1>{p.name} <span className="muted mono" style={{ fontSize: 16 }}>{p.code}</span></h1>
        <p dir="auto">{[p.full_name !== p.name ? p.full_name : null, p.phone, p.email, p.bank_name, p.iban ? 'IBAN on file' : null].filter(Boolean).join(' · ') || (vendor ? 'Vendor' : 'Customer')}</p></div>
        <div className="row">{vendor && <Link className="btn pri" href="/payment-requests/new">New payment request</Link>}<Link className="btn" href={`/parties?tab=${p.type}`}>All {vendor ? 'vendors' : 'customers'}</Link></div></div>
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
    </>
  );
}
