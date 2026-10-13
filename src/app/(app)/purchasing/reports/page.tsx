import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { sql } from '@/lib/db';
import { budgetSummary, committedVsBudget, deliveriesDue, deliveryLabel, openPOs, priceHistory, spendByProject, spendByVendor } from '@/lib/procurement';

const TABS = [['open', 'Open POs'], ['due', 'Deliveries due'], ['vendor', 'Spend by vendor'], ['project', 'Spend by project'], ['prices', 'Price history'], ['budget', 'Committed vs budget']] as const;

/** Procurement reports: open POs, deliveries due this week, spend per vendor and per project, price history per material, committed cost against the BOQ budget. */
export default async function ProcurementReports({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; material?: string; project?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? 'open';
  const now = today();
  const from = sp.from ?? `${now.slice(0, 4)}-01-01`, to = sp.to ?? now;
  return (
    <>
      <div className="head"><div><h1>Procurement reports</h1><p>What is on order and when it is due, what was spent with whom and on what, what each material cost over time, and what each project has committed against its BOQ budget.</p></div>
        <Link className="btn" href="/purchasing">Purchasing</Link></div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/purchasing/reports?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {(tab === 'open' || tab === 'due') && <OpenTable rows={tab === 'open' ? await openPOs(now) : await deliveriesDue(now)} due={tab === 'due'} />}
      {(tab === 'vendor' || tab === 'project') && (
        <>
          <form className="card row" style={{ alignItems: 'end' }}>
            <input type="hidden" name="tab" value={tab} />
            <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
            <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
            <button className="btn">Show</button>
          </form>
          <SpendTable rows={tab === 'vendor' ? await spendByVendor(from, to) : await spendByProject(from, to)} what={tab === 'vendor' ? 'Vendor' : 'Project / department'} />
        </>)}
      {tab === 'prices' && <Prices material={sp.material ?? ''} />}
      {tab === 'budget' && <Budget project={sp.project ?? ''} />}
    </>
  );
}

function OpenTable({ rows, due }: { rows: Awaited<ReturnType<typeof openPOs>>; due: boolean }) {
  if (!rows.length) return <div className="empty card">{due ? 'Nothing due this week, nothing late.' : 'No open purchase order.'}</div>;
  return (
    <div className="tw"><table>
      <thead><tr><th>PO</th><th>Date</th><th>For</th><th>Vendor</th><th className="hide-sm">Buyer</th><th>Promised</th><th>Delivery</th><th className="num">Ordered</th><th className="num hide-sm">Delivered</th><th className="num hide-sm">Invoiced</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td className="mono"><Link href={`/purchasing/${r.id}`}>{r.po_no}</Link></td><td className="mono">{r.po_date}</td><td>{r.cc}</td><td dir="auto">{r.vendor ?? '—'}</td><td className="hide-sm">{r.buyer ?? ''}</td>
        <td className="mono">{r.due ?? <span className="muted">—</span>}</td><td><span className={'pill ' + (r.state === 'full' ? 'posted' : r.late ? 'rejected' : r.state === 'part' ? 'pending' : '')}>{deliveryLabel[r.state]}{r.late ? ` · ${r.late} d late` : ''}</span></td>
        <td className="num mono">{fmt(r.subtotal)}</td><td className="num mono hide-sm">{fmt(r.delivered)}</td><td className="num mono hide-sm">{fmt(r.received)}</td></tr>)}
        <tr className="tot"><td colSpan={7}><b>{rows.length} purchase order{rows.length === 1 ? '' : 's'}</b></td><td className="num mono"><b>{fmt(rows.reduce((t, r) => t + r.subtotal, 0))}</b></td><td className="num mono hide-sm"><b>{fmt(rows.reduce((t, r) => t + r.delivered, 0))}</b></td><td className="num mono hide-sm"><b>{fmt(rows.reduce((t, r) => t + r.received, 0))}</b></td></tr></tbody>
    </table></div>);
}

function SpendTable({ rows, what }: { rows: Awaited<ReturnType<typeof spendByVendor>>; what: string }) {
  if (!rows.length) return <div className="empty card">No vendor invoice posted in this period.</div>;
  const total = rows.reduce((t, r) => t + r.amount, 0);
  return (
    <div className="tw"><table>
      <thead><tr><th>{what}</th><th className="num">Invoices</th><th className="num">Before VAT</th><th className="num hide-sm">VAT</th><th className="num">Share</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td dir="auto">{r.name}</td><td className="num mono">{r.invoices}</td><td className="num mono">{fmt(r.amount)}</td><td className="num mono hide-sm">{fmt(r.vat)}</td><td className="num mono">{total ? Math.round((r.amount / total) * 100) : 0} %</td></tr>)}
        <tr className="tot"><td><b>Total</b></td><td className="num mono"><b>{rows.reduce((t, r) => t + r.invoices, 0)}</b></td><td className="num mono"><b>{fmt(total)}</b></td><td className="num mono hide-sm"><b>{fmt(rows.reduce((t, r) => t + r.vat, 0))}</b></td><td></td></tr></tbody>
    </table></div>);
}

