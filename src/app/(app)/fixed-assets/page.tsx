import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { getSettings } from '@/lib/books';
import { listAccounts, listDepartments, listProjects, label } from '@/lib/queries';
import { depreciationFor, depreciationRun, depreciationRuns, listAssets } from '@/lib/assets';
import { addAssetAction, postDepreciationAction, saveCodesAction, voidDepreciationAction } from './actions';

/** Fixed assets register and the monthly depreciation (improvement 14). */
export default async function FixedAssets({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; error?: string }> }) {
  await requireUser('finance');
  const q = await searchParams;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.m ?? '') ? q.m! : today().slice(0, 7);
  const [assets, due, run, runs, s, accounts, projects, depts] = await Promise.all([listAssets(), depreciationFor(period), depreciationRun(period), depreciationRuns(), getSettings(), listAccounts(), listProjects(), listDepartments()]);
  const m = s.account_map;
  const office = new Set(projects.filter(p => p.is_office).map(p => p.id)); // office codes, not the per-project copies
  const banks = accounts.filter(a => a.is_bank && a.postable);
  const active = assets.filter(a => !a.stopped_on);
  const codeSelect = (name: string, type: string, value?: string) => (
    <select className="inp" name={name} defaultValue={value ?? ''}><option value="">Not set</option>{accounts.filter(a => a.postable && a.type === type && (!a.project_id || office.has(a.project_id))).map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>);
  return (
    <>
      <div className="head"><div><h1>Fixed assets</h1><p>The register, with straight-line depreciation posted once a month.</p></div></div>
      {q.ok && <div className="msg good">{q.ok}</div>}
      {q.error && <div className="msg bad">{q.error}</div>}
      {!m.depExp && <div className="msg bad">Pick the depreciation expense GL code under &quot;GL codes&quot; below before posting depreciation. The chart has no depreciation code yet; choose an existing one or ask for one to be added.</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Assets in use</div><div className="v">{active.length}</div></div>
        <div className="tile"><div className="k">Cost</div><div className="v mono">{fmt(active.reduce((t, a) => t + a.cost, 0))}</div></div>
        <div className="tile"><div className="k">Depreciated</div><div className="v mono">{fmt(active.reduce((t, a) => t + a.depreciated, 0))}</div></div>
        <div className="tile"><div className="k">Book value</div><div className="v mono">{fmt(active.reduce((t, a) => t + a.book_value, 0))}</div></div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Depreciation</h2>
          <form className="row"><input className="inp" type="month" name="m" defaultValue={period} /><button className="btn sm">Show</button></form>
        </div>
        {run ? <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 8 }}>
            <span><span className="pill posted">Posted</span> {period}: <Link href={`/entries/${run.entry_id}`}>{run.no}</Link> · {fmt(run.total)} by {run.posted_by} on {run.posted_at}</span>
            <form action={voidDepreciationAction.bind(null, period)} className="row"><input className="inp" name="reason" placeholder="Why (optional)" /><button className="btn bad sm">Void</button></form>
          </div>
          : due.length === 0 ? <p className="muted">Nothing to depreciate in {period}.</p> : <>
            <div className="tw"><table style={{ marginTop: 8 }}><thead><tr><th>Asset</th><th className="num">This month</th></tr></thead>
              <tbody>{due.map(d => <tr key={d.id}><td dir="auto"><Link href={`/fixed-assets/${d.id}`}>{d.no}</Link> · {d.name}</td><td className="num">{fmt(d.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td>Total</td><td className="num">{fmt(due.reduce((t, d) => t + d.amount, 0))}</td></tr></tfoot></table></div>
            <form action={postDepreciationAction.bind(null, period)} className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri" disabled={!m.depExp}>Post depreciation for {period}</button></form>
          </>}
        {runs.length > 0 && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Posted: {runs.map(r => <span key={r.period}><Link href={`/fixed-assets?m=${r.period}`}>{r.period}</Link> ({fmt(r.total)}) </span>)}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Register</h2>
        {assets.length === 0 ? <p className="muted">No assets yet. Add the first one below.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Asset</th><th className="hide-sm">In service</th><th className="hide-sm">Cost center</th><th className="num">Cost</th><th className="num hide-sm">Per month</th><th className="num">Book value</th></tr></thead>
            <tbody>{assets.map(a => <tr key={a.id}><td dir="auto"><Link href={`/fixed-assets/${a.id}`}>{a.no}</Link> · {a.name}{a.category ? <span className="muted"> · {a.category}</span> : null}{a.stopped_on && <> <span className="pill rejected">Stopped</span></>}</td>
              <td className="mono hide-sm">{a.in_service}</td><td className="hide-sm">{a.cc}</td><td className="num">{fmt(a.cost)}</td><td className="num hide-sm">{fmt(a.monthly)}</td><td className="num">{fmt(a.book_value)}</td></tr>)}</tbody>
          </table></div>)}
      </div>

      <form action={addAssetAction} className="card">
        <h2 style={{ marginTop: 0 }}>Add an asset</h2>
        <div className="grid g3">
          <label className="f"><span>Name</span><input className="inp" name="name" dir="auto" placeholder="Site laptop" /></label>
          <label className="f"><span>Category</span><input className="inp" name="category" list="fa-cats" placeholder="Computers" /></label>
          <label className="f"><span>Used by</span><select className="inp" name="cc" defaultValue="">
            <option value="">Choose</option>
            <optgroup label="Departments">{depts.filter(d => d.active).map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
            <optgroup label="Projects">{projects.filter(p => !p.is_office && p.status !== 'Closed').map(p => <option key={p.id} value={'p:' + p.id}>{label(p)}</option>)}</optgroup>
          </select></label>
          <label className="f"><span>In service from</span><input className="inp" type="date" name="in_service" defaultValue={today()} /></label>
          <label className="f"><span>Cost</span><input className="inp mono" name="cost" inputMode="decimal" /></label>
          <label className="f"><span>Salvage value</span><input className="inp mono" name="salvage" inputMode="decimal" placeholder="0" /></label>
          <label className="f"><span>Useful life (months)</span><input className="inp mono" name="life_months" inputMode="numeric" placeholder="36" /></label>
          <label className="f"><span>Payment</span><select className="inp" name="paid_from" defaultValue="">
            <option value="">Already in the books</option>{banks.map(b => <option key={b.code} value={b.code}>Paid now from {b.name}</option>)}</select></label>
          <label className="f"><span>Notes</span><input className="inp" name="notes" dir="auto" placeholder="Serial no., supplier" /></label>
        </div>
        <datalist id="fa-cats">{['Computers', 'Furniture', 'Vehicles', 'Tools and equipment', 'Office fit-out'].map(c => <option key={c} value={c} />)}</datalist>
        <p className="muted" style={{ fontSize: 13 }}>&quot;Paid now&quot; posts the purchase to {m.fixedAssets ?? 'the fixed assets code'} from the bank or cash account. Choose &quot;Already in the books&quot; if it was bought through a payment request or is in the opening balances.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Add asset</button></div>
      </form>

      <form action={saveCodesAction} className="card">
        <h2 style={{ marginTop: 0 }}>GL codes</h2>
        <div className="grid g3">
          <label className="f"><span>Fixed assets (cost)</span>{codeSelect('fixedAssets', 'asset', m.fixedAssets)}</label>
          <label className="f"><span>Accumulated depreciation</span>{codeSelect('accDep', 'asset', m.accDep)}</label>
          <label className="f"><span>Depreciation expense</span>{codeSelect('depExp', 'expense', m.depExp)}</label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn">Save GL codes</button></div>
      </form>
    </>
  );
}
