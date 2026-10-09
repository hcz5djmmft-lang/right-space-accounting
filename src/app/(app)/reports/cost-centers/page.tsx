import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/books';
import { listDepartments } from '@/lib/queries';
import { fmt } from '@/lib/money';
import { costCenters, fiscalYearStart, today, type CCRow } from '@/lib/reports';
import { ReportTools } from '@/components/ReportTools';

const GROUPS: [string, string][] = [['type', 'Project type'], ['service', 'Service'], ['unit', 'Unit type']];

export default async function CostCentersReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; cc?: string; group?: string }> }) {
  await requireUser();
  const q = await searchParams;
  const settings = await getSettings();
  const from = q.from || fiscalYearStart(settings), to = q.to || today();
  const dept = q.cc?.startsWith('d:') ? q.cc.slice(2) : undefined;
  const gk = (GROUPS.some(([k]) => k === q.group) ? q.group : 'type') as 'type' | 'service' | 'unit';
  const [rows, departments] = await Promise.all([costCenters({ from, to, dept }), listDepartments()]);
  const groups = new Map<string, CCRow[]>();
  for (const r of rows) { const g = r.id === null ? '' : (r[gk] ?? ''); groups.set(g, [...(groups.get(g) ?? []), r]); }
  const order = [...new Set([...(settings.cats[gk] ?? []), ...[...groups.keys()].filter(Boolean), ''])].filter(g => groups.has(g));
  const sum = (list: CCRow[], k: 'rev' | 'cost' | 'contract' | 'budget' | 'net') => list.reduce((s, r) => s + (r[k] ?? 0), 0);
  const G = { cv: sum(rows, 'contract'), bud: sum(rows, 'budget'), rev: sum(rows, 'rev'), cost: sum(rows, 'cost') };
  return (
    <>
      <div className="head"><div><h1>Cost centers</h1><p>Revenue and cost per project, {from} to {to}</p></div><ReportTools report="cc" query={{ from, to, cc: q.cc }} /></div>
      <form className="row card noprint" style={{ alignItems: 'end' }}>
        <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
        <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
        <label className="f"><span>Department</span><select className="inp" name="cc" defaultValue={q.cc ?? ''}><option value="">All departments</option>{departments.map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</select></label>
        <label className="f"><span>Group by</span><select className="inp" name="group" defaultValue={gk}>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <button className="btn">Show</button>
      </form>
      <div className="tw"><table>
        <thead><tr><th>Code</th><th>Cost center</th><th className="num hide-sm">Contract value</th><th className="num hide-sm">Cost budget</th><th className="num">Revenue</th><th className="num hide-sm">Opex</th><th className="num hide-sm">Capex</th><th className="num">Total cost</th><th className="num hide-sm">Budget used</th><th className="num">Net</th></tr></thead>
        <tbody>{order.map(g => { const list = groups.get(g)!; return (
          <Row key={g || '_'} title={g || 'Uncategorised'} list={list} sub={{ cv: sum(list, 'contract'), bud: sum(list, 'budget'), rev: sum(list, 'rev'), cost: sum(list, 'cost') }} />); })}
        </tbody>
        <tfoot><tr><td colSpan={2}>Total</td><td className="num hide-sm">{fmt(G.cv)}</td><td className="num hide-sm">{fmt(G.bud)}</td><td className="num">{fmt(G.rev)}</td><td className="hide-sm"></td><td className="hide-sm"></td><td className="num">{fmt(G.cost)}</td><td className="hide-sm"></td><td className="num">{fmt(G.rev - G.cost)}</td></tr></tfoot>
      </table></div>
      <p className="muted" style={{ fontSize: 12 }}>Revenue and cost for the dates above. Budget used compares the cost in this period with the project's cost budget. Click a cost center to open its project card.</p>
    </>
  );
}

function Row({ title, list, sub }: { title: string; list: CCRow[]; sub: { cv: number; bud: number; rev: number; cost: number } }) {
  return (
    <>
      <tr className="hdr"><td colSpan={10}>{title}</td></tr>
      {list.map(r => (
        <tr key={r.id ?? '_none'}>
          <td className="mono">{r.id ? <Link href={`/cost-centers/${r.id}`}>{r.code}</Link> : ''}</td>
          <td dir="auto">{r.id ? r.name : <span className="muted">No cost center</span>}{r.client && <div className="muted" style={{ fontSize: 11 }}>{r.client}</div>}</td>
          <td className="num hide-sm">{r.contract ? fmt(r.contract) : ''}</td><td className="num hide-sm">{r.budget ? fmt(r.budget) : ''}</td>
          <td className="num">{fmt(r.rev)}</td><td className="num hide-sm">{fmt(r.opex)}</td><td className="num hide-sm">{fmt(r.capex)}</td><td className="num">{fmt(r.cost)}</td>
          <td className="num hide-sm" style={r.pct !== null && r.pct > 100 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{r.pct === null ? '' : `${r.pct}%`}</td>
          <td className="num" style={r.net < 0 ? { color: 'var(--bad)' } : undefined}>{fmt(r.net)}</td>
        </tr>))}
      <tr><td></td><td className="muted">Subtotal</td><td className="num hide-sm">{sub.cv ? fmt(sub.cv) : ''}</td><td className="num hide-sm">{sub.bud ? fmt(sub.bud) : ''}</td><td className="num">{fmt(sub.rev)}</td><td className="hide-sm"></td><td className="hide-sm"></td><td className="num">{fmt(sub.cost)}</td><td className="hide-sm"></td><td className="num">{fmt(sub.rev - sub.cost)}</td></tr>
    </>
  );
}