async function Prices({ material }: { material: string }) {
  const [materials, rows] = await Promise.all([sql<{ id: string; name: string }[]>`select id, name from materials where active order by name`, priceHistory({ material: material || undefined })]);
  return (
    <>
      <form className="card row" style={{ alignItems: 'end' }}>
        <input type="hidden" name="tab" value="prices" />
        <label className="f" style={{ minWidth: 240 }}><span>Material</span><select className="inp" name="material" defaultValue={material}><option value="">Every material</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button className="btn">Show</button>
      </form>
      {rows.length === 0 ? <div className="empty card">No price paid or quoted yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Material</th><th>Date</th><th>Vendor</th><th className="num">Price</th><th>Source</th></tr></thead>
          <tbody>{rows.map((p, i) => <tr key={i}><td dir="auto">{p.material}</td><td className="mono">{p.date}</td><td dir="auto">{p.vendor ?? '—'}</td><td className="num mono">{fmt(p.price)}</td><td><Link href={p.href}>{p.source} {p.ref}</Link></td></tr>)}</tbody>
        </table></div>)}
    </>);
}

async function Budget({ project }: { project: string }) {
  const projects = await budgetSummary();
  const cur = projects.find(p => p.id === project) ?? null;
  const detail = cur ? await committedVsBudget(cur.id) : null;
  return (
    <>
      {projects.length === 0 ? <div className="empty card">No project has a BOQ budget or commitments yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="num">Budget (BOQ)</th><th className="num hide-sm">POs</th><th className="num hide-sm">Work orders</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Remaining</th><th>Over</th><th></th></tr></thead>
          <tbody>{projects.map(p => <tr key={p.id} style={cur?.id === p.id ? { background: 'var(--soft, #f6f6f4)' } : undefined}><td><Link href={`/cost-centers/${p.id}`}>{p.code}</Link></td><td className="num mono">{fmt(p.budget)}</td><td className="num mono hide-sm">{fmt(p.po)}</td><td className="num mono hide-sm">{fmt(p.wo)}</td>
            <td className="num mono">{fmt(p.committed)}</td><td className="num mono">{fmt(p.actual)}</td><td className="num mono" style={p.remaining < 0 ? { color: 'var(--bad, #b3261e)' } : undefined}>{fmt(p.remaining)}</td>
            <td>{p.over ? <span className="pill rejected">{p.over} code{p.over === 1 ? '' : 's'}</span> : <span className="pill posted">within</span>}</td><td><Link className="btn sm" href={`/purchasing/reports?tab=budget&project=${p.id}`}>Per code</Link></td></tr>)}</tbody>
        </table></div>)}
      {cur && detail && (
        <div className="card"><h2 style={{ marginTop: 0 }}>{cur.code} · per GL code</h2>
          <div className="tw"><table>
            <thead><tr><th>GL code</th><th className="num">Budget</th><th className="num hide-sm">POs</th><th className="num hide-sm">Work orders</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Remaining</th></tr></thead>
            <tbody>{detail.rows.map((r, i) => <tr key={i} style={r.over ? { background: 'var(--bad-soft, #fdeceb)' } : undefined}><td dir="auto"><span className="mono">{r.code ?? '—'}</span> · {r.name}{r.over ? <span className="pill rejected" style={{ marginLeft: 6 }}>over</span> : null}</td><td className="num mono">{fmt(r.budget)}</td><td className="num mono hide-sm">{fmt(r.po)}</td><td className="num mono hide-sm">{fmt(r.wo)}</td><td className="num mono">{fmt(r.committed)}</td><td className="num mono">{fmt(r.actual)}</td><td className="num mono">{fmt(r.remaining)}</td></tr>)}
              <tr className="tot"><td><b>Total</b></td><td className="num mono"><b>{fmt(detail.total.budget)}</b></td><td className="num mono hide-sm"><b>{fmt(detail.total.po)}</b></td><td className="num mono hide-sm"><b>{fmt(detail.total.wo)}</b></td><td className="num mono"><b>{fmt(detail.total.committed)}</b></td><td className="num mono"><b>{fmt(detail.total.actual)}</b></td><td className="num mono"><b>{fmt(detail.total.remaining)}</b></td></tr></tbody>
          </table></div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Committed = issued purchase orders and work orders at their ordered value; actual = what is posted in the books. A code is over when either passes its budget, so cost control sees it before the invoices arrive.</p></div>)}
    </>);
}
