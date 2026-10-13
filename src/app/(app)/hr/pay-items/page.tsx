import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { today } from '@/lib/dates';
import { fmt } from '@/lib/money';
import { KINDS, listLoans, listPayItems, type Kind } from '@/lib/pay-items';
import { listEmployeeFiles } from '@/lib/hr';
import { addLoanAction, addPayItemAction, instalmentsAction, removePayItemAction } from './actions';

export default async function PayItems({ searchParams }: { searchParams: Promise<{ month?: string; saved?: string; error?: string }> }) {
  await requireUser('hr', 'finance');
  const { month = today().slice(0, 7), saved, error } = await searchParams;
  const [items, loans, employees] = await Promise.all([listPayItems({ period: month }), listLoans(), listEmployeeFiles()]);
  const active = employees.filter(e => e.active);
  const sum = (col: string) => items.filter(i => KINDS[i.kind].col === col).reduce((a, i) => a + i.amount, 0);
  const prev = shift(month, -1), next = shift(month, 1);
  return (
    <>
      <div className="head"><div><h1>Pay items</h1><p>Bonuses, penalties, advances to recover, loan instalments and other deductions per month. The payroll run takes them in with &quot;Fill from timesheets and pay items&quot;.</p></div></div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="row" style={{ marginBottom: 12 }}><Link className="btn sm" href={`/hr/pay-items?month=${prev}`}>‹ {prev}</Link><b className="mono">{month}</b><Link className="btn sm" href={`/hr/pay-items?month=${next}`}>{next} ›</Link>
        <span className="muted" style={{ fontSize: 13 }}>Added to pay {fmt(sum('overtime'))} · off the gross {fmt(sum('late'))} · recovered {fmt(sum('deductions'))}</span></div>
      <form action={addPayItemAction} className="card grid g4" style={{ alignItems: 'end' }}>
        <input type="hidden" name="period" value={month} />
        <label className="f"><span>Employee</span><select className="inp" name="employee_id" required><option value="">Choose…</option>{active.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="f"><span>Kind</span><select className="inp" name="kind">{(Object.keys(KINDS) as Kind[]).filter(k => k !== 'loan').map(k => <option key={k} value={k}>{KINDS[k].label}</option>)}</select></label>
        <label className="f"><span>Amount (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" required /></label>
        <label className="f"><span>Note</span><input className="inp" name="note" dir="auto" /></label>
        <button className="btn pri">Add to {month}</button>
      </form>
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>Employee</th><th>Kind</th><th className="num">Amount</th><th className="hide-sm">Note</th><th className="hide-sm">Added by</th><th>In payroll</th><th></th></tr></thead>
        <tbody>{items.length === 0 && <tr><td colSpan={7} className="muted">No pay items in {month}.</td></tr>}
          {items.map(i => <tr key={i.id}><td dir="auto">{i.name}</td><td>{i.label}</td><td className="num mono">{fmt(i.amount)}</td><td className="hide-sm" dir="auto">{i.note}</td><td className="hide-sm">{i.who}</td>
            <td>{i.run_period ? <span className="pill posted">taken in</span> : <span className="pill">not yet</span>}</td>
            <td><form action={removePayItemAction.bind(null, month, i.id)}><button className="lnk bad" style={{ fontSize: 12 }}>remove</button></form></td></tr>)}
        </tbody></table></div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Loans</h2>
        <p className="muted" style={{ marginTop: 0 }}>A loan is paid out through the books as usual (staff advances); from its first month an instalment is taken off the pay until it is recovered.</p>
        <form action={addLoanAction.bind(null, month)} className="grid g4" style={{ alignItems: 'end', marginBottom: 12 }}>
          <label className="f"><span>Employee</span><select className="inp" name="employee_id" required><option value="">Choose…</option>{active.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="f"><span>Loan amount</span><input className="inp mono" name="amount" inputMode="decimal" required /></label>
          <label className="f"><span>Monthly instalment</span><input className="inp mono" name="monthly" inputMode="decimal" required /></label>
          <label className="f"><span>First month</span><input className="inp" type="month" name="start_period" defaultValue={next} required /></label>
          <label className="f" style={{ gridColumn: '1 / -2' }}><span>Note</span><input className="inp" name="note" dir="auto" /></label>
          <button className="btn">Add loan</button>
        </form>
        <div className="tw"><table>
          <thead><tr><th>Employee</th><th className="num">Loan</th><th className="num">Monthly</th><th>From</th><th className="num">Recovered</th><th className="num">Remaining</th><th>Status</th></tr></thead>
          <tbody>{loans.length === 0 && <tr><td colSpan={7} className="muted">No loans.</td></tr>}
            {loans.map(l => <tr key={l.id}><td dir="auto">{l.name}</td><td className="num mono">{fmt(l.amount)}</td><td className="num mono">{fmt(l.monthly)}</td><td className="mono">{l.start_period}</td><td className="num mono">{fmt(l.paid)}</td><td className="num mono">{fmt(l.remaining)}</td><td>{l.closed ? <span className="pill posted">recovered</span> : <span className="pill pending">open</span>}</td></tr>)}
          </tbody></table></div>
        <form action={instalmentsAction.bind(null, month)} className="row" style={{ marginTop: 10 }}><button className="btn sm">Create the {month} instalments now</button><span className="muted" style={{ fontSize: 12 }}>The payroll fill does this by itself.</span></form>
      </div>
    </>
  );
}
function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
