import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { statementsPack, type FlowLine, type Line } from '@/lib/pack';
import { PrintButton } from '@/components/PrintButton';

const prevMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const n = (v: number) => (v ? fmt(v) : '');

function Rows({ rows }: { rows: (Line | FlowLine)[] }) {
  return <>{rows.map(r => <tr key={'code' in r ? r.code : r.label} className="lvl1"><td dir="auto">{'code' in r ? <><span className="mono">{r.code}</span> · {r.name}</> : r.label}</td><td className="num">{n(r.month)}</td><td className="num">{n(r.ytd)}</td></tr>)}</>;
}
const Total = ({ label, v }: { label: string; v: [number, number] }) => <tr className="hdr"><td>{label}</td><td className="num">{fmt(v[0])}</td><td className="num">{fmt(v[1])}</td></tr>;
const Head = ({ label }: { label: string }) => <tr className="hdr"><td colSpan={3}>{label}</td></tr>;

/** Statements pack (improvement 13): P&L, balance sheet, cash flow and trial balance for a month and the year to date. */
export default async function Pack({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireUser('finance');
  const q = await searchParams;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.m ?? '') ? q.m! : prevMonth(today().slice(0, 7));
  const p = await statementsPack(period);
  const cols = (a: string, b: string) => <thead><tr><th></th><th className="num">{a}</th><th className="num">{b}</th></tr></thead>;
  const ytd = `Year to date`;
  const balanced = Math.abs(p.bs.totals.assets[0] - p.bs.totals.le[0]) < 0.01;
  return (
    <>
      <div className="head"><div><h1>Statements pack</h1><p>{p.company} · {p.name} and the year to date from {p.ytdFrom}</p></div>
        <div className="row noprint"><a className="btn" href={`/reports/pack/xlsx?m=${period}`}>Download Excel</a><PrintButton label="Print / save as PDF" /></div></div>
      <form className="row card noprint" style={{ alignItems: 'end' }}>
        <label className="f"><span>Month</span><input className="inp" type="month" name="m" defaultValue={period} /></label>
        <button className="btn">Show</button>
      </form>

      <h2>Profit and loss</h2>
      <div className="tw"><table>{cols(p.name, ytd)}<tbody>
        <Head label="Revenue" /><Rows rows={p.pl.revenue} /><Total label="Total revenue" v={p.pl.totals.revenue} />
        <Head label="Expenses" /><Rows rows={p.pl.expense} /><Total label="Total expenses" v={p.pl.totals.expense} />
      </tbody><tfoot><tr><td>Net profit</td><td className="num">{fmt(p.pl.totals.profit[0])}</td><td className="num">{fmt(p.pl.totals.profit[1])}</td></tr></tfoot></table></div>

      <h2 style={{ breakBefore: 'page' }}>Balance sheet</h2>
      {!balanced && <div className="msg bad">The balance sheet does not balance. Check the trial balance.</div>}
      <div className="tw"><table>{cols(`At ${p.to}`, `At the month before`)}<tbody>
        <Head label="Assets" /><Rows rows={p.bs.assets} /><Total label="Total assets" v={p.bs.totals.assets} />
        <Head label="Liabilities" /><Rows rows={p.bs.liabilities} />
        <Head label="Equity" /><Rows rows={p.bs.equity} />
        <tr className="lvl1"><td>Profit to date</td><td className="num">{fmt(p.bs.profit[0])}</td><td className="num">{fmt(p.bs.profit[1])}</td></tr>
      </tbody><tfoot><tr><td>Total liabilities and equity</td><td className="num">{fmt(p.bs.totals.le[0])}</td><td className="num">{fmt(p.bs.totals.le[1])}</td></tr></tfoot></table></div>

      <h2 style={{ breakBefore: 'page' }}>Cash flow</h2>
      <div className="tw"><table>{cols(p.name, ytd)}<tbody>
        <Head label="Operating activities" /><Rows rows={p.cf.operating} /><Total label="Cash from operating activities" v={p.cf.totals.operating} />
        <Head label="Investing activities" /><Rows rows={p.cf.investing} /><Total label="Cash from investing activities" v={p.cf.totals.investing} />
        <Head label="Financing activities" /><Rows rows={p.cf.financing} /><Total label="Cash from financing activities" v={p.cf.totals.financing} />
        <Total label="Net change in cash" v={p.cf.totals.change} />
        <tr className="lvl1"><td>Cash at the start</td><td className="num">{fmt(p.cf.totals.opening[0])}</td><td className="num">{fmt(p.cf.totals.opening[1])}</td></tr>
      </tbody><tfoot><tr><td>Cash at the end (bank, safe and petty cash)</td><td className="num">{fmt(p.cf.totals.closing[0])}</td><td className="num">{fmt(p.cf.totals.closing[1])}</td></tr></tfoot></table></div>

      <h2 style={{ breakBefore: 'page' }}>Trial balance</h2>
      <div className="tw"><table>
        <thead><tr><th>Account</th><th className="num hide-sm">{p.name} debits</th><th className="num hide-sm">{p.name} credits</th><th className="num">Debit at {p.to}</th><th className="num">Credit at {p.to}</th></tr></thead>
        <tbody>{p.tb.map(r => <tr key={r.code}><td dir="auto"><span className="mono">{r.code}</span> · {r.name}</td><td className="num hide-sm">{n(r.month_dr)}</td><td className="num hide-sm">{n(r.month_cr)}</td><td className="num">{n(r.dr)}</td><td className="num">{n(r.cr)}</td></tr>)}</tbody>
        <tfoot><tr><td>Total</td><td className="num hide-sm">{fmt(p.tb.reduce((t, r) => t + r.month_dr, 0))}</td><td className="num hide-sm">{fmt(p.tb.reduce((t, r) => t + r.month_cr, 0))}</td><td className="num">{fmt(p.tb.reduce((t, r) => t + r.dr, 0))}</td><td className="num">{fmt(p.tb.reduce((t, r) => t + r.cr, 0))}</td></tr></tfoot>
      </table></div>
    </>
  );
}
