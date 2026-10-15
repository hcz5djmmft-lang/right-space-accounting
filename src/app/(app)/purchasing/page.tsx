import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { getSteps, canSign } from '@/lib/documents';
import { isProcurement, listPurchaseRequests, stateOf, type PurchaseRow } from '@/lib/purchasing';
import { raiseLateDeliveryTasks } from '@/lib/procurement';

const TABS = [['waiting', 'Waiting for me'], ['assigned', 'Assigned to me'], ['mine', 'Raised by me'], ['all', 'All']] as const;
const pill = (s: string) => (s === 'approved' ? 'posted' : s === 'rejected' || s === 'cancelled' ? 'rejected' : s === 'draft' ? '' : 'pending');

/** Purchase requests still on their way (update 20): once approved a request becomes a purchase order and moves to
 *  Procurement > Purchase orders. What waits for me, what is assigned to me to buy, what I raised. */
export default async function Purchasing({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { tab = 'all', ok, error } = await searchParams;
  await raiseLateDeliveryTasks().catch(e => console.error(e));
  const [rows, steps, proc] = await Promise.all([listPurchaseRequests(), getSteps(), isProcurement(user)]);
  const waiting = (r: PurchaseRow) => r.status === 'procurement' ? proc : r.status === 'head' ? canSign(user, steps[0], r) : r.status === 'management' ? canSign(user, steps[steps.length - 1]) : false;
  const requests = rows.filter(r => r.status !== 'approved');
  const shown = requests.filter(r => tab === 'waiting' ? waiting(r) : tab === 'assigned' ? r.buyer_id === user.id && r.status !== 'cancelled' : tab === 'mine' ? r.created_by === user.id : true);
  return (
    <>
      <div className="head"><div><h1>Purchase requests</h1><p>Purchase requests go to Procurement for prices and the vendor (quotations compared side by side), then the department head or the procurement head, then Management. Once approved a request becomes a purchase order and moves to <Link href="/purchasing/orders">Purchase orders</Link>. Assigned to me lists the requests a procurement engineer is buying.</p></div>
        <div className="row"><Link className="btn pri" href="/purchasing/new">New purchase request</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/purchasing?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {shown.length === 0 ? <div className="empty card">Nothing here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>For</th><th className="hide-sm">Vendor</th><th className="hide-sm">Buyer</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}><td className="mono"><Link href={`/purchasing/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td>
              <td>{r.cc}</td><td className="hide-sm" dir="auto">{r.vendor ?? '—'}{r.quotes > 0 && r.status === 'procurement' ? <span className="muted"> · {r.quotes} offer{r.quotes === 1 ? '' : 's'}</span> : null}</td><td className="hide-sm">{r.buyer ?? ''}</td>
              <td><span className={'pill ' + pill(r.status)}>{stateOf(r)}</span></td>
              <td className="num">{r.subtotal ? fmt(r.subtotal) : '—'}</td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
