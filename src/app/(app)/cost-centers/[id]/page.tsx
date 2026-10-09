import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { getSettings } from '@/lib/books';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { ProjectFields } from '@/components/ProjectFields';
import { updateProject } from '../actions';

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved } = await searchParams;
  const [p] = await sql`select *, to_char(start_date,'YYYY-MM-DD') start, to_char(end_date,'YYYY-MM-DD') "end" from projects where id = ${id}`;
  if (!p) notFound();
  const [settings, customers, byCode, [tot]] = await Promise.all([
    getSettings(),
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'customer' order by name`,
    sql<{ code: string; name: string; budget: number | null; actual: number }[]>`
      select a.code, a.name, a.budget, coalesce(sum(l.dr - l.cr),0) actual from accounts a
      left join journal_lines l on l.account = a.code and l.project_id = ${id}
        and exists (select 1 from journal_entries e where e.id = l.entry_id and e.status = 'posted')
      where a.type = 'expense' and a.postable and (a.project_id = ${id} or l.id is not null)
      group by a.code order by a.code`,
    sql<{ spent: number; collected: number }[]>`
      select coalesce(sum(case when a.type='expense' then l.dr - l.cr end),0) spent, coalesce(sum(case when a.type='revenue' then l.cr - l.dr end),0) collected
      from journal_lines l join accounts a on a.code = l.account join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.project_id = ${id}`,
  ]);
  const used = byCode.filter(r => r.actual || r.budget);
  return (
    <>
      <div className="head"><div><h1>{p.code}</h1><p dir="auto">{p.name}{p.gl_suffix ? ` · GL suffix -${p.gl_suffix}` : ''}</p></div>
        <div className="row"><Link className="btn" href={`/accounts?project=${id}`}>GL codes</Link></div></div>
      {saved && <div className="msg good">Saved.</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Contract</div><div className="v mono">{fmt(p.contract)}</div></div>
        <div className="tile"><div className="k">Cost budget</div><div className="v mono">{fmt(p.budget)}</div></div>
        <div className="tile"><div className="k">Spent</div><div className="v mono">{fmt(tot.spent)}</div></div>
        <div className="tile"><div className="k">Collected</div><div className="v mono">{fmt(tot.collected)}</div></div>
      </div>
      <h2>Spending by GL code</h2>
      {used.length === 0 ? <div className="empty card">No spending posted on this project yet.</div> : (
        <div className="tw" style={{ marginBottom: 16 }}><table>
          <thead><tr><th>GL code</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Remaining</th></tr></thead>
          <tbody>{used.map(r => <tr key={r.code}><td dir="auto"><span className="mono">{r.code}</span> · {r.name}</td><td className="num">{r.budget ? fmt(r.budget) : ''}</td>
            <td className="num">{fmt(r.actual)}</td><td className="num">{r.budget ? fmt(r.budget - r.actual) : ''}</td></tr>)}</tbody>
        </table></div>)}
      {hasRole(user, 'finance') && (
        <form action={updateProject.bind(null, id)} className="card">
          <h2>Project details</h2>
          <ProjectFields p={p} cats={settings.cats} customers={customers} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn pri">Save</button></div>
        </form>)}
    </>
  );
}
