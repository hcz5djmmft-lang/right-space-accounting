import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { listAccounts, listDepartments, listProjects, label } from '@/lib/queries';
import { budgetRows, raiseBudgetAlerts, unbudgeted } from '@/lib/budgets';
import { copyBudgetsAction, saveBudgetsAction, uploadBudgetsAction } from './actions';

const bar = (pct: number | null) => {
  const p = Math.min(pct ?? 0, 100), c = (pct ?? 0) >= 100 ? 'var(--bad)' : (pct ?? 0) >= 80 ? '#c98a00' : 'var(--gold, #c9a227)';
  return <div style={{ background: 'var(--line)', borderRadius: 4, height: 6, marginTop: 4 }}><div style={{ width: `${p}%`, background: c, height: 6, borderRadius: 4 }} /></div>;
};

/** Monthly budgets per project and department against actual (improvement 12). */
export default async function Budgets({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; error?: string }> }) {
  await requireUser('finance');
  const q = await searchParams;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.m ?? '') ? q.m! : today().slice(0, 7);
  await raiseBudgetAlerts().catch(e => console.error('budgets', e));
  const [rows, spent, projects, depts, accounts] = await Promise.all([budgetRows(period), unbudgeted(period), listProjects(), listDepartments(), listAccounts()]);
  const total = rows.reduce((t, r) => ({ amount: t.amount + r.amount, actual: t.actual + r.actual }), { amount: 0, actual: 0 });
  const expense = accounts.filter(a => a.type === 'expense');
  return (
    <>
      <div className="head"><div><h1>Budgets</h1><p>A monthly budget per project and department, for all costs or one GL code, against what was spent. A task goes to the project manager or department head at 80% and at 100%.</p></div>
        <Link className="btn" href="/reports/budget">Yearly budget by GL code</Link></div>
      {q.ok && <div className="msg good">{q.ok}</div>}
      {q.error && <div className="msg bad">{q.error}</div>}
      <form className="row card noprint" style={{ alignItems: 'end' }}>
        <label className="f"><span>Month</span><input className="inp" type="month" name="m" defaultValue={period} /></label>
        <button className="btn">Show</button>
      </form>
      <div className="tiles">
        <div className="tile"><div className="k">Budget</div><div className="v mono">{fmt(total.amount)}</div></div>
        <div className="tile"><div className="k">Spent</div><div className="v mono">{fmt(total.actual)}</div></div>
        <div className="tile"><div className="k">Left</div><div className="v mono" style={{ color: total.amount - total.actual < 0 ? 'var(--bad)' : undefined }}>{fmt(total.amount - total.actual)}</div></div>
        <div className="tile"><div className="k">Over 80%</div><div className="v">{rows.filter(r => (r.pct ?? 0) >= 80).length}</div></div>
      </div>
      <form action={saveBudgetsAction.bind(null, period)} className="card">
        <h2 style={{ marginTop: 0 }}>Budget against actual</h2>
        {rows.length === 0 ? <p className="muted">No budgets for this month yet. Type them below, copy last month&apos;s, or upload a file.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Cost center</th><th className="hide-sm">GL code</th><th className="num">Budget</th><th className="num">Spent</th><th className="num">Left</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                <td dir="auto">{r.cc} <span className="muted hide-sm">· {r.cc_name}</span>{bar(r.pct)}</td>
                <td className="hide-sm">{r.account ? <span title={r.account_name ?? ''}>{r.account}</span> : <span className="muted">All costs</span>}</td>
                <td className="num"><input className="inp mono" name={`amt_${r.project_id ? 'p:' + r.project_id : 'd:' + r.dept_id}|${r.account ?? ''}`} defaultValue={r.amount} inputMode="decimal" style={{ maxWidth: 130, textAlign: 'right' }} aria-label={`${r.cc} budget`} /></td>
                <td className="num">{fmt(r.actual)}<div className="muted" style={{ fontSize: 12 }}>{r.pct ?? 0}%</div></td>
                <td className="num" style={{ color: r.left < 0 ? 'var(--bad)' : undefined }}>{fmt(r.left)}</td>
              </tr>))}</tbody>
          </table></div>)}
        <h3>Add a budget line</h3>
        <div className="grid g3" style={{ alignItems: 'end' }}>
          <label className="f"><span>Project or department</span><select className="inp" name="new_cc" defaultValue="">
            <option value="">Choose</option>
            <optgroup label="Projects">{projects.filter(p => !p.is_office && p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{label(p)}</option>)}</optgroup>
            <optgroup label="Departments">{depts.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
          </select></label>
          <label className="f"><span>GL code (empty for all costs)</span><select className="inp" name="new_account" defaultValue=""><option value="">All costs</option>{expense.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
          <label className="f"><span>Amount</span><input className="inp mono" name="new_amount" inputMode="decimal" /></label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><span className="muted" style={{ fontSize: 13, flex: 1 }}>An amount of 0 removes the line.</span><button className="btn pri">Save budgets</button></div>
      </form>
      {spent.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Spent with no budget</h2>
          <div className="tw"><table><thead><tr><th>Cost center</th><th className="num">Spent</th></tr></thead>
            <tbody>{spent.map(s => <tr key={s.cc}><td dir="auto">{s.cc} <span className="muted">· {s.cc_name}</span></td><td className="num">{fmt(s.actual)}</td></tr>)}</tbody></table></div>
        </div>)}
      <div className="grid g2">
        {rows.length === 0 && <form action={copyBudgetsAction.bind(null, period)} className="card"><h2 style={{ marginTop: 0 }}>Copy last month</h2><p className="muted" style={{ marginTop: 0 }}>Start from the month before&apos;s budgets and adjust.</p><button className="btn">Copy last month&apos;s budgets</button></form>}
        <form action={uploadBudgetsAction.bind(null, period)} className="card">
          <h2 style={{ marginTop: 0 }}>Upload from Excel</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Columns <b>Month, Cost center, GL code, Amount</b> (one line per budget), or <b>Cost center</b> and <b>GL code</b> with a column per month (Jan 2026, Feb 2026 …). Cost center is the project code (PH-B1302) or department name. Lines in the file replace the same lines here.</p>
          <div className="row"><input type="file" name="file" accept=".xlsx,.csv,.txt" className="inp" /><button className="btn pri">Upload</button></div>
        </form>
      </div>
    </>
  );
}
