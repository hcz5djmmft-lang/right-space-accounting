import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { VENDOR_CATEGORIES, listVendors, stars } from '@/lib/procurement';

/** The vendor list with categories, rating, open POs and spend; the master data stays in Vendors & subcontractors. */
export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await requireUser();
  const { category = '' } = await searchParams;
  const vendors = await listVendors(category || undefined);
  return (
    <>
      <div className="head"><div><h1>Vendors</h1><p>Suppliers and subcontractors with their categories, documents, price history and rating. Add a vendor in Vendors &amp; subcontractors; open one here for its profile.</p></div>
        <div className="row"><Link className="btn pri" href="/vendors">Vendors &amp; subcontractors</Link><Link className="btn" href="/purchasing">Purchasing</Link></div></div>
      <div className="tabs"><Link href="/purchasing/vendors" className={!category ? 'on' : ''}>All</Link>{VENDOR_CATEGORIES.map(c => <Link key={c} href={`/purchasing/vendors?category=${encodeURIComponent(c)}`} className={category === c ? 'on' : ''}>{c}</Link>)}</div>
      {vendors.length === 0 ? <div className="empty card">No vendor here yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Vendor</th><th className="hide-sm">Categories</th><th>Rating</th><th className="num">Open POs</th><th className="num hide-sm">Work orders</th><th className="num">Spend</th><th className="hide-sm">Last PO</th></tr></thead>
          <tbody>{vendors.map(v => <tr key={v.id}><td dir="auto"><Link href={`/purchasing/vendors/${v.id}`}>{v.name}</Link>{v.phone ? <div className="muted" style={{ fontSize: 12 }}>{v.phone}</div> : null}</td>
            <td className="hide-sm" style={{ fontSize: 13 }}>{v.categories.join(', ') || <span className="muted">—</span>}</td><td style={{ letterSpacing: 1 }}>{stars(v.rating) || <span className="muted">not rated</span>}</td>
            <td className="num mono">{v.open_pos || ''}</td><td className="num mono hide-sm">{v.work_orders || ''}</td><td className="num mono">{v.spend ? fmt(v.spend) : ''}</td><td className="mono hide-sm">{v.last_order ?? ''}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
