import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { categoryTitle } from '@/lib/planning-calc';
import { listWorkOrders, woState } from '@/lib/procurement';

const pill = (s: string) => (s === 'approved' ? 'posted' : s === 'rejected' || s === 'cancelled' ? 'rejected' : s === 'draft' || s === 'closed' ? '' : 'pending');

/** Work orders to subcontractors: one per work category of a project, with retention and advance, approved like POs. */
export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { tab = 'open', ok, error } = await searchParams;
  const rows = await listWorkOrders();
  const shown = rows.filter(w => tab === 'open' ? !['cancelled', 'closed'].includes(w.status) : tab === 'mine' ? w.created_by === user.id : true);
  return (
    <>
      <div className="head"><div><h1>Work orders</h1><p>A work order gives a subcontractor one work category of a project (demolition, electrical, plumbing, tiling…) with its items and rates, the retention held back and any advance. Procurement raises it, the department head and Management approve it like a purchase order, and the subcontractor&apos;s progress claims are certified against it.</p></div>
        <div className="row"><Link className="btn pri" href="/purchasing/work-orders/new">New work order</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tabs"><Link href="/purchasing/work-orders?tab=open" className={tab === 'open' ? 'on' : ''}>Open</Link><Link href="/purchasing/work-orders?tab=mine" className={tab === 'mine' ? 'on' : ''}>Raised by me</Link><Link href="/purchasing/work-orders?tab=all" className={tab === 'all' ? 'on' : ''}>All</Link></div>
      {shown.length === 0 ? <div className="empty card">No work order here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Project</th><th>Subcontractor</th><th className="hide-sm">Category</th><th className="hide-sm">Work</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody>{shown.map(w => <tr key={w.id}><td className="mono"><Link href={`/purchasing/work-orders/${w.id}`}>{w.no}</Link></td><td className="mono">{w.date}</td><td>{w.code}</td><td dir="auto">{w.vendor ?? '—'}</td>
            <td className="hide-sm" dir="auto" style={{ fontSize: 13 }}>{w.category === 'other' ? 'Other' : `${w.category} · ${categoryTitle(w.category)}`}</td><td className="hide-sm" dir="auto" style={{ fontSize: 13 }}>{w.title}</td>
            <td><span className={'pill ' + pill(w.status)}>{woState(w)}</span></td><td className="num mono">{fmt(w.amount)}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
