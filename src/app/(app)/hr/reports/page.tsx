import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { today } from '@/lib/dates';
import { documentsMissing, headcount, kpis, leaveBalances, reminders } from '@/lib/hr-reports';
import { fmtMin } from '@/lib/attendance-calc';

export default async function HrReports({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; year?: string }> }) {
  await requireUser('hr', 'finance');
  const todayStr = today();
  const { tab = 'reminders', month = todayStr.slice(0, 7), year: y } = await searchParams;
  const year = Number(y ?? todayStr.slice(0, 4));
  const tabs = [['reminders', 'Reminders'], ['headcount', 'Headcount'], ['leave', `Leave balances ${year}`], ['documents', 'Documents'], ['kpis', `KPIs ${month}`]] as const;
  return (
    <>
      <div className="head"><div><h1>HR reports</h1><p>What needs doing, who is where, leave balances, documents and each person&apos;s KPIs from their tasks and attendance.</p></div></div>
      <div className="tabs">{tabs.map(([k, v]) => <Link key={k} href={`/hr/reports?tab=${k}&month=${month}&year=${year}`} className={tab === k ? 'on' : ''}>{v}</Link>)}</div>
      {tab === 'reminders' && <Reminders today={todayStr} />}
      {tab === 'headcount' && <Headcount />}
      {tab === 'leave' && <Leave year={year} />}
      {tab === 'documents' && <Documents />}
      {tab === 'kpis' && <Kpis month={month} today={todayStr} />}
    </>
  );
}

async function Reminders({ today }: { today: string }) {
  const rows = await reminders(today);
  return rows.length === 0 ? <div className="empty card">Nothing to remind you of.</div> : (
    <div className="tw"><table><thead><tr><th>Employee</th><th>What</th><th>When</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td dir="auto"><Link href={r.kind === 'leave' ? '/leave?tab=all' : r.kind === 'attendance' ? `/attendance/${r.employee_id}` : `/hr/employees/${r.employee_id}${r.kind === 'documents' ? '?tab=documents' : ''}`}>{r.name}</Link></td>
        <td>{r.urgent ? <span className="pill rejected">{r.text}</span> : r.text}</td><td className="mono">{r.due ?? ''}</td></tr>)}</tbody></table></div>);
}
async function Headcount() {
  const rows = await headcount();
  const t = rows.reduce((a, r) => ({ office: a.office + r.office, site: a.site + r.site, total: a.total + r.total, with_login: a.with_login + r.with_login }), { office: 0, site: 0, total: 0, with_login: 0 });
  return (
    <div className="tw"><table><thead><tr><th>Department</th><th className="num">Office</th><th className="num">Site</th><th className="num">Total</th><th className="num">With a login</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.dept}><td>{r.dept}</td><td className="num">{r.office}</td><td className="num">{r.site}</td><td className="num">{r.total}</td><td className="num">{r.with_login}</td></tr>)}</tbody>
      <tfoot><tr><td>Total</td><td className="num">{t.office}</td><td className="num">{t.site}</td><td className="num">{t.total}</td><td className="num">{t.with_login}</td></tr></tfoot></table></div>);
}
async function Leave({ year }: { year: number }) {
  const rows = await leaveBalances(year);
  return (
    <div className="tw"><table><thead><tr><th>Employee</th><th className="hide-sm">Department</th><th className="num">Entitlement</th><th className="num">Taken</th><th className="num">Waiting</th><th className="num">Left</th><th className="num">Sick</th><th className="num">Unpaid</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.employee_id}><td dir="auto"><Link href={`/hr/employees/${r.employee_id}`}>{r.name}</Link></td><td className="hide-sm">{r.dept_name}</td><td className="num">{r.entitlement}</td><td className="num">{r.taken}</td><td className="num">{r.pending || ''}</td><td className="num"><b>{r.balance - r.pending}</b></td><td className="num">{r.sick || ''}</td><td className="num">{r.unpaid || ''}</td></tr>)}</tbody></table></div>);
}
async function Documents() {
  const rows = await documentsMissing();
  return rows.length === 0 ? <div className="empty card">Every employee file is complete.</div> : (
    <div className="tw"><table><thead><tr><th>Employee</th><th>Missing</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.employee_id}><td dir="auto"><Link href={`/hr/employees/${r.employee_id}?tab=documents`}>{r.name}</Link></td><td>{r.missing.join(', ')}</td></tr>)}</tbody></table></div>);
}
async function Kpis({ month, today }: { month: string; today: string }) {
  const rows = await kpis(month, today);
  const prev = shift(month, -1), next = shift(month, 1);
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><Link className="btn sm" href={`/hr/reports?tab=kpis&month=${prev}`}>‹ {prev}</Link><b className="mono">{month}</b><Link className="btn sm" href={`/hr/reports?tab=kpis&month=${next}`}>{next} ›</Link></div>
      <div className="tw"><table>
        <thead><tr><th>Employee</th><th className="num">Tasks</th><th className="num">Done</th><th className="num">On time</th><th className="num">Late</th><th className="num">Open</th><th className="num">Overdue</th><th className="num hide-sm">Avg days</th><th className="num">Days in</th><th className="num">Late days</th><th className="num hide-sm">Overtime</th><th className="num hide-sm">Design</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.employee_id}><td dir="auto"><Link href={`/hr/employees/${r.employee_id}`}>{r.name}</Link><div className="muted" style={{ fontSize: 11 }}>{r.dept_name}</div></td>
          <td className="num">{r.assigned || ''}</td><td className="num">{r.done || ''}</td><td className="num">{r.on_time || ''}</td><td className="num">{r.late_done ? <span className="pill rejected">{r.late_done}</span> : ''}</td><td className="num">{r.open || ''}</td><td className="num">{r.overdue ? <span className="pill rejected">{r.overdue}</span> : ''}</td>
          <td className="num hide-sm">{r.avg_days ?? ''}</td><td className="num">{r.days_present || ''}</td><td className="num">{r.late_days ? `${r.late_days} (${fmtMin(r.late_min)})` : ''}</td><td className="num hide-sm">{r.overtime_min ? fmtMin(r.overtime_min) : ''}</td><td className="num hide-sm">{r.design_min ? fmtMin(r.design_min) : ''}</td></tr>)}</tbody>
      </table></div>
      <p className="muted" style={{ fontSize: 12 }}>Tasks: given or finished in the month, plus older ones still open. On time = finished by the due date (or no due date). Avg days = from the task being given to done.</p>
    </>);
}
function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
