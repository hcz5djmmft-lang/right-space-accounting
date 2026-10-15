import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { formLists } from '@/lib/form-data';
import { listVendorInvoices, type VendorInvoiceRow } from '@/lib/ap-invoices';
import { ServiceInvoiceForm } from '@/components/ServiceInvoiceForm';
import { serviceInvoiceAction } from './actions';

const TABS = [['unpaid', 'Unpaid'], ['waiting', 'Not yet on a payment request'], ['all', 'All']] as const;
const state = (r: VendorInvoiceRow) => r.status === 'void' ? 'Void' : r.open <= 0.004 ? 'Paid'
  : r.request_status === 'posted' ? `Approved on ${r.request_no}` : r.request_no ? `On ${r.request_no}` : r.paid ? 'Part paid' : 'Unpaid';

/** AP > Invoices (update 20): every vendor and subcontractor invoice, from a PO or by hand for a service. A payment request
 *  then picks the vendor's open invoices and pays them. */
export default async function ApInvoices({ searchParams }: { searchParams: Promise<{ tab?: string; new?: string; error?: string }> }) {
  await requireUser('finance');
  const { tab = 'unpaid', new: open, error } = await searchParams;
  const [rows, lists] = await Promise.all([listVendorInvoices(), formLists()]);
  const shown = rows.filter(r => tab === 'all' ? true : r.status === 'posted' && r.open > 0.004 && (tab === 'unpaid' || !r.request_no));
  const due = shown.reduce((t, r) => t + (r.status === 'posted' ? r.open : 0), 0);
  return (
    <>
      <div className="head"><div><h1>Invoices</h1><p>Vendor and subcontractor invoices, recorded before they are paid · {fmt(due)} EGP unpaid in this list</p></div>
        <div className="row"><Link className="btn pri" href="/ap-invoices?new=1">New service invoice</Link><Link className="btn" href="/payment-requests/new">Pay a vendor or subcontractor</Link></div></div>
      {error && <div className="msg bad">{error}</div>}
      {open && <ServiceInvoiceForm {...lists} date={today()} action={serviceInvoiceAction} />}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/ap-invoices?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {shown.length === 0 ? <div className="empty card">Nothing here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Vendor</th><th className="hide-sm">Vendor&apos;s no.</th><th className="hide-sm">Cost center</th><th className="hide-sm">PO</th><th>Status</th><th className="num">Net</th><th className="num">Unpaid</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}><td className="mono"><Link href={`/purchasing/invoices/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td>
              <td dir="auto">{r.vendor}{r.code ? <span className="muted mono"> · {r.code}</span> : null}</td><td className="hide-sm">{r.ref}</td><td className="hide-sm">{r.cc ?? '—'}</td>
              <td className="mono hide-sm">{r.po_no ?? 'Service'}</td>
              <td><span className={'pill ' + (r.status === 'void' ? 'rejected' : r.open <= 0.004 ? 'posted' : 'pending')}>{state(r)}</span></td>
              <td className="num">{fmt(r.net)}</td><td className="num">{fmt(r.status === 'void' ? 0 : r.open)}</td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
