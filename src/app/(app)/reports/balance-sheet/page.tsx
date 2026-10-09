import { requireUser } from '@/lib/auth';
import { trialBalance } from '@/lib/books';
import { fmt } from '@/lib/money';
import { natural, type AccountType } from '@/lib/ledger';
import { ReportTools } from '@/components/ReportTools';
import { today } from '@/lib/dates';

export default async function BalanceSheet({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  await requireUser();
  const { to = today() } = await searchParams;
  const rows = await trialBalance({ to });
  const of = (t: AccountType) => rows.filter(r => r.type === t && Math.abs(r.dr - r.cr) > 0.004);
  const sum = (t: AccountType) => rows.filter(r => r.type === t).reduce((s, r) => s + natural(r.type, r.dr, r.cr), 0);
  const profit = sum('revenue') - sum('expense');
  const assets = sum('asset'), le = sum('liability') + sum('equity') + profit;
  const section = (title: string, t: AccountType) => (
    <><tr className="hdr"><td colSpan={2}>{title}</td></tr>
      {of(t).map(r => <tr key={r.code} className="lvl1"><td dir="auto"><span className="mono">{r.code}</span> · {r.name}</td><td className="num">{fmt(natural(r.type, r.dr, r.cr))}</td></tr>)}</>);
  return (
    <>
      <div className="head"><div><h1>Balance sheet</h1><p>As of {to} · {Math.abs(assets - le) < 0.005 ? 'balances' : 'does NOT balance'}</p></div><ReportTools report="bs" query={{ to }} /></div>
      <form className="row card noprint" style={{ alignItems: 'end' }}><label className="f"><span>As of</span><input className="inp" type="date" name="to" defaultValue={to} /></label><button className="btn">Show</button></form>
      <div className="tw"><table><tbody>
        {section('Assets', 'asset')}<tr className="hdr"><td>Total assets</td><td className="num">{fmt(assets)}</td></tr>
        {section('Liabilities', 'liability')}{section('Equity', 'equity')}
        <tr className="lvl1"><td>Profit to date (not yet closed)</td><td className="num">{fmt(profit)}</td></tr>
      </tbody><tfoot><tr><td>Total liabilities &amp; equity</td><td className="num">{fmt(le)}</td></tr></tfoot></table></div>
    </>
  );
}
