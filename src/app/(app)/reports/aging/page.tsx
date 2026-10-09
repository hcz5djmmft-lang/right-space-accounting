import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { BUCKETS, aging, today } from '@/lib/reports';
import { ReportTools } from '@/components/ReportTools';

export default async function AgingReport({ searchParams }: { searchParams: Promise<{ side?: string; to?: string }> }) {
  await requireUser();
  const q = await searchParams;
  const side = q.side === 'sales' ? 'sales' : 'purchase', asOf = q.to || today();
  const a = await aging({ side, asOf });
  const who = side === 'sales' ? 'Customer' : 'Vendor';
  const href = (id: string) => (side === 'sales' ? `/sales-invoices/${id}` : `/payment-requests/${id}`);
  return (
    <>
      <div className="head"><div><h1>Aging</h1><p>{side === 'sales' ? 'Receivables from customers' : 'Payables to vendors'} as of {asOf}, by days past due</p></div><ReportTools report="aging" query={{ side, to: asOf }} /></div>
      <form className="row card noprint" style={{ alignItems: 'end' }}>
        <label className="f"><span>Show</span><select className="inp" name="side" defaultValue={side}><option value="purchase">Payables (vendors)</option><option value="sales">Receivables (customers)</option></select></label>
        <label className="f"><span>As of</span><input className="inp" type="date" name="to" defaultValue={asOf} /></label>
        <button className="btn">Show</button>
      </form>
      {a.parties.length === 0 ? <div className="empty card">Nothing outstanding.</div> : (
        <>
          <div className="tw"><table>
            <thead><tr><th>{who}</th>{BUCKETS.map(b => <th key={b} className="num">{b}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>{a.parties.map(p => <tr key={p.party_id}><td dir="auto">{p.party}</td>{p.buckets.map((v, i) => <td key={i} className="num">{v ? fmt(v) : ''}</td>)}<td className="num">{fmt(p.total)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td>{a.totals.map((v, i) => <td key={i} className="num">{fmt(v)}</td>)}<td className="num">{fmt(a.totals.reduce((s, v) => s + v, 0))}</td></tr></tfoot>
          </table></div>
          <h2 style={{ marginTop: 18 }}>Open documents <small className="muted">{a.docs.length}</small></h2>
          <div className="tw"><table>
            <thead><tr><th>Document</th><th className="hide-sm">Date</th><th>Due</th><th>{who}</th><th className="num">Days past due</th><th className="num">Open balance</th></tr></thead>
            <tbody>{a.docs.map(d => <tr key={d.id}><td className="mono"><Link href={href(d.id)}>{d.no}</Link></td><td className="mono hide-sm">{d.date}</td><td className="mono">{d.due ?? <span className="muted">—</span>}</td><td dir="auto">{d.party}</td>
              <td className="num" style={d.days > 0 ? { color: 'var(--bad)' } : undefined}>{d.days > 0 ? d.days : ''}</td><td className="num">{fmt(d.balance)}</td></tr>)}</tbody>
          </table></div>
        </>)}
      <p className="muted" style={{ fontSize: 12 }}>Open balance = {side === 'sales' ? 'invoice total' : 'request net amount'} less posted {side === 'sales' ? 'receipts' : 'payments'} dated on or before the date above. A document without a due date counts as current.</p>
    </>
  );
}
