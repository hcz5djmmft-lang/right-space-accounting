import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { TYPES, natural } from '@/lib/ledger';
import { type ChartRow, baseCode, groupProjectCodes, isProjectCode } from '@/lib/chart';

type Q = { sys?: string; cc?: string; code?: string; detail?: string };

/**
 * The chart with balances. By default every GL code is one line with its total over all cost centers (a project code's
 * copies added up); a cost center narrows the figures to that project or department, and a code opens its split per project.
 */
export default async function Accounts({ searchParams }: { searchParams: Promise<Q> }) {
  await requireUser();
  const { sys, cc = '', code = '', detail } = await searchParams;
  const proj = cc.startsWith('p:') ? cc.slice(2) : null, dept = cc.startsWith('d:') ? cc.slice(2) : null;
  const [all, projects, departments] = await Promise.all([
    sql<ChartRow[]>`
      select a.code, a.name, a.type, a.parent, a.postable, a.is_bank, a.is_system, a.budget, a.cost_type, p.code project,
        coalesce(sum(l.dr),0) dr, coalesce(sum(l.cr),0) cr
      from accounts a left join projects p on p.id = a.project_id
      left join journal_lines l on l.account = a.code and exists (select 1 from journal_entries e where e.id = l.entry_id and e.status = 'posted')
        and (${proj}::text is null or l.project_id = ${proj}) and (${dept}::text is null or l.dept_id = ${dept})
      where (${!!sys} or not a.is_system)
        and (${proj}::text is null or a.project_id = ${proj})
        and (${dept}::text is null or a.project_id = (select id from projects where is_office limit 1))
      group by a.code, p.code order by a.code`,
    sql<{ id: string; code: string; name: string }[]>`select id, code, name from projects order by is_office desc, code`,
    sql<{ id: string; name: string }[]>`select id, name from departments where active order by code`,
  ]);
  const split = code ? all.filter(r => baseCode(r.code) === code) : null;
  const rows = split ?? (!proj && !dept && !detail ? groupProjectCodes(all) : all);
  const grouped = rows !== all && !split;
  const kids = new Map<string, ChartRow[]>();
  for (const r of rows) { const k = r.parent && rows.some(x => x.code === r.parent) ? r.parent : ''; kids.set(k, [...(kids.get(k) ?? []), r]); }
  const roll = (r: ChartRow): number => natural(r.type, r.dr, r.cr) + (kids.get(r.code) ?? []).reduce((s, c) => s + roll(c), 0);
  const out: { r: ChartRow; depth: number }[] = [];
  const walk = (k: string, depth: number) => { for (const r of kids.get(k) ?? []) { out.push({ r, depth }); walk(r.code, depth + 1); } };
  walk('', 0);
  const ccName = proj ? projects.find(p => p.id === proj)?.code : dept ? departments.find(d => d.id === dept)?.name : null;
  const sub = split ? <>Split per project · <span className="mono">{code}</span> <span dir="auto">{split[0]?.name ?? ''}</span></>
    : ccName ? <>Figures for <span dir="auto">{ccName}</span> only</> : 'Each code with its total over all cost centers; pick a cost center for its own figures, or click a project code for its split per project.';
  return (
    <>
      <div className="head">
        <div><h1>Chart of accounts</h1><p>{sub}</p></div>
        {split && <Link className="btn" href="/accounts">All codes</Link>}
      </div>
      {!split && <form className="row" style={{ marginBottom: 12 }}>
        <select className="inp" name="cc" defaultValue={cc} style={{ maxWidth: 260 }}>
          <option value="">All cost centers</option>
          <optgroup label="Projects">{projects.map(p => <option key={p.id} value={'p:' + p.id}>{p.code === p.name ? p.code : `${p.code} · ${p.name}`}</option>)}</optgroup>
          <optgroup label="Departments">{departments.map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
        </select>
        <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="detail" value="1" defaultChecked={!!detail} /> Each project&apos;s codes separately</label>
        <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="sys" value="1" defaultChecked={!!sys} /> Show system accounts</label>
        <button className="btn">Apply</button>
      </form>}
      <div className="tw"><table>
        <thead><tr><th>Code</th><th>Name</th><th className="hide-sm">Type</th><th className="hide-sm">Cost center</th><th className="num hide-sm">Budget</th><th className="num">Balance</th></tr></thead>
        <tbody>{out.map(({ r, depth }) => (
          <tr key={r.code + '|' + r.name} className={r.postable ? '' : 'hdr'}>
            <td className="mono" style={{ paddingLeft: 10 + depth * 16 }}>{r.code}</td>
            <td dir="auto">{!r.postable ? r.name
              : grouped && isProjectCode(r.code + '-1') && r.parent === '20000' ? <Link href={`/accounts?code=${encodeURIComponent(r.code)}`} title="Split per project">{r.name}</Link>
              : <Link href={`/reports/ledger?account=${encodeURIComponent(r.code)}`}>{r.name}</Link>}
              {r.is_bank ? <span className="pill" style={{ marginLeft: 6 }}>bank</span> : null}{r.is_system ? <span className="pill" style={{ marginLeft: 6 }}>system</span> : null}</td>
            <td className="hide-sm">{TYPES[r.type].label}</td><td className="hide-sm">{grouped && r.parent === '20000' ? 'All projects' : r.project}</td>
            <td className="num hide-sm">{r.budget ? fmt(r.budget) : ''}</td><td className="num">{fmt(roll(r))}</td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}
