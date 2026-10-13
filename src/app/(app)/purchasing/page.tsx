import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { getSteps, canSign } from '@/lib/documents';
import { isProcurement, listPurchaseRequests, stateOf, type PurchaseRow } from '@/lib/purchasing';
import { raiseLateDeliveryTasks } from '@/lib/procurement';

const TABS = [['waiting', 'Waiting for me'], ['assigned', 'Assigned to me'], ['mine', 'Raised by me'], ['po', 'PO'], ['all', 'All']] as const;
const pill = (s: string) => (s === 'approved' ? 'posted' : s === 'rejected' || s === 'cancelled' ? 'rejected' : s === 'draft' ? '' : 'pending');
const delivery = (r: PurchaseRow) => (r.status !== 'approved' ? '' : r.delivered <= 0 ? 'not delivered' : r.delivered >= r.subtotal - 0.004 ? 'delivered' : 'part delivered');

/** Purchase requests and purchase orders: what waits for me, what is assigned to me to buy, and the POs on their own. */
export default async function Purchasing({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { tab = 'all', ok, error } = await searchParams;
  await raiseLateDeliveryTasks().catch(e => console.error(e));
  const [rows, steps, proc] = await Promise.all([listPurchaseRequests(), getSteps(), isProcurement(user)]);
  const waiting = (r: PurchaseRow) => r.status === 'procurement' ? proc : r.status === 'head' ? canSign(user, steps[0], r) : r.status === 'management' ? canSign(user, steps[steps.length - 1]) : false;
  const shown = rows.filter(r => tab === 'waiting' ? waiting(r) : tab === 'assigned' ? r.buyer_id === user.id && !['approved', 'cancelled'].includes(r.status) : tab === 'mine' ? r.created_by === user.id : tab === 'po' ? r.status === 'approved' : true);
  return (
    <>
      <div className="head"><div><h1>Purchasing</h1><p>Purchase requests go to Procurement for prices and the vendor (quotations compared side by side), then the department head or the procurement head, then Management, and become purchase orders. A PO is delivered to the site and Finance receives the vendor&apos;s invoice on it. Assigned to me lists the requests a procurement engineer is buying; once approved they move to PO.</p></div>
        <div className="row"><Link className="btn pri" href="/purchasing/new">New purchase request</Link><Link className="btn" href="/purchasing/plan">Material plan</Link><Link className="btn" href="/purchasing/vendors">Vendors</Link><Link className="btn" href="/purchasing/work-orders">Work orders</Link><Link className="btn" href="/purchasing/stock">Site stock</Link><Link className="btn" href="/purchasing/reports">Reports</Link><Link className="btn" href="/purchasing/materials">Materials</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/purchasing?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {shown.length === 0 ? <div className="empty card">Nothing here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>PO</th><th>Date</th><th>For</th><th className="hide-sm">Vendor</th><th className="hide-sm">Buyer</th><th>Status</th><th className="hide-sm">Delivery</th><th className="num">Amount</th><th className="num hide-sm">Invoiced</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}><td className="mono"><Link href={`/purchasing/${r.id}`}>{r.no}</Link></td><td className="mono">{r.po_no ?? ''}</td><td className="mono">{r.date}</td>
              <td>{r.cc}</td><td className="hide-sm" dir="auto">{r.vendor ?? '—'}{r.quotes > 0 && r.status === 'procurement' ? <span className="muted"> · {r.quotes} offer{r.quotes === 1 ? '' : 's'}</span> : null}</td><td className="hide-sm">{r.buyer ?? ''}</td>
              <td><span className={'pill ' + pill(r.status)}>{stateOf(r)}</span></td>
              <td className="hide-sm">{delivery(r) && <span className={'pill ' + (delivery(r) === 'delivered' ? 'posted' : delivery(r) === 'part delivered' ? 'pending' : '')}>{delivery(r)}{r.delivery_date && delivery(r) !== 'delivered' ? ` · ${r.delivery_date}` : ''}</span>}</td>
              <td className="num">{r.subtotal ? fmt(r.subtotal) : '—'}</td>
              <td className="num hide-sm">{r.status === 'approved' ? fmt(r.received) : ''}</td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
