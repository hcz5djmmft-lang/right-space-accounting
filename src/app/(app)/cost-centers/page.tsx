import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { createDepartment } from './actions';

export default async function CostCenters() {
  const user = await requireUser();
  const [projects, depts] = await Promise.all([
    sql<{ id: string; code: string; name: string; type: string | null; status: string; budget: number | null; contract: number | null; spent: number; suffix: number | null }[]>`
      select p.id, p.code, p.name, p.type, p.status, p.budget, p.contract, p.gl_suffix suffix,
        coalesce((select sum(l.dr - l.cr) from journal_lines l join accounts a on a.code = l.account and a.type = 'expense'
          join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.project_id = p.id),0) spent
      from projects p order by p.is_office desc, p.code`,
    sql<{ id: string; code: string; name: string; spent: number }[]>`
      select d.id, d.code, d.name, coalesce((select sum(l.dr - l.cr) from journal_lines l join accounts a on a.code = l.account and a.type = 'expense'
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.dept_id = d.id),0) spent
      from departments d where d.active order by d.code`,
  ]);
  const canEdit = hasRole(user, 'finance');
  return (
    <>
      <div className="head"><div><h1>Cost centers</h1><p>Every expense is assigned to a project or a department.</p></div>
        {canEdit && <Link className="btn pri" href="/cost-centers/new">New project</Link>}</div>
      <h2>Projects</h2>
      <div className="tw" style={{ marginBottom: 18 }}><table>
        <thead><tr><th>Code</th><th className="hide-sm">Name</th><th className="hide-sm">Type</th><th>Status</th><th className="num hide-sm">Contract</th><th className="num">Budget</th><th className="num">Spent</th></tr></thead>
        <tbody>{projects.map(p => (
          <tr key={p.id}><td><Link href={`/cost-centers/${p.id}`}>{p.code}</Link>{p.suffix ? <span className="muted mono"> (-{p.suffix})</span> : null}</td>
            <td className="hide-sm" dir="auto">{p.name}</td><td className="hide-sm">{p.type}</td><td><span className="pill">{p.status}</span></td>
            <td className="num hide-sm">{p.contract ? fmt(p.contract) : ''}</td><td className="num">{p.budget ? fmt(p.budget) : ''}</td><td className="num">{fmt(p.spent)}</td></tr>))}
        </tbody></table></div>
      <h2>Departments</h2>
      <div className="tw" style={{ marginBottom: 12 }}><table>
        <thead><tr><th>Code</th><th>Name</th><th className="num">Spent</th></tr></thead>
        <tbody>{depts.map(d => <tr key={d.id}><td className="mono">{d.code}</td><td>{d.name}</td><td className="num">{fmt(d.spent)}</td></tr>)}</tbody>
      </table></div>
      {canEdit && <form action={createDepartment} className="row card">
        <input className="inp" name="code" placeholder="Code" style={{ width: 100 }} required />
        <input className="inp" name="name" placeholder="Department name" style={{ flex: 1, minWidth: 160 }} required />
        <button className="btn">Add department</button></form>}
    </>
  );
}
