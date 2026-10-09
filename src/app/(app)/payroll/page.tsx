import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { listEmployees, listRuns } from '@/lib/payroll';
import { monthEnd } from '@/lib/payroll-calc';
import { getSettings } from '@/lib/books';
import { createRunAction } from './actions';

export default async function Payroll({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  await requireUser('finance');
  const { tab = 'employees', error } = await searchParams;
  const [employees, runs, settings] = await Promise.all([listEmployees(), listRuns(), getSettings()]);
  const period = new Date().toISOString().slice(0, 7);
  return (
    <>
      <div className="head"><div><h1>Payroll</h1><p>Employees, monthly salary runs, social insurance and salary tax (Egyptian rules).</p></div>
        {tab === 'employees' && <Link className="btn pri" href="/payroll/employees/new">New employee</Link>}</div>
      <div className="tabs"><Link href="/payroll?tab=employees" className={tab === 'employees' ? 'on' : ''}>Employees</Link><Link href="/payroll?tab=runs" className={tab === 'runs' ? 'on' : ''}>Payroll runs</Link></div>
      {error && <div className="msg bad">{error}</div>}
      {tab === 'employees' ? (employees.length === 0 ? <div className="empty card">No employees yet. Add employees with their basic salary and allowances, then create a monthly payroll run.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Code</th><th>Name</th><th className="hide-sm">Job title</th><th className="hide-sm">Department</th><th>Cost center</th><th className="num">Basic</th><th className="num hide-sm">Allowances</th><th className="num hide-sm">Insurance wage</th><th>Status</th></tr></thead>
          <tbody>{employees.map(e => (
            <tr key={e.id}><td className="mono"><Link href={`/payroll/employees/${e.id}`}>{e.code}</Link></td><td dir="auto">{e.name}</td><td className="hide-sm" dir="auto">{e.job_title}</td>
              <td className="hide-sm">{e.dept_name ?? ''}</td><td>{e.project_code ?? (settings.require_cc && !e.dept_id ? <span style={{ color: 'var(--bad)' }}>not set</span> : e.dept_name)}</td>
              <td className="num">{fmt(e.basic)}</td><td className="num hide-sm">{fmt(e.allowances)}</td><td className="num hide-sm">{e.insurable ? fmt(e.insurable) : <span className="muted">gross</span>}</td>
              <td><span className={'pill ' + (e.active ? 'posted' : 'rejected')}>{e.active ? 'active' : 'inactive'}</span></td></tr>))}
          </tbody></table></div>)) : (
        <>
          <form action={createRunAction} className="row card" style={{ alignItems: 'end' }}>
            <label className="f"><span>Month</span><input className="inp" type="month" name="period" defaultValue={period} required /></label>
            <label className="f"><span>Posting date</span><input className="inp" type="date" name="date" defaultValue={monthEnd(period)} /></label>
            <button className="btn pri">New payroll run</button>
            <span className="muted" style={{ fontSize: 12 }}>Every active employee is added. Overtime and deductions come next.</span>
          </form>
          {runs.length === 0 ? <div className="empty card">No payroll runs yet.</div> : (
            <div className="tw"><table>
              <thead><tr><th>Month</th><th>Posting date</th><th>Status</th><th className="num">Employees</th><th className="num hide-sm">Gross</th><th className="num">Net pay</th><th>Paid</th></tr></thead>
              <tbody>{runs.map(r => (
                <tr key={r.period}><td className="mono"><Link href={`/payroll/runs/${r.period}`}>{r.period}</Link></td><td className="mono">{r.date}</td>
                  <td><span className={'pill ' + r.status}>{r.status}</span></td><td className="num">{r.employees}</td><td className="num hide-sm">{fmt(r.gross)}</td><td className="num">{fmt(r.net)}</td>
                  <td>{r.paid_no ? <span className="pill posted">paid · {r.paid_no}</span> : ''}</td></tr>))}
              </tbody></table></div>)}
        </>)}
    </>
  );
}
