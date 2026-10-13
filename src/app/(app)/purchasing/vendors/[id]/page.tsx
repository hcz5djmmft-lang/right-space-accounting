import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { fmt } from '@/lib/money';
import { sql } from '@/lib/db';
import { TZ } from '@/lib/dates';
import { listAttachments } from '@/lib/attachments';
import { isProcurement } from '@/lib/purchasing';
import { VENDOR_CATEGORIES, getVendor, priceHistory, stars, vendorOrders } from '@/lib/procurement';
import { Attachments } from '@/components/Attachments';
import { vendorProfileAction } from '../../procurement-actions';

/** A vendor's profile: categories and rating, documents, price history, POs and work orders. */
export default async function VendorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const v = await getVendor(id);
  if (!v) notFound();
  const [orders, prices, files, proc, log] = await Promise.all([vendorOrders(id), priceHistory({ vendor: id }), listAttachments('vendor', id), isProcurement(user),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'vendor' and g.entity_id = ${id} order by g.at desc limit 20`]);
  const may = proc || hasRole(user, 'finance', 'engineering', 'projects');
  return (
    <>
      <div className="head"><div><h1 dir="auto">{v.name} <span className="muted mono" style={{ fontSize: 16 }}>{v.code}</span></h1>
        <p dir="auto">{[v.full_name !== v.name ? v.full_name : null, v.phone, v.email].filter(Boolean).join(' · ') || 'Vendor'}{v.categories.length ? ` · ${v.categories.join(', ')}` : ''}{v.rating ? ` · ${stars(v.rating)}` : ''}</p></div>
        <div className="row"><Link className="btn" href={`/parties/${id}`}>Account and unpaid invoices</Link><Link className="btn" href="/purchasing/vendors">All vendors</Link></div></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Open POs</div><div className="v mono">{v.open_pos}</div></div>
        <div className="tile"><div className="k">Work orders</div><div className="v mono">{v.work_orders}</div></div>
        <div className="tile"><div className="k">Spend (invoiced, before VAT)</div><div className="v mono">{fmt(v.spend)}</div></div>
        <div className="tile"><div className="k">Rating</div><div className="v" style={{ letterSpacing: 2 }}>{stars(v.rating) || <span className="muted" style={{ fontSize: 14 }}>not rated</span>}</div></div>
      </div>

      {may && (
        <form action={vendorProfileAction.bind(null, id)} className="card">
          <h2 style={{ marginTop: 0 }}>Profile</h2>
          <div className="f"><span>Categories</span>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{VENDOR_CATEGORIES.map(c => <label key={c} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 14 }}><input type="checkbox" name="category" value={c} defaultChecked={v.categories.includes(c)} />{c}</label>)}</div></div>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <label className="f"><span>Rating</span><select className="inp" name="rating" defaultValue={v.rating ?? ''}><option value="">Not rated</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{stars(n)} · {['', 'Poor', 'Weak', 'Fair', 'Good', 'Excellent'][n]}</option>)}</select></label>
            <label className="f"><span>Why</span><input className="inp" name="rating_note" dir="auto" defaultValue={v.rating_note} placeholder="Delivers on time, prices fair…" /></label>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}><span className="muted" style={{ fontSize: 13 }}>{v.rated_at ? `Rated ${v.rated_at}${v.rated_by ? ` by ${v.rated_by}` : ''}` : ''}</span><button className="btn pri">Save profile</button></div>
        </form>)}

      <div className="card"><h2 style={{ marginTop: 0 }}>Documents</h2>
        <p className="muted" style={{ fontSize: 13 }}>Commercial register, tax card, prequalification, bank letter, catalogues: photos or PDFs.</p>
        <Attachments entity="vendor" id={id} path={`/purchasing/vendors/${id}`} items={files} userId={user.id} canRemove={proc || hasRole(user, 'finance')} locked={false} /></div>

      <div className="card"><h2 style={{ marginTop: 0 }}>Purchase orders and work orders</h2>
        {orders.length === 0 ? <p className="muted">None yet.</p> : (
          <div className="tw"><table>
            <thead><tr><th>No.</th><th>Date</th><th>Project</th><th className="hide-sm">What</th><th className="num">Amount</th><th>State</th></tr></thead>
            <tbody>{orders.map(o => <tr key={o.kind + o.id}><td className="mono"><Link href={o.href}>{o.no}</Link></td><td className="mono">{o.date}</td><td>{o.cc}</td><td className="hide-sm" dir="auto" style={{ fontSize: 13 }}>{o.title}</td><td className="num mono">{fmt(o.amount)}</td><td><span className={'pill ' + (o.state === 'open' || o.state === 'approved' ? 'posted' : '')}>{o.state === 'approved' ? 'issued' : o.state}</span></td></tr>)}</tbody>
          </table></div>)}</div>

      <div className="card"><h2 style={{ marginTop: 0 }}>Price history</h2>
        {prices.length === 0 ? <p className="muted">No invoice or quotation from this vendor yet.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Material</th><th>Date</th><th className="num">Price</th><th>Source</th></tr></thead>
            <tbody>{prices.map((p, i) => <tr key={i}><td dir="auto">{p.material}</td><td className="mono">{p.date}</td><td className="num mono">{fmt(p.price)}</td><td><Link href={p.href}>{p.source} {p.ref}</Link></td></tr>)}</tbody>
          </table></div>)}</div>

      {log.length > 0 && <div className="card log"><h2 style={{ marginTop: 0 }}>History</h2>{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? ''} · {g.action}{g.note ? ` — ${g.note}` : ''}</div>)}</div>}
    </>
  );
}
