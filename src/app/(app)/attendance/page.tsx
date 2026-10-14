import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { today } from '@/lib/dates';
import { categoryMinutes, designTotals, getHr, monthSummary } from '@/lib/attendance';
import { CATEGORIES, categoryOf } from '@/lib/clock-categories';
import { fmtMin, officeSet } from '@/lib/attendance-calc';
import { fmt } from '@/lib/money';

export default async function Attendance({ searchParams }: { searchParams: Promise<{ month?: string; tab?: string }> }) {
  await requireUser('hr', 'finance');
  const { month = today().slice(0, 7), tab = 'month' } = await searchParams;
  const [rows, s, design, cats] = await Promise.all([monthSummary(month), getHr(), designTotals(), categoryMinutes(month)]);
  const keys = [...CATEGORIES.map(c => c.key), ...new Set(cats.map(r => r.category).filter(k => !categoryOf(k)))].filter(k => cats.some(r => r.category === k && r.minutes > 0));
  const people = [...new Map(cats.map(r => [r.employee_id, { id: r.employee_id, code: r.code, name: r.name }])).values()];
  const minutes = (emp: string, key: string) => cats.find(r => r.employee_id === emp && r.category === key)?.minutes ?? 0;
  const prev = shift(month, -1), next = shift(month, 1);
  return (
    <>
      <div className="head"><div><h1>Attendance</h1><p>Clock-ins from the phones: time, place and selfie, checked by HR. Overtime and lateness go to payroll from here.</p></div>
        <Link className="btn" href="/hr/settings">Attendance settings</Link></div>
      {!officeSet(s) && <div className="msg bad">The office location is not set yet, so Office, Design and Finance clock-ins are recorded wherever the person is. Set it under Attendance settings (from a phone at the office).</div>}
      <div className="tabs"><Link href={`/attendance?month=${month}`} className={tab === 'month' ? 'on' : ''}>Timesheet</Link><Link href={`/attendance?month=${month}&tab=design`} className={tab === 'design' ? 'on' : ''}>Design hours per project</Link><Link href={`/attendance?month=${month}&tab=categories`} className={tab === 'categories' ? 'on' : ''}>Hours by category</Link></div>
      {tab === 'month' ? (
        <>
          <div className="row" style={{ marginBottom: 12 }}><Link className="btn sm" href={`/attendance?month=${prev}`}>‹ {prev}</Link><b className="mono">{month}</b><Link className="btn sm" href={`/attendance?month=${next}`}>{next} ›</Link></div>
          <div className="tw"><table>
            <thead><tr><th>Employee</th><th>Place</th><th className="num">Days</th><th className="num">Late days</th><th className="num">Late</th><th className="num">Overtime</th><th className="num hide-sm">Worked</th><th>To check</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.employee_id}>
                <td dir="auto"><Link href={`/attendance/${r.employee_id}?month=${month}`}>{r.name}</Link><div className="muted" style={{ fontSize: 11 }}>{r.code}</div></td>
                <td><span className="pill">{r.work_location === 'site' ? 'Site' : 'Office'}</span></td>
                <td className="num">{r.days}</td><td className="num">{r.late_days || ''}</td><td className="num mono">{r.late_min ? fmtMin(r.late_min) : ''}</td>
                <td className="num mono">{r.overtime_min ? fmtMin(r.overtime_min) : ''}</td><td className="num mono hide-sm">{r.worked_min ? fmtMin(r.worked_min) : ''}</td>
                <td>{r.unchecked ? <span className="pill pending">{r.unchecked} selfies</span> : r.days ? <span className="pill posted">checked</span> : ''}{r.open ? <span className="pill rejected" style={{ marginLeft: 4 }}>{r.open} open</span> : null}{r.away ? <span className="pill rejected" style={{ marginLeft: 4 }}>{r.away} away</span> : null}</td>
              </tr>))}
            </tbody></table></div>
        </>
      ) : tab === 'categories' ? (
        <>
          <div className="row" style={{ marginBottom: 12 }}><Link className="btn sm" href={`/attendance?month=${prev}&tab=categories`}>‹ {prev}</Link><b className="mono">{month}</b><Link className="btn sm" href={`/attendance?month=${next}&tab=categories`}>{next} ›</Link></div>
          <div className="tw"><table>
            <thead><tr><th>Employee</th>{keys.map(k => <th key={k} className="num">{categoryOf(k)?.short ?? k}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>{people.length === 0 && <tr><td colSpan={keys.length + 2} className="muted">No clocked stretches in {month}. Each clock-in says what the day is for (Office, Site or Design on a project) and can be switched during the day.</td></tr>}
              {people.map(p => <tr key={p.id}><td dir="auto"><Link href={`/attendance/${p.id}?month=${month}`}>{p.name}</Link><div className="muted" style={{ fontSize: 11 }}>{p.code}</div></td>
                {keys.map(k => <td key={k} className="num mono">{minutes(p.id, k) ? fmtMin(minutes(p.id, k)) : ''}</td>)}<td className="num mono"><b>{fmtMin(keys.reduce((a, k) => a + minutes(p.id, k), 0))}</b></td></tr>)}
            </tbody></table></div>
        </>
      ) : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="num">Design hours</th><th className="num">Cost (EGP)</th><th className="num">Designers</th><th></th></tr></thead>
          <tbody>{design.length === 0 && <tr><td colSpan={5} className="muted">No design work clocked yet. Designers pick Design on a project when they clock in, or Switch to it during the day.</td></tr>}
            {design.map(d => <tr key={d.project_id}><td><Link href={`/cost-centers/${d.project_id}`}>{d.code}</Link> <span className="muted" dir="auto">{d.name !== d.code ? d.name : ''}</span></td><td className="num mono">{fmtMin(d.minutes)}</td><td className="num mono">{fmt(d.cost)}</td><td className="num">{d.people}</td><td>{d.open ? <span className="pill pending">working now</span> : ''}</td></tr>)}
          </tbody></table></div>)}
    </>
  );
}
function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
