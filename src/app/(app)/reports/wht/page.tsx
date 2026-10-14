import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { quarterOf, whtSuppliers } from '@/lib/tax-returns';
import { ReportTools } from '@/components/ReportTools';

/** WHT certificates per supplier (improvement 10): who had tax withheld in the period, each with a printable certificate. */
export default async function Wht({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser('finance');
  const q = await searchParams;
  const qt = quarterOf(today());
  const from = q.from || qt.from, to = q.to || qt.to;
  const rows = await whtSuppliers(from, to);
  const quarters = [0, 1, 2, 3].map(k => quarterOf(`${today().slice(0, 4)}-${String(k * 3 + 1).padStart(2, '0')}-01`));
  return (
    <>
      <div className="head"><div><h1>WHT certificates</h1><p>Tax withheld from each supplier, {from} to {to}. Open a certificate and print it to PDF for the supplier.</p></div><ReportTools report="wht" query={{ from, to }} /></div>
      <form className="row card noprint" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
        <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
        <button className="btn">Show</button>
        {quarters.map(x => <Link key={x.label} className="btn sm" href={`/reports/wht?from=${x.from}&to=${x.to}`}>{x.label}</Link>)}
      </form>
      {rows.length === 0 ? <p className="muted">No tax was withheld in this period.</p> : (
        <div className="tw"><table>
          <thead><tr><th>Supplier</th><th className="hide-sm">Tax ID</th><th className="num">Documents</th><th className="num">Base</th><th className="num">WHT</th><th></th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.party_id}><td dir="auto">{r.full_name || r.party}</td><td className="mono hide-sm">{r.tax_id ?? <span className="muted">missing</span>}</td><td className="num">{r.docs}</td><td className="num">{fmt(r.base)}</td><td className="num">{fmt(r.wht)}</td>
            <td><a className="btn sm" href={`/print/wht/${r.party_id}?from=${from}&to=${to}`} target="_blank" rel="noreferrer">Certificate</a></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}><b>Total</b></td><td className="num"><b>{fmt(rows.reduce((t, r) => t + r.base, 0))}</b></td><td className="num"><b>{fmt(rows.reduce((t, r) => t + r.wht, 0))}</b></td><td></td></tr></tfoot>
        </table></div>)}
    </>
  );
}
