import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/books';
import { fmt } from '@/lib/money';
import { budgetVsActual, fiscalYearStart, today, type BudgetRow } from '@/lib/reports';
import { ReportTools } from '@/components/ReportTools';

export default async function BudgetReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser();
  const q = await searchParams;
  const settings = await getSettings();
  const from = q.from || fiscalYearStart(settings), to = q.to || today();
  const rows = await budgetVsActual({ from, to });
  const groups = new Map<string, BudgetRow[]>();
  for (const r of rows) { const k = r.project_id ?? ''; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const sum = (list: BudgetRow[], k: 'budget' | 'actual' | 'committed') => list.reduce((s, r) => s + (r[k] ?? 0), 0);
  const G = { bud: sum(rows, 'budget'), act: sum(rows, 'actual'), cm: sum(rows, 'committed') };
  return (
    <>
      <div className="head"><div><h1>Budget vs actual</h1><p>Per GL code, {from} to {to}</p></div><ReportTools report="budget" query={{ from, to }} /></div>
      <form className="row card noprint" style={{ alignItems: 'end' }}>
        <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
        <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
        <button className="btn">Show</button>
        <Link className="btn" href={`/reports/budget?from=${fiscalYearStart(settings)}&to=${today()}`}>This fiscal year</Link>
      </form>
      {rows.length === 0 ? <div className="empty card">No budgets or spending yet. Set budgets on GL codes in Chart of accounts.</div> : (
        <div className="tw"><table>
          <thead><tr><th>GL code</th><th>GL name</th><th className="hide-sm">Type</th><th className="num">Budget</th><th className="num">Actual</th><th className="num hide-sm">Committed</th><th className="num">Remaining</th><th className="hide-sm">Used</th></tr></thead>
          <tbody>{[...groups.entries()].map(([k, list]) => { const s = { bud: sum(list, 'budget'), act: sum(list, 'actual'), cm: sum(list, 'committed') }; return (
            <Group key={k || '_shared'} title={k ? `${list[0].project_code} · ${list[0].project_name}` : 'Shared GL codes (any cost center)'} list={list} sub={s} from={from} to={to} />); })}
          </tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="hide-sm"></td><td className="num">{fmt(G.bud)}</td><td className="num">{fmt(G.act)}</td><td className="num hide-sm">{fmt(G.cm)}</td><td className="num">{fmt(G.bud - G.act - G.cm)}</td><td className="hide-sm"></td></tr></tfoot>
        </table></div>)}
      <p className="muted" style={{ fontSize: 12 }}>Committed = payment requests submitted but not yet fully approved. Budgets are annual; keep the dates on the fiscal year for a like-for-like view.</p>
    </>
  );
}

function Group({ title, list, sub, from, to }: { title: string; list: BudgetRow[]; sub: { bud: number; act: number; cm: number }; from: string; to: string }) {
  return (
    <>
      <tr className="hdr"><td colSpan={8} dir="auto">{title}</td></tr>
      {list.map(r => (
        <tr key={r.code}>
          <td className="mono"><Link href={`/reports/ledger?account=${r.code}&from=${from}&to=${to}`}>{r.code}</Link></td><td dir="auto">{r.name}</td><td className="hide-sm">{r.cost_type ?? ''}</td>
          <td className="num">{r.budget === null ? <span className="muted">—</span> : fmt(r.budget)}</td><td className="num">{fmt(r.actual)}</td><td className="num hide-sm">{r.committed ? fmt(r.committed) : ''}</td>
          <td className="num" style={r.remaining !== null && r.remaining < 0 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{r.remaining === null ? '—' : fmt(r.remaining)}</td>
          <td className="hide-sm" style={{ minWidth: 120 }}>{r.pct !== null && (
            <div className="row" style={{ gap: 6 }}><div className="bar"><div style={{ width: `${Math.min(100, r.pct)}%`, background: r.pct > 100 ? 'var(--bad)' : r.pct > 85 ? 'var(--warn, #c9952f)' : 'var(--gold, #e5b35a)' }} /></div><span className="mono" style={{ fontSize: 12 }}>{r.pct}%</span></div>)}</td>
        </tr>))}
      <tr><td></td><td className="muted">Subtotal</td><td className="hide-sm"></td><td className="num">{fmt(sub.bud)}</td><td className="num">{fmt(sub.act)}</td><td className="num hide-sm">{sub.cm ? fmt(sub.cm) : ''}</td><td className="num">{fmt(sub.bud - sub.act - sub.cm)}</td><td className="hide-sm"></td></tr>
    </>
  );
}
