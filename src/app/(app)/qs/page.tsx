import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { phaseLabel } from '@/lib/projects';
import { statusClass as pill, statusLabel } from '@/lib/qs-calc';
import { ALL_MATERIALS, boqSummary, canEditRates, canQs, getRates, listEstimates, qsProjects, rateHistory } from '@/lib/qs';
import { BATHROOM, ELECFIN, ELECTRICAL, KITCHEN, SANITARY } from '@/lib/qs-data';
import { createEstimateAction, saveRatesAction } from './actions';

export default async function QsPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { tab = 'estimates', error, saved } = await searchParams;
  const tabs = [['estimates', 'Estimates'], ['summary', 'BOQ summary'], ['rates', 'Rate table']] as const;
  return (
    <>
      <div className="head"><div><h1>QS and pricing</h1><p>The Master BOQ for every project after its design: the technical office fills the five calculators (bathroom and kitchen plumbing, electrical, sanitary and electrical finishing) and the Master BOQ, the app works out the quantities, the dry cost and the client price (dry cost 70 %, risk 10 %, margin 20 %, VAT 14 % apart).</p></div></div>
      <div className="tabs">{tabs.map(([k, v]) => <Link key={k} href={`/qs?tab=${k}`} className={tab === k ? 'on' : ''}>{v}</Link>)}</div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      {tab === 'estimates' && <Estimates canStart={canQs(user)} />}
      {tab === 'summary' && <Summary />}
      {tab === 'rates' && <Rates canEdit={await canEditRates(user)} />}
    </>
  );
}

async function Estimates({ canStart }: { canStart: boolean }) {
  const [projects, estimates] = await Promise.all([qsProjects(), listEstimates()]);
  if (projects.length === 0) return <div className="empty card">No project is in QS and pricing yet. A project gets here once its shop drawings are issued for construction (or its form says the design is ready).</div>;
  return (
    <>{projects.map(p => {
      const mine = estimates.filter(e => e.project_id === p.id);
      const open = mine.find(e => ['draft', 'sent'].includes(e.status));
      return (
        <div key={p.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}><Link href={`/cost-centers/${p.id}`}>{p.code}</Link> <span className="muted" style={{ fontWeight: 400 }} dir="auto">· {p.name}{p.phase ? ` · ${phaseLabel(p.phase)}` : ''}</span></h2>
            {!open && canStart && <form action={createEstimateAction.bind(null, p.id)}><button className="btn sm pri">{mine.length ? 'New estimate' : 'Start the estimate'}</button></form>}
          </div>
          {mine.length === 0 ? <p className="muted" style={{ marginBottom: 0 }}>No estimate yet.</p> : (
            <div className="tw" style={{ marginTop: 8 }}><table>
              <thead><tr><th>Rev</th><th>Status</th><th className="num">Dry cost</th><th className="num">Client price</th><th className="hide-sm">Last change</th><th></th></tr></thead>
              <tbody>{mine.map(e => <tr key={e.id}><td>rev {e.rev}</td><td><span className={pill(e.status)}>{e.status_label}</span></td><td className="num mono">{fmt(e.dry_cost)}</td><td className="num mono">{fmt(e.client_price)}</td>
                <td className="hide-sm muted">{e.updated_at}{e.who ? ` · ${e.who}` : ''}</td><td><Link className="btn sm" href={`/qs/${e.id}`}>Open</Link></td></tr>)}</tbody>
            </table></div>)}
        </div>);
    })}</>);
}

async function Summary() {
  const rows = await boqSummary();
  return rows.length === 0 ? <div className="empty card">No estimates yet.</div> : (
    <div className="tw"><table>
      <thead><tr><th>Project</th><th className="hide-sm">Phase</th><th>Latest</th><th className="num">Dry cost</th><th className="num hide-sm">Risk</th><th className="num hide-sm">Margin</th><th className="num">Client price</th><th className="num">Contract</th><th className="num hide-sm">Revisions</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.project_id}><td><Link href={`/cost-centers/${r.project_id}`}>{r.code}</Link></td><td className="hide-sm">{phaseLabel(r.phase ?? '') || ''}</td>
        <td><Link href={`/qs/${r.estimate_id}`}>rev {r.rev}</Link> <span className={pill(r.status)}>{statusLabel(r.status)}</span></td>
        <td className="num mono">{fmt(r.dry_cost)}</td><td className="num mono hide-sm">{fmt(r.client_price * r.risk_pct / 100)}</td><td className="num mono hide-sm">{fmt(r.client_price * r.margin_pct / 100)}</td>
        <td className="num mono">{fmt(r.client_price)}</td><td className="num mono">{r.accepted != null ? fmt(r.accepted) : <span className="muted">not yet</span>}</td><td className="num hide-sm">{r.revs}</td></tr>)}</tbody>
    </table></div>);
}

async function Rates({ canEdit }: { canEdit: boolean }) {
  const [rates, history] = await Promise.all([getRates(), rateHistory()]);
  const calcs = [['bathroom', BATHROOM.title], ['kitchen', KITCHEN.title], ['electrical', ELECTRICAL.title], ['sanitary', SANITARY.title], ['elecfin', ELECFIN.title]] as const;
  return (
    <form action={saveRatesAction}>
      <p className="muted" style={{ marginTop: 0 }}>The unit prices the calculators use (EGP). A new estimate takes today's prices; an estimate already started keeps its own. Procurement, the engineers and Finance may change them.</p>
      {calcs.map(([c, title]) => (
        <div key={c} className="card">
          <h2 style={{ marginTop: 0, fontSize: 15 }} dir="auto">{title}</h2>
          <div className="tw"><table>
            <thead><tr><th>No.</th><th>Material</th><th className="hide-sm">Size / brand</th><th>Unit</th><th className="num">Price</th></tr></thead>
            <tbody>{ALL_MATERIALS.filter(m => m.calculator === c).map(m => (
              <tr key={m.key}><td className="mono">{m.no}</td><td dir="auto">{m.desc}</td><td className="hide-sm muted" dir="auto">{[m.size, m.brand].filter(Boolean).join(' · ')}</td><td dir="auto">{m.unit}</td>
                <td className="num">{canEdit ? <input className="inp mono" name={`rate_${m.key}`} type="number" step="0.01" min="0" defaultValue={rates[m.key]} style={{ width: 110, textAlign: 'right' }} /> : <span className="mono">{fmt(rates[m.key])}</span>}</td></tr>))}</tbody>
          </table></div>
        </div>))}
      {canEdit && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Save rates</button></div>}
      {history.length > 0 && <div className="card log" style={{ marginTop: 12 }}><h2 style={{ marginTop: 0 }}>Last changes</h2>{history.map(h => <div key={h.key}>{h.at} · {h.who ?? ''} · {ALL_MATERIALS.find(m => m.key === h.key)?.no ?? h.key} → {fmt(h.price)}</div>)}</div>}
    </form>
  );
}
