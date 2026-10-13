import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { today } from '@/lib/dates';
import { phaseLabel } from '@/lib/projects';
import { canPlan } from '@/lib/planning';
import { INSPECTION_STATUSES, REPORT_STATUSES, SNAG_STATUSES, label, listInspections, listReports, listSnags, siteRows, siteSummary } from '@/lib/site';
import { pillOf } from './ui';

const TABS = [['projects', 'My sites'], ['reports', 'Daily reports'], ['inspections', 'Inspections'], ['snags', 'Snag list'], ['summary', 'Summary']] as const;

/**
 * Site execution (the second Engineering section): the site engineer's daily reports from the phone, inspection requests,
 * the snag list and the handover certificate, per project; the engineers see every site, site staff see their own.
 */
export default async function Site({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string; month?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { tab = 'projects', project = '', month = today().slice(0, 7), ok, error } = await searchParams;
  const eng = canPlan(user) || hasRole(user, 'finance');
  const rows = await siteRows(user);
  if (!eng && !rows.length) return (
    <>
      <div className="head"><div><h1>Site execution</h1></div></div>
      <div className="card">You are not set as the site engineer or manager of any running project, so there is no site to report on. Finance sets the site engineer on the project page.</div>
    </>);
  return (
    <>
      <div className="head"><div><h1>Site execution</h1><p>Every day the site engineer sends the site report from the phone (work done, manpower, photos), asks for an inspection before covering a work, and keeps the snag list; the handover certificate closes the site.</p></div>
        <div className="row"><Link className="btn" href="/planning">Schedules</Link><Link className="btn" href="/cost-control">Cost control</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/site?tab=${k}${project ? `&project=${project}` : ''}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {tab === 'projects' && <Projects rows={rows} />}
      {tab === 'reports' && <Reports project={project} rows={rows} />}
      {tab === 'inspections' && <Inspections project={project} rows={rows} />}
      {tab === 'snags' && <Snags project={project} rows={rows} />}
      {tab === 'summary' && <Summary month={month} />}
    </>
  );
}

type Rows = Awaited<ReturnType<typeof siteRows>>;
function Filter({ tab, project, rows }: { tab: string; project: string; rows: Rows }) {
  return (
    <form className="card row" style={{ alignItems: 'end' }}>
      <input type="hidden" name="tab" value={tab} />
      <label className="f" style={{ flex: 1 }}><span>Project</span><select className="inp" name="project" defaultValue={project}><option value="">All sites</option>{rows.map(r => <option key={r.id} value={r.id}>{r.code}{r.name !== r.code ? ` · ${r.name}` : ''}</option>)}</select></label>
      <button className="btn">Show</button>
    </form>);
}

function Projects({ rows }: { rows: Rows }) {
  const now = today();
  if (!rows.length) return <div className="empty card">No project is in Execution or Handover yet. A project gets there when its schedule baseline is set (Planning), or by hand from the project page.</div>;
  return (
    <div className="grid g2">{rows.map(r => (
      <div key={r.id} className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}><Link href={`/cost-centers/${r.id}`}>{r.code}</Link>{r.name !== r.code ? <span className="muted" style={{ fontWeight: 400 }} dir="auto"> · {r.name}</span> : ''}</h2><span className={'pill ' + (r.phase === 'handover' ? 'posted' : 'pending')}>{phaseLabel(r.phase)}</span></div>
        <div className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>Site engineer {r.site_eng ?? '—'} · manager {r.manager ?? '—'} · last report {r.last_report ?? 'none yet'}{r.mine ? ' · yours' : ''}</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.today_id ? <Link className={'btn sm ' + (r.today_status === 'draft' ? 'pri' : '')} href={`/site/reports/${r.today_id}`}>{r.today_status === 'draft' ? 'Finish today’s report' : `Today’s report (${label(REPORT_STATUSES, r.today_status ?? '').toLowerCase()})`}</Link>
            : <Link className="btn sm pri" href={`/site/reports/new?project=${r.id}&day=${now}`}>Today&apos;s report</Link>}
          <Link className="btn sm" href={`/site/inspections/new?project=${r.id}`}>Ask for inspection</Link>
          <Link className="btn sm" href={`/site/snags?project=${r.id}`}>Snag list{r.open_snags + r.fixed_snags ? ` (${r.open_snags + r.fixed_snags})` : ''}</Link>
          <Link className="btn sm" href={`/site/handover/${r.id}`}>{r.handover_status === 'signed' ? 'Handover certificate ✓' : r.handover_status ? 'Handover certificate (draft)' : 'Handover'}</Link>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{r.reports} report{r.reports === 1 ? '' : 's'} · {r.open_inspections} inspection{r.open_inspections === 1 ? '' : 's'} waiting · {r.open_snags} open snag{r.open_snags === 1 ? '' : 's'}{r.fixed_snags ? `, ${r.fixed_snags} fixed to verify` : ''}</div>
      </div>))}</div>);
}

