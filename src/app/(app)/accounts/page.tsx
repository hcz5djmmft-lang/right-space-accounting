import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { TYPES, natural, type AccountType } from '@/lib/ledger';

type Row = { code: string; name: string; type: AccountType; parent: string | null; postable: boolean; is_bank: boolean; is_system: boolean; budget: number | null; cost_type: string | null; project: string | null; dr: number; cr: number };

export default async function Accounts({ searchParams }: { searchParams: Promise<{ sys?: string; project?: string }> }) {
  await requireUser();
  const { sys, project = '' } = await searchParams;
  const rows = await sql<Row[]>`
    select a.code, a.name, a.type, a.parent, a.postable, a.is_bank, a.is_system, a.budget, a.cost_type, p.code project,
      coalesce(sum(l.dr),0) dr, coalesce(sum(l.cr),0) cr
    from accounts a left join projects p on p.id = a.project_id
    left join journal_lines l on l.account = a.code and exists (select 1 from journal_entries e where e.id = l.entry_id and e.status = 'posted')
    where (${!!sys} or not a.is_system) and (${project} = '' or a.project_id = ${project})
    group by a.code, p.code order by a.code`;
  const projects = await sql<{ id: string; code: string }[]>`select id, code from projects order by is_office desc, code`;
  const kids = new Map<string, Row[]>();
  for (const r of rows) { const k = r.parent && rows.some(x => x.code === r.parent) ? r.parent : ''; kids.set(k, [...(kids.get(k) ?? []), r]); }
  const roll = (r: Row): number => natural(r.type, r.dr, r.cr) + (kids.get(r.code) ?? []).reduce((s, c) => s + roll(c), 0);
  const out: { r: Row; depth: number }[] = [];
  const walk = (k: string, depth: number) => { for (const r of kids.get(k) ?? []) { out.push({ r, depth }); walk(r.code, depth + 1); } };
  walk('', 0);
  return (
    <>
      <div className="head">
        <div><h1>Chart of accounts</h1><p>GL codes from RS 2026. Project codes are created automatically when a project is added.</p></div>
      </div>
      <form className="row" style={{ marginBottom: 12 }}>
        <select className="inp" name="project" defaultValue={project} style={{ maxWidth: 260 }}>
          <option value="">All cost centers</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
        <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="sys" value="1" defaultChecked={!!sys} /> Show system accounts</label>
        <button className="btn">Apply</button>
      </form>
      <div className="tw"><table>
        <thead><tr><th>Code</th><th>Name</th><th className="hide-sm">Type</th><th className="hide-sm">Cost center</th><th className="num hide-sm">Budget</th><th className="num">Balance</th></tr></thead>
        <tbody>{out.map(({ r, depth }) => (
          <tr key={r.code} className={r.postable ? '' : 'hdr'}>
            <td className="mono" style={{ paddingLeft: 10 + depth * 16 }}>{r.code}</td>
            <td dir="auto">{r.postable ? <Link href={`/reports/ledger?account=${encodeURIComponent(r.code)}`}>{r.name}</Link> : r.name}
              {r.is_bank ? <span className="pill" style={{ marginLeft: 6 }}>bank</span> : null}{r.is_system ? <span className="pill" style={{ marginLeft: 6 }}>system</span> : null}</td>
            <td className="hide-sm">{TYPES[r.type].label}</td><td className="hide-sm">{r.project}</td>
            <td className="num hide-sm">{r.budget ? fmt(r.budget) : ''}</td><td className="num">{fmt(roll(r))}</td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}
