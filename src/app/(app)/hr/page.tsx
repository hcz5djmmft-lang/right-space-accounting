import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listEmployeeFiles, DOCUMENTS } from '@/lib/hr';

export default async function HR({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser('hr', 'finance');
  const { show = 'active' } = await searchParams;
  const all = await listEmployeeFiles();
  const list = show === 'all' ? all : all.filter(e => e.active);
  const total = DOCUMENTS.length;
  return (
    <>
      <div className="head"><div><h1>Employees</h1><p>Every employee&apos;s file: personal data, contract, Office or Site, the employment documents and the login.</p></div>
        <Link className="btn pri" href="/hr/employees/new">New employee</Link></div>
      <div className="tabs"><Link href="/hr" className={show === 'active' ? 'on' : ''}>Active ({all.filter(e => e.active).length})</Link><Link href="/hr?show=all" className={show === 'all' ? 'on' : ''}>All ({all.length})</Link></div>
      {list.length === 0 ? <div className="empty card">No employees yet. Add the first one with &quot;New employee&quot;.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Code</th><th>Name</th><th className="hide-sm">Job title</th><th className="hide-sm">Department</th><th className="hide-sm">Project</th><th>Place</th><th className="hide-sm">Hired</th><th>Documents</th><th>Login</th></tr></thead>
          <tbody>{list.map(e => (
            <tr key={e.id}>
              <td className="mono"><Link href={`/hr/employees/${e.id}`}>{e.code}</Link></td>
              <td dir="auto"><Link href={`/hr/employees/${e.id}`}>{e.name}</Link>{!e.active && <span className="pill rejected" style={{ marginLeft: 6 }}>inactive</span>}</td>
              <td className="hide-sm" dir="auto">{e.job_title}</td><td className="hide-sm">{e.dept_name}</td><td className="hide-sm mono">{e.project_code}</td>
              <td><span className="pill">{e.work_location === 'site' ? 'Site' : 'Office'}</span></td>
              <td className="hide-sm mono">{e.hire_date}</td>
              <td>{e.docs_missing === 0 ? <span className="pill posted">complete</span> : <span className="pill pending">{e.docs_received} of {total} · {e.docs_missing} missing</span>}</td>
              <td>{e.user_id ? <span className="pill posted">{e.login_active ? 'yes' : 'off'}</span> : <span className="muted">none</span>}</td>
            </tr>))}
          </tbody></table></div>)}
    </>
  );
}