async function Reports({ project, rows }: { project: string; rows: Rows }) {
  const list = await listReports({ project: project || undefined });
  return (
    <>
      <Filter tab="reports" project={project} rows={rows} />
      {list.length === 0 ? <div className="empty card">No site report yet. Open My sites and tap Today&apos;s report.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Report</th><th>Day</th><th>Project</th><th className="num">Manpower</th><th className="hide-sm">Work done</th><th className="num hide-sm">Photos</th><th>Status</th></tr></thead>
          <tbody>{list.map(r => <tr key={r.id}><td><Link href={`/site/reports/${r.id}`} className="mono">{r.no}</Link></td><td className="mono">{r.day}</td><td>{r.code}</td><td className="num mono">{r.headcount}</td>
            <td className="hide-sm" dir="auto" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.work_done}</td><td className="num hide-sm">{r.photos}</td>
            <td><span className={'pill ' + pillOf(r.status)}>{label(REPORT_STATUSES, r.status)}</span></td></tr>)}</tbody>
        </table></div>)}
    </>);
}

async function Inspections({ project, rows }: { project: string; rows: Rows }) {
  const list = await listInspections({ project: project || undefined });
  return (
    <>
      <Filter tab="inspections" project={project} rows={rows} />
      {list.length === 0 ? <div className="empty card">No inspection requested yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Request</th><th>Project</th><th>What</th><th className="hide-sm">Where</th><th>For</th><th className="hide-sm">Inspector</th><th>Result</th></tr></thead>
          <tbody>{list.map(i => <tr key={i.id}><td><Link href={`/site/inspections/${i.id}`} className="mono">{i.no}</Link></td><td>{i.code}</td><td dir="auto">{i.title}{i.activity ? <span className="muted"> · {i.activity}</span> : ''}</td><td className="hide-sm" dir="auto">{i.location}</td><td className="mono">{i.requested_for}</td><td className="hide-sm">{i.inspector}</td>
            <td><span className={'pill ' + pillOf(i.status)}>{label(INSPECTION_STATUSES, i.status)}</span>{i.snag_no ? <span className="muted"> · S-{i.snag_no}</span> : ''}</td></tr>)}</tbody>
        </table></div>)}
    </>);
}

async function Snags({ project, rows }: { project: string; rows: Rows }) {
  const list = await listSnags({ project: project || undefined, open: true });
  const p = rows.find(r => r.id === project);
  return (
    <>
      <Filter tab="snags" project={project} rows={rows} />
      {p && <p><Link className="btn" href={`/site/snags?project=${p.id}`}>Open the snag list of {p.code}</Link></p>}
      {list.length === 0 ? <div className="empty card">No open snag.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th>#</th><th>Snag</th><th className="hide-sm">Trade</th><th className="hide-sm">Assigned to</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>{list.map(s => <tr key={s.id}><td><Link href={`/site/snags?project=${s.project_id}`}>{s.code}</Link></td><td className="mono">S-{s.snag_no}</td><td dir="auto">{s.area ? <b>{s.area} · </b> : ''}{s.description}</td><td className="hide-sm" dir="auto">{s.trade}</td><td className="hide-sm">{s.vendor ?? s.assignee ?? ''}</td>
            <td className="mono">{s.due ?? ''}</td><td><span className={'pill ' + pillOf(s.status)}>{label(SNAG_STATUSES, s.status)}</span></td></tr>)}</tbody>
        </table></div>)}
    </>);
}

async function Summary({ month }: { month: string }) {
  const list = await siteSummary(month);
  return (
    <>
      <form className="card row" style={{ alignItems: 'end' }}>
        <input type="hidden" name="tab" value="summary" />
        <label className="f"><span>Month</span><input className="inp" type="month" name="month" defaultValue={month} /></label>
        <button className="btn">Show</button>
      </form>
      {list.length === 0 ? <div className="empty card">Nothing on site yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Project</th><th className="num">Reports</th><th className="num">Man-days</th><th className="num hide-sm">Hours</th><th className="num">Inspections</th><th className="num hide-sm">Passed · failed</th><th className="num">Snags open</th><th className="num hide-sm">Verified</th><th>Handover</th></tr></thead>
          <tbody>{list.map(r => <tr key={r.id}><td><Link href={`/site?tab=reports&project=${r.id}`}>{r.code}</Link></td><td className="num mono">{r.reports}</td><td className="num mono">{r.man_days}</td><td className="num mono hide-sm">{r.hours}</td><td className="num mono">{r.inspections}</td><td className="num mono hide-sm">{r.passed} · {r.failed}</td>
            <td className="num mono">{r.open_snags ? <span className="pill rejected">{r.open_snags}</span> : 0}</td><td className="num mono hide-sm">{r.verified_snags}</td><td>{r.handover ? <span className={'pill ' + (r.handover === 'signed' ? 'posted' : 'pending')}>{r.handover}</span> : ''}</td></tr>)}</tbody>
        </table></div>)}
      <p className="muted" style={{ fontSize: 13 }}>Reports, man-days and hours are the month&apos;s sent reports; inspections and snags are the totals to date.</p>
    </>);
}
