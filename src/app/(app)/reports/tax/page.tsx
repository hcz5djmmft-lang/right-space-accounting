import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/books';
import { fmt } from '@/lib/money';
import { fiscalYearStart, taxReport, today } from '@/lib/reports';
import { ReportTools } from '@/components/ReportTools';

export default async function TaxReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser();
  const q = await searchParams;
  const settings = await getSettings();
  const from = q.from || fiscalYearStart(settings), to = q.to || today();
  const t = await taxReport({ from, to }, settings.account_map);
  return (
    <>
      <div className="head"><div><h1>VAT, WHT and deductions</h1><p>{from} to {to}</p></div><ReportTools report="tax" query={{ from, to }} /></div>
      <form className="row card noprint" style={{ alignItems: 'end' }}>
        <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
        <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
        <button className="btn">Show</button>
      </form>
      <div className="tiles">
        <div className="tile"><div className="k">Output VAT in period</div><div className="v mono">{fmt(t.outputVat)}</div></div>
        <div className="tile"><div className="k">Input VAT in period</div><div className="v mono">{fmt(t.inputVat)}</div></div>
        <div className="tile"><div className="k">Net VAT {t.netVat >= 0 ? 'payable' : 'credit'}</div><div className="v mono">{fmt(Math.abs(t.netVat))}</div></div>
      </div>
      <div className="tw"><table>
        <thead><tr><th>Tax / deduction account</th><th className="num">Opening (Dr−Cr)</th><th className="num hide-sm">Debits</th><th className="num hide-sm">Credits</th><th className="num">Closing (Dr−Cr)</th></tr></thead>
        <tbody>{t.accounts.map(a => <tr key={a.key}><td>{a.label} <Link className="muted mono" href={`/reports/ledger?account=${a.code}&from=${from}&to=${to}`}>{a.code}</Link></td><td className="num">{fmt(a.opening)}</td><td className="num hide-sm">{a.dr ? fmt(a.dr) : ''}</td><td className="num hide-sm">{a.cr ? fmt(a.cr) : ''}</td><td className="num">{fmt(a.closing)}</td></tr>)}</tbody>
      </table></div>
      <h2 style={{ marginTop: 18 }}>Withholding tax and social insurance deducted <small className="muted">for the WHT return</small></h2>
      {t.deductions.length === 0 ? <p className="muted">No deductions in this period.</p> : (
        <div className="tw"><table>
          <thead><tr><th>Request</th><th className="hide-sm">Date</th><th>Vendor</th><th className="hide-sm">Tax ID</th><th className="num">Base</th><th className="num">WHT</th><th className="num">SI</th></tr></thead>
          <tbody>{t.deductions.map(d => <tr key={d.id}><td className="mono"><Link href={`/payment-requests/${d.id}`}>{d.no}</Link></td><td className="mono hide-sm">{d.date}</td><td dir="auto">{d.vendor}</td><td className="mono hide-sm">{d.tax_id ?? ''}</td>
            <td className="num">{fmt(d.subtotal)}</td><td className="num">{d.wht ? <>{fmt(d.wht)} <span className="muted">{d.wht_rate}%</span></> : ''}</td><td className="num">{d.si ? <>{fmt(d.si)} <span className="muted">{d.si_rate}%</span></> : ''}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
