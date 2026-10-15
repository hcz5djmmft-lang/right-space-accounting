import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { listPurchaseRequests, type PurchaseRow } from '@/lib/purchasing';

const delivery = (r: PurchaseRow) => (r.delivered <= 0 ? 'not delivered' : r.delivered >= r.subtotal - 0.004 ? 'delivered' : 'part delivered');

const TABS = [['open', 'Not fully delivered'], ['mine', 'Raised by me'], ['all', 'All']] as const;

/** Purchase orders (update 20): the purchase requests approved and turned into a PO, with their delivery and what the vendor has invoiced. */
export default async function PurchaseOrders({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab = 'open' } = await searchParams;
  const rows = (await listPurchaseRequests()).filter(r => r.status === 'approved');
  const shown = rows.filter((r: PurchaseRow) => tab === 'open' ? delivery(r) !== 'delivered' : tab === 'mine' ? r.created_by === user.id : true);
  return (
    <>
      <div className="head"><div><h1>Purchase orders</h1><p>Every approved purchase request becomes a purchase order with its PO number. The PO is delivered to the site and Finance receives the vendor&apos;s invoice on it.</p></div></div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/purchasing/orders?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {shown.length === 0 ? <div className="empty card">No purchase order here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>PO</th><th className="hide-sm">Request</th><th>Date</th><th>For</th><th className="hide-sm">Vendor</th><th>Delivery</th><th className="num">Amount</th><th className="num hide-sm">Invoiced</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}><td className="mono"><Link href={`/purchasing/${r.id}`}>{r.po_no ?? r.no}</Link></td><td className="mono hide-sm">{r.no}</td><td className="mono">{r.date}</td>
              <td>{r.cc}</td><td className="hide-sm" dir="auto">{r.vendor ?? '—'}</td>
              <td><span className={'pill ' + (delivery(r) === 'delivered' ? 'posted' : delivery(r) === 'part delivered' ? 'pending' : '')}>{delivery(r)}{r.delivery_date && delivery(r) !== 'delivered' ? ` · ${r.delivery_date}` : ''}</span></td>
              <td className="num">{fmt(r.subtotal)}</td><td className="num hide-sm">{fmt(r.received)}</td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
