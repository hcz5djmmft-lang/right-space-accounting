import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { getSettings } from '@/lib/books';
import { getRun } from '@/lib/payroll';
import { rates } from '@/lib/payroll-calc';
import { deleteRunAction, payRunAction, postRunAction, saveRunAction } from '../../actions';

export default async function RunPage({ params, searchParams }: { params: Promise<{ period: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireUser('finance');
  const { period } = await params;
  const { error } = await searchParams;
  const r = await getRun(period);
  if (!r) notFound();
  const [settings, banks, log] = await Promise.all([
    getSettings(),
    sql<{ code: string; name: string }[]>`select code, name from accounts where is_bank and postable order by code`,
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'payroll' and g.entity_id = ${period} order by g.at`,
  ]);
  const R = rates(settings.payroll);
  const ed = r.run.status === 'draft' || r.run.status === 'rejected';
  const t = r.totals;
  const today = new Date().toISOString().slice(0, 10);
  const missing = settings.require_cc ? r.lines.filter(l => !l.project_id && !l.dept_id).map(l => l.name) : [];
  return (
    <>
      <div className="head">
        <div><h1>Payroll {period} <span className={'pill ' + r.run.status}>{r.run.status}</span> {r.run.paid_no && <span className="pill posted">paid</span>}</h1>
          <p>Posting date {r.run.date} · {r.lines.length} employees · net pay {fmt(t.net)}</p></div>
        <div className="row">
          {ed && <form action={deleteRunAction.bind(null, period)}><button className="btn bad">Delete run</button></form>}
          {r.run.status === 'posted' && !r.run.paid_entry_id && <a className="btn pri" href="#pay">Pay salaries</a>}
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {missing.length > 0 && <div className="msg bad">Give {missing.join(', ')} a project or a department under Employees, then use "Refresh from employee records".</div>}

      <form action={saveRunAction.bind(null, period)}>
        <div className="tw" style={{ marginBottom: 14 }}><table>
          <thead><tr><th>Employee</th><th className="hide-sm">Cost center</th><th className="num hide-sm">Basic</th><th className="num hide-sm">Allowances</th><th className="num">Overtime</th><th className="num">Gross</th><th className="num">Social ins. (emp.)</th><th className="num">Salary tax</th><th className="num">Other deductions</th><th className="num">Net pay</th><th className="num hide-sm">Social ins. (co.)</th></tr></thead>
          <tbody>{r.lines.map(l => (
            <tr key={l.employee_id}><td dir="auto">{l.name}<div className="muted" style={{ fontSize: 11 }}>{l.code}</div></td><td className="hide-sm">{l.cc ?? <span style={{ color: 'var(--bad)' }}>Not assigned</span>}</td>
              <td className="num hide-sm">{fmt(l.basic)}</td><td className="num hide-sm">{fmt(l.allowances)}</td>
              <td className="num">{ed ? <input className="inp mono" style={{ minWidth: 90 }} name={'ot_' + l.employee_id} inputMode="decimal" defaultValue={l.overtime || ''} /> : fmt(l.overtime)}</td>
              <td className="num">{fmt(l.gross)}</td><td className="num">{fmt(l.soc_emp)}</td><td className="num">{fmt(l.tax)}</td>
              <td className="num">{ed ? <input className="inp mono" style={{ minWidth: 90 }} name={'ded_' + l.employee_id} inputMode="decimal" defaultValue={l.deductions || ''} /> : fmt(l.deductions)}</td>
              <td className="num"><b>{fmt(l.net)}</b></td><td className="num hide-sm muted">{fmt(l.soc_co)}</td></tr>))}
          </tbody>
          <tfoot><tr><td colSpan={2} className="hide-sm">Total</td><td className="hide-sm" colSpan={2}></td><td></td><td className="num">{fmt(t.gross)}</td><td className="num">{fmt(t.soc_emp)}</td><td className="num">{fmt(t.tax)}</td><td className="num">{fmt(t.deductions)}</td><td className="num">{fmt(t.net)}</td><td className="num hide-sm">{fmt(t.soc_co)}</td></tr></tfoot>
        </table></div>
        {ed && (
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn" name="refresh" value="1">Refresh from employee records</button>
            <button className="btn">Save</button>
          </div>)}
      </form>
      {ed && <form action={postRunAction.bind(null, period)} className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}><button className="btn pri" disabled={missing.length > 0}>Post payroll</button></form>}

      <div className="card muted" style={{ fontSize: 13 }}>Social insurance uses {R.empRate}% employee and {R.coRate}% company on the insurance wage (floor {fmt(R.insMin)}, cap {fmt(R.insMax)}). Salary tax uses the brackets and the {fmt(R.exemption)} annual exemption, calculated progressively on annualised pay. "Other deductions" are credited to staff advances.</div>
      {r.run.entry_id && <div className="card">Ledger entry <Link href={`/entries/${r.run.entry_id}`}>{r.run.entry_no}</Link>{r.run.paid_entry_id && <> · Salary payment <Link href={`/entries/${r.run.paid_entry_id}`}>{r.run.paid_no}</Link></>}</div>}

      {r.run.status === 'posted' && !r.run.paid_entry_id && (
        <form id="pay" action={payRunAction.bind(null, period)} className="card grid g3" style={{ alignItems: 'end' }}>
          <label className="f"><span>Paid from</span><select className="inp" name="bank">{banks.map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</select></label>
          <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today} /></label>
          <button className="btn pri">Post salary payment of {fmt(t.net)}</button>
        </form>)}

      <div className="card"><h2>History</h2>
        <div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? ''} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
