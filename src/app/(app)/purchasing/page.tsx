import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { getSteps, canSign } from '@/lib/documents';
import { isProcurement, listPurchaseRequests, stateOf, type PurchaseRow } from '@/lib/purchasing';

const TABS = [['waiting', 'Waiting for me'], ['mine', 'Raised by me'], ['orders', 'Purchase orders'], ['all', 'All']] as const;
const pill = (s: string) => (s === 'approved' ? 'posted' : s === 'rejected' || s === 'cancelled' ? 'rejected' : s === 'draft' ? '' : 'pending');

/** Purchase requests and purchase orders. */
export default async function Purchasing({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab = 'all' } = await searchParams;
  const [rows, steps, proc] = await Promise.all([listPurchaseRequests(), getSteps(), isProcurement(user)]);
  const waiting = (r: PurchaseRow) => r.status === 'procurement' ? proc : r.status === 'head' ? canSign(user, steps[0], r) : r.status === 'management' ? canSign(user, steps[steps.length - 1]) : false;
  const shown = rows.filter(r => tab === 'waiting' ? waiting(r) : tab === 'mine' ? r.created_by === user.id : tab === 'orders' ? r.status === 'approved' : true);
  return (
    <>
      <div className="head"><div><h1>Purchasing</h1><p>Purchase requests go to Procurement for prices and the vendor, then the department head (a project: the head of Engineering), then Management, and become purchase orders. Finance receives the vendor&apos;s invoice on the PO.</p></div>
        <div className="row"><Link className="btn pri" href="/purchasing/new">New purchase request</Link><Link className="btn" href="/purchasing/materials">Materials</Link></div></div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/purchasing?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {shown.length === 0 ? <div className="empty card">Nothing here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>PO</th><th>Date</th><th>For</th><th className="hide-sm">Vendor</th><th>Status</th><th className="num">Amount</th><th className="num hide-sm">Received</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}><td className="mono"><Link href={`/purchasing/${r.id}`}>{r.no}</Link></td><td className="mono">{r.po_no ?? ''}</td><td className="mono">{r.date}</td>
              <td>{r.cc}</td><td className="hide-sm" dir="auto">{r.vendor ?? '—'}</td>
              <td><span className={'pill ' + pill(r.status)}>{stateOf(r)}</span></td><td className="num">{r.subtotal ? fmt(r.subtotal) : '—'}</td>
              <td className="num hide-sm">{r.status === 'approved' ? fmt(r.received) : ''}</td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
