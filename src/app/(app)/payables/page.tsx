import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { BUCKETS } from '@/lib/reports';
import { paymentCalendar, supplierAging, type PayDoc } from '@/lib/payables';

const STATE: Record<PayDoc['state'], [string, string]> = { released: ['Approved to pay', 'posted'], waiting: ['Payment request waiting', 'pending'], open: ['No payment request yet', 'rejected'] };
const Doc = ({ d }: { d: PayDoc }) => (
  <tr><td className="mono"><Link href={d.href}>{d.no}</Link></td><td className="mono hide-sm">{d.date}</td><td className="mono">{d.due}{d.days > 0 ? <div className="muted" style={{ fontSize: 12 }}>{d.days} days late</div> : null}</td>
    <td className="hide-sm">{d.project ?? ''}</td><td><span className={`pill ${STATE[d.state][1]}`}>{STATE[d.state][0]}</span></td><td className="num">{fmt(d.balance)}</td></tr>);

/** Payables (improvement 11): supplier aging and the payment calendar. */
export default async function Payables({ searchParams }: { searchParams: Promise<{ view?: string; days?: string }> }) {
  await requireUser('finance');
  const q = await searchParams;
  const calendar = q.view === 'calendar';
  const days = [30, 60, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const tabs = (
    <div className="row noprint" style={{ gap: 6, marginBottom: 12 }}>
      <Link className={`btn sm${calendar ? '' : ' pri'}`} href="/payables">Supplier aging</Link>
      <Link className={`btn sm${calendar ? ' pri' : ''}`} href="/payables?view=calendar">Payment calendar</Link>
    </div>);
  if (calendar) {
    const c = await paymentCalendar(undefined, days);
    return (
      <>
        <div className="head"><div><h1>Payment calendar</h1><p>What falls due to suppliers in the next {days} days, week by week, against the cash in bank and petty cash today. Vendor invoices with no due date are due {30} days after their date.</p></div></div>
        {tabs}
        <div className="row noprint" style={{ gap: 6, marginBottom: 12 }}>{[30, 60, 90].map(n => <Link key={n} className={`btn sm${n === days ? ' pri' : ''}`} href={`/payables?view=calendar&days=${n}`}>{n} days</Link>)}</div>
        <div className="tiles">
          <div className="tile"><div className="k">Cash in bank and petty cash</div><div className="v mono">{fmt(c.cash)}</div></div>
          <div className="tile"><div className="k">Due by {c.end}</div><div className="v mono">{fmt(c.total)}</div></div>
          <div className="tile"><div className="k">Cash left after paying</div><div className="v mono" style={{ color: c.cash - c.total < 0 ? 'var(--bad)' : undefined }}>{fmt(c.cash - c.total)}</div></div>
          <div className="tile"><div className="k">Due later</div><div className="v mono">{fmt(c.later)}</div></div>
        </div>
        {c.weeks.filter(w => w.docs.length || w.from).map(w => (
          <div key={w.label} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0, color: w.from ? undefined : 'var(--bad)' }}>{w.label}</h2>
              <span><b className="mono">{fmt(w.total)}</b> <span className="muted" style={{ fontSize: 13 }}>· cash after {fmt(w.cashAfter)}</span></span></div>
            {w.docs.length === 0 ? <p className="muted" style={{ marginBottom: 0 }}>Nothing due.</p> : (
              <div className="tw"><table style={{ marginTop: 8 }}>
                <thead><tr><th>Document</th><th className="hide-sm">Date</th><th>Due</th><th className="hide-sm">Project</th><th>State</th><th className="num">To pay</th></tr></thead>
                <tbody>{w.docs.map(d => <Doc key={d.id} d={d} />)}</tbody>
              </table></div>)}
            {w.docs.length > 0 && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{[...new Set(w.docs.map(d => d.party))].join(', ')}</p>}
          </div>))}
      </>
    );
  }
  const a = await supplierAging();
  return (
    <>
      <div className="head"><div><h1>Payables</h1><p>What is owed to each supplier, by days past due. Vendor invoices with no due date are due 30 days after their date.</p></div>
        <Link className="btn" href="/reports/aging?side=purchase">Aging report</Link></div>
      {tabs}
      <div className="tiles">
        {BUCKETS.map((b, i) => <div key={b} className="tile"><div className="k">{i === 0 ? 'Not yet due' : `${b} days late`}</div><div className="v mono" style={{ color: i >= 3 && a.totals[i] ? 'var(--bad)' : undefined }}>{fmt(a.totals[i])}</div></div>)}
        <div className="tile"><div className="k">Total owed</div><div className="v mono">{fmt(a.total)}</div></div>
      </div>
      {a.suppliers.length === 0 ? <p className="muted">Nothing is owed to suppliers.</p> : a.suppliers.map(s => (
        <details key={s.party_id} className="card">
          <summary className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
            <b dir="auto">{s.party}</b>
            <span className="mono">{s.overdue > 0 && <span style={{ color: 'var(--bad)' }}>{fmt(s.overdue)} late · </span>}{fmt(s.total)}</span>
          </summary>
          <div className="tw"><table style={{ marginTop: 8 }}>
            <thead><tr><th>Document</th><th className="hide-sm">Date</th><th>Due</th><th className="hide-sm">Project</th><th>State</th><th className="num">To pay</th></tr></thead>
            <tbody>{s.docs.map(d => <Doc key={d.id} d={d} />)}</tbody>
          </table></div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{BUCKETS.map((b, i) => s.buckets[i] ? `${i === 0 ? 'Not yet due' : b + ' days'}: ${fmt(s.buckets[i])}` : '').filter(Boolean).join(' · ')}</p>
        </details>))}
    </>
  );
}
