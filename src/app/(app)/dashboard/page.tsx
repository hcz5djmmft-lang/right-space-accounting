import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { phaseLabel } from '@/lib/projects';
import { cashView, projectMoney } from '@/lib/dashboard';

/** Partners' dashboard (improvement 4): each project's money and where cash is heading over the next 30 days. */
export default async function Dashboard() {
  await requireUser('finance');
  const [projects, cash] = await Promise.all([projectMoney(), cashView()]);
  const sum = (k: 'contract' | 'invoiced' | 'collected' | 'cost' | 'committed' | 'margin') => projects.reduce((t, p) => t + p[k], 0);
  const top = Math.max(1, ...cash.weeks.map(w => Math.max(w.inflow, w.outflow)));
  return (
    <>
      <div className="head"><div><h1>Partners&apos; dashboard</h1><p>Every project&apos;s money and the cash of the next 30 days · EGP</p></div></div>

      <div className="tiles">
        <div className="tile"><div className="k">Cash today (bank + petty cash)</div><div className="v mono">{fmt(cash.opening)}</div><div className="muted" style={{ fontSize: 12 }}>bank {fmt(cash.bank)} · petty cash {fmt(cash.pettyCash)}</div></div>
        <div className="tile"><div className="k">In 30 days, if all is paid on time</div><div className="v mono" style={cash.closing < 0 ? { color: 'var(--bad)' } : undefined}>{fmt(cash.closing)}</div></div>
        <div className="tile"><div className="k">Open contracts · expected margin</div><div className="v mono">{fmt(sum('contract'))}</div><div className="muted" style={{ fontSize: 12 }}>margin {fmt(sum('margin'))}</div></div>
        <div className="tile"><div className="k">Credit card owed · requests in approval</div><div className="v mono">{fmt(cash.card)}</div><div className="muted" style={{ fontSize: 12 }}>{fmt(cash.pendingRequests)} waiting for approval</div></div>
      </div>

      <div className="card">
        <h2>Projects</h2>
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="num">Contract</th><th className="num">Invoiced</th><th className="num">Collected</th><th className="num">Cost to date</th><th className="num">Committed</th><th className="num">Expected margin</th></tr></thead>
          <tbody>{projects.map(p => (
            <tr key={p.id}><td><Link href={`/cost-centers/${p.id}`}>{p.code}</Link><div className="muted" style={{ fontSize: 12 }}>{phaseLabel(p.phase) || p.status}</div></td>
              <td className="num">{fmt(p.contract)}</td><td className="num">{fmt(p.invoiced)}</td><td className="num">{fmt(p.collected)}</td>
              <td className="num">{fmt(p.cost)}</td><td className="num">{fmt(p.committed)}</td>
              <td className="num" style={p.contract && p.margin < 0 ? { color: 'var(--bad)' } : undefined}>{p.contract ? <>{fmt(p.margin)}<div className="muted" style={{ fontSize: 12 }}>{p.marginPct}%</div></> : <span className="muted">no contract</span>}</td></tr>))}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{fmt(sum('contract'))}</td><td className="num">{fmt(sum('invoiced'))}</td><td className="num">{fmt(sum('collected'))}</td><td className="num">{fmt(sum('cost'))}</td><td className="num">{fmt(sum('committed'))}</td><td className="num">{fmt(sum('margin'))}</td></tr></tfoot>
        </table></div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Contract includes approved variation orders. Committed is what is promised but not yet in the books: approved purchase orders not yet billed, approved work orders not yet claimed, and payment requests still in approval. Expected margin is the contract less the larger of the cost budget and cost to date plus committed.</p>
      </div>

      <div className="card">
        <h2>Cash, next 30 days</h2>
        <div className="tw"><table>
          <thead><tr><th>Week</th><th className="num">Coming in</th><th className="num">Going out</th><th className="num">Cash at the end</th><th className="hide-sm" style={{ width: '30%' }}></th></tr></thead>
          <tbody>{cash.weeks.map((w, i) => (
            <tr key={w.from}><td className="mono">{w.from.slice(5)} to {w.to.slice(5)}{i === 0 && (cash.overdueIn || cash.overdueOut) ? <div className="muted" style={{ fontSize: 12 }}>with overdue items</div> : null}</td>
              <td className="num">{fmt(w.inflow)}</td><td className="num">{fmt(w.outflow)}</td><td className="num" style={w.closing < 0 ? { color: 'var(--bad)' } : undefined}>{fmt(w.closing)}</td>
              <td className="hide-sm"><div style={{ height: 7, background: '#3a9d63', width: `${(w.inflow / top) * 100}%`, borderRadius: 3, marginBottom: 3 }} /><div style={{ height: 7, background: '#c2453b', width: `${(w.outflow / top) * 100}%`, borderRadius: 3 }} /></td></tr>))}</tbody>
        </table></div>
        <p className="muted" style={{ fontSize: 13 }}>Coming in: client invoices by their due date (overdue {fmt(cash.overdueIn)} counted in the first week). Going out: approved payment requests and vendor invoices released for payment by their due date (no due date: this week; overdue {fmt(cash.overdueOut)}).</p>
        <div className="grid g2">
          <div><h3 style={{ fontSize: 14 }}>Coming in</h3>{cash.ins.length === 0 ? <p className="muted">Nothing due.</p> : <table><tbody>{cash.ins.map(x => <tr key={x.no}><td><Link href={x.href}>{x.no}</Link> <span className="muted" dir="auto">{x.party}</span></td><td className="mono">{x.due}</td><td className="num">{fmt(x.amount)}</td></tr>)}</tbody></table>}</div>
          <div><h3 style={{ fontSize: 14 }}>Going out</h3>{cash.outs.length === 0 ? <p className="muted">Nothing due.</p> : <table><tbody>{cash.outs.map(x => <tr key={x.no}><td><Link href={x.href}>{x.no}</Link> <span className="muted" dir="auto">{x.party}</span></td><td className="mono">{x.due}</td><td className="num">{fmt(x.amount)}</td></tr>)}</tbody></table>}</div>
        </div>
      </div>
    </>
  );
}
