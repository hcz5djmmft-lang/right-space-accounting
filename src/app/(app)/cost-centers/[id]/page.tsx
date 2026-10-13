import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { getSettings } from '@/lib/books';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { ProjectFields } from '@/components/ProjectFields';
import { updateProject } from '../actions';
import { designTotals } from '@/lib/attendance';
import { fmtMin } from '@/lib/attendance-calc';
import { PHASES, canProjects, getInfo, phaseLabel, phaseLog } from '@/lib/projects';
import { FIELDS } from '@/lib/project-form';
import { KINDS, OPEN_STATUSES } from '@/lib/design-calc';
import { canDesign, listSets } from '@/lib/design';
import { ProjectQsCard } from '../../qs/ProjectQsCard';
import { setPhaseAction } from './form/actions';
import { createSetAction } from '../../design/actions';

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; moved?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved, moved, error } = await searchParams;
  const [p] = await sql`select *, to_char(start_date,'YYYY-MM-DD') start, to_char(end_date,'YYYY-MM-DD') "end" from projects where id = ${id}`;
  if (!p) notFound();
  const [settings, customers, byCode, [tot], [design], info, log, sets] = await Promise.all([
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
    designTotals(id),
    p.is_office ? Promise.resolve(null) : getInfo(id),
    p.is_office ? Promise.resolve([]) : phaseLog(id),
    p.is_office ? Promise.resolve([]) : listSets({ project: id }),
  ]);
  const used = byCode.filter(r => r.actual || r.budget);
  const engineer = canProjects(user);
  const steps = PHASES.filter(x => x[0] !== 'closed');
  const at = steps.findIndex(x => x[0] === p.phase);
  return (
    <>
      <div className="head"><div><h1>{p.code}</h1><p dir="auto">{p.name}{p.gl_suffix ? ` · GL suffix -${p.gl_suffix}` : ''}{p.phase ? ` · ${phaseLabel(p.phase)}` : ''}</p></div>
        <div className="row">{!p.is_office && <Link className={'btn' + (p.phase === 'form' ? ' pri' : '')} href={`/cost-centers/${id}/form`}>Project form{info ? ` (${info.answered}/${FIELDS.length})` : ''}</Link>}
          {!p.is_office && <Link className={'btn' + (p.phase === 'form' ? '' : ' pri')} href={`/cost-centers/${id}/boq`}>BOQ vs actual</Link>}<Link className="btn" href={`/accounts?project=${id}`}>GL codes</Link></div></div>
      {saved && <div className="msg good">{moved ? `Saved. The project is now at ${moved}.` : 'Saved.'}</div>}
      {error && <div className="msg bad">{error}</div>}
      {!p.is_office && (
        <div className="steps">{steps.map(([k, label], i) => (
          <div key={k} className={k === p.phase ? 'cur' : ''}><b>{label}</b>
            <div className="muted" style={{ fontSize: 12 }}>{i < at ? 'done' : k === p.phase ? (p.phase === 'form' ? (info?.completed_at ? 'complete' : `${info?.answered ?? 0} of ${FIELDS.length} answered`) : 'now') : 'next'}</div></div>))}</div>)}
      <div className="tiles">
        <div className="tile"><div className="k">Contract</div><div className="v mono">{fmt(p.contract)}</div></div>
        <div className="tile"><div className="k">Cost budget</div><div className="v mono">{fmt(p.budget)}</div></div>
        <div className="tile"><div className="k">Spent</div><div className="v mono">{fmt(tot.spent)}</div></div>
        <div className="tile"><div className="k">Collected</div><div className="v mono">{fmt(tot.collected)}</div></div>
        {design && <div className="tile"><div className="k">Design hours · cost</div><div className="v mono">{fmtMin(design.minutes)} · {fmt(design.cost)}</div></div>}
      </div>
      <h2>Spending by GL code</h2>
      {used.length === 0 ? <div className="empty card">No spending posted on this project yet.</div> : (
        <div className="tw" style={{ marginBottom: 16 }}><table>
          <thead><tr><th>GL code</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Remaining</th></tr></thead>
          <tbody>{used.map(r => <tr key={r.code}><td dir="auto"><span className="mono">{r.code}</span> · {r.name}</td><td className="num">{r.budget ? fmt(r.budget) : ''}</td>
            <td className="num">{fmt(r.actual)}</td><td className="num">{r.budget ? fmt(r.budget - r.actual) : ''}</td></tr>)}</tbody>
        </table></div>)}
      {!p.is_office && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Phase</h2>
          <p className="muted" style={{ marginTop: 0 }}>The project moves on by itself as each phase is finished (the form complete, the design approved, the BOQ accepted…). Finance or an engineer can also move it by hand.</p>
          {engineer && (
            <form action={setPhaseAction.bind(null, id)} className="row" style={{ marginBottom: 10 }}>
              <select className="inp" name="phase" defaultValue={p.phase ?? 'form'} style={{ maxWidth: 200 }}>{PHASES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input className="inp" name="note" placeholder="Why (optional)" dir="auto" style={{ flex: 1, minWidth: 160 }} />
              <button className="btn">Move</button>
            </form>)}
          <div className="log">{log.length === 0 ? <span className="muted">No phase changes recorded.</span> : log.map((h, i) => <div key={i}>{h.at} · {h.who ?? ''} · {h.label}{h.note ? ` — ${h.note}` : ''}</div>)}</div>
        </div>)}
      {!p.is_office && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Design</h2>
            <span className="row"><Link className="btn sm" href={`/design?tab=register&project=${id}`}>Drawing register</Link><Link className="btn sm" href={`/design/finishes?project=${id}`}>Finishes & materials</Link></span></div>
          <div className="tw" style={{ marginTop: 8 }}><table>
            <thead><tr><th>Set</th><th>Status</th><th className="hide-sm">Designer</th><th></th></tr></thead>
            <tbody>{KINDS.map(([kind, label]) => {
              const open = sets.find(s => s.kind === kind && OPEN_STATUSES.includes(s.status));
              const last = open ?? sets.find(s => s.kind === kind);
              return (
                <tr key={kind}><td>{label}{last ? <span className="muted"> v{last.version}</span> : ''}</td>
                  <td>{last ? <span className={'pill ' + (['approved', 'client_approved', 'ifc'].includes(last.status) ? 'posted' : last.status === 'rejected' ? 'rejected' : last.status === 'draft' ? '' : 'pending')}>{last.status_label}</span> : <span className="muted">not started</span>}</td>
                  <td className="hide-sm">{last?.designer ?? ''}</td>
                  <td>{last && <Link className="btn sm" href={`/design/${last.id}`}>Open</Link>}
                    {!open && canDesign(user) && <form action={createSetAction.bind(null, id, kind)} style={{ display: 'inline' }}><button className="btn sm" style={{ marginLeft: 6 }}>{last ? 'New set' : 'Start'}</button></form>}</td></tr>);
            })}</tbody></table></div>
        </div>)}
      {!p.is_office && <ProjectQsCard id={id} user={user} />}
      {hasRole(user, 'finance') && (
        <form action={updateProject.bind(null, id)} className="card">
          <h2>Project details</h2>
          <ProjectFields p={p} cats={settings.cats} customers={customers} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn pri">Save</button></div>
        </form>)}
    </>
  );
}
