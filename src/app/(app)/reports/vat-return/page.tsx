import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { vatReturn, type VatDoc } from '@/lib/tax-returns';
import { ReportTools } from '@/components/ReportTools';
import { prepareAction, unprepareAction } from './actions';

const prevMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

function Docs({ title, rows, base = true }: { title: string; rows: VatDoc[]; base?: boolean }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{title} <small className="muted">{rows.length}</small></h2>
      <div className="tw"><table>
        <thead><tr><th>Document</th><th className="hide-sm">Date</th><th>Party</th><th className="hide-sm">Tax ID</th>{base && <th className="num">Base</th>}<th className="num">VAT</th></tr></thead>
        <tbody>{rows.map(d => <tr key={d.id}><td className="mono"><Link href={d.href}>{d.no}</Link></td><td className="mono hide-sm">{d.date}</td><td dir="auto">{d.party}</td><td className="mono hide-sm">{d.tax_id ?? ''}</td>{base && <td className="num">{d.base === null ? '' : fmt(d.base)}</td>}<td className="num">{fmt(d.vat)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={base ? 5 : 4}><b>Total</b></td><td className="num"><b>{fmt(rows.reduce((t, d) => t + d.vat, 0))}</b></td></tr></tfoot>
      </table></div>
    </div>);
}

/** The monthly VAT return (improvement 10). */
export default async function VatReturnPage({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; error?: string }> }) {
  await requireUser('finance');
  const q = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(q.m ?? '') ? q.m! : prevMonth(today().slice(0, 7));
  const v = await vatReturn(period);
  return (
    <>
      <div className="head"><div><h1>VAT return</h1><p>VAT 14% for {v.from} to {v.to}: output VAT on sales, less input VAT on purchases.</p></div><ReportTools report="vat-return" query={{ m: period }} /></div>
      {q.ok && <div className="msg good">{q.ok}</div>}
      {q.error && <div className="msg bad">{q.error}</div>}
      <form className="row card noprint" style={{ alignItems: 'end' }}>
        <label className="f"><span>Month</span><input className="inp" type="month" name="m" defaultValue={period} /></label>
        <button className="btn">Show</button>
        <Link className="btn" href="/reports/wht">WHT certificates</Link>
      </form>
      <div className="tiles">
        <div className="tile"><div className="k">Output VAT (sales)</div><div className="v mono">{fmt(v.outputVat)}</div></div>
        <div className="tile"><div className="k">Input VAT (purchases)</div><div className="v mono">{fmt(v.inputVat)}</div></div>
        <div className="tile"><div className="k">{v.netVat >= 0 ? 'Net VAT to pay' : 'VAT credit to carry forward'}</div><div className="v mono">{fmt(Math.abs(v.netVat))}</div></div>
      </div>
      {!v.agrees && <div className="msg bad">The documents do not add up to the VAT accounts in the books (output {fmt(v.booksOut)}, input {fmt(v.booksIn)}). Check the VAT accounts in the <Link href={`/reports/tax?from=${v.from}&to=${v.to}`}>VAT, WHT and deductions</Link> report.</div>}
      <div className="card row noprint" style={{ justifyContent: 'space-between' }}>
        {v.prepared
          ? <span><span className="pill posted">Prepared</span> by {v.prepared.by} on {v.prepared.at} · net {fmt(v.prepared.net)}{v.prepared.changed && <b style={{ color: 'var(--bad)' }}> · the figures changed since: mark it again</b>}</span>
          : <span>Not prepared yet. Check the documents, then mark it prepared: the month-end close ticks it.</span>}
        <span className="row">
          {(!v.prepared || v.prepared.changed) && <form action={prepareAction.bind(null, period)}><button className="btn pri">Mark as prepared</button></form>}
          {v.prepared && <form action={unprepareAction.bind(null, period)}><button className="btn">Not prepared</button></form>}
        </span>
      </div>
      <Docs title="Output VAT: sales invoices" rows={v.sales} />
      <Docs title="Output VAT: other entries" rows={v.otherOut} base={false} />
      <Docs title="Input VAT: vendor invoices and payment requests" rows={v.purchases} />
      <Docs title="Input VAT: expenses and other entries" rows={v.otherIn} base={false} />
      {!v.sales.length && !v.purchases.length && !v.otherIn.length && !v.otherOut.length && <p className="muted">No VAT in this month.</p>}
    </>
  );
}
