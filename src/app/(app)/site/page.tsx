import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { today } from '@/lib/dates';
import { phaseLabel } from '@/lib/projects';
import { canPlan } from '@/lib/planning';
import { INSPECTION_STATUSES, REPORT_STATUSES, SNAG_STATUSES, label, listInspections, listReports, listSnags, siteRows, siteSummary } from '@/lib/site';
import { pillOf } from './ui';
import { tr, type Lang } from '@/lib/i18n';
import { getLang } from '@/lib/lang';

const TABS = [['projects', 'My sites'], ['reports', 'Daily reports'], ['inspections', 'Inspections'], ['snags', 'Snag list'], ['summary', 'Summary']] as const;

/**
 * Site execution (the second Engineering section): the site engineer's daily reports from the phone, inspection requests,
 * the snag list and the handover certificate, per project; the engineers see every site, site staff see their own.
 */
export default async function Site({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string; month?: string; ok?: string; error?: string }> }) {
  const user = await requireUser();
  const lang = await getLang(), t = (x: string, v?: Record<string, string | number>) => tr(lang, x, v);
  const { tab = 'projects', project = '', month = today().slice(0, 7), ok, error } = await searchParams;
  const eng = canPlan(user) || hasRole(user, 'finance');
  const rows = await siteRows(user);
  if (!eng && !rows.length) return (
    <>
      <div className="head"><div><h1>{t('Site execution')}</h1></div></div>
      <div className="card">{t('You are not set as the site engineer or manager of any running project, so there is no site to report on. Finance sets the site engineer on the project page.')}</div>
    </>);
  return (
    <>
      <div className="head"><div><h1>{t('Site execution')}</h1><p>{t('Every day the site engineer sends the site report from the phone (work done, manpower, photos), asks for an inspection before covering a work, and keeps the snag list; the handover certificate closes the site.')}</p></div>
        <div className="row"><Link className="btn" href="/planning">{t('Schedules')}</Link><Link className="btn" href="/cost-control">{t('Cost control')}</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/site?tab=${k}${project ? `&project=${project}` : ''}`} className={tab === k ? 'on' : ''}>{t(l)}</Link>)}</div>
      {tab === 'projects' && <Projects rows={rows} lang={lang} />}
      {tab === 'reports' && <Reports project={project} rows={rows} />}
      {tab === 'inspections' && <Inspections project={project} rows={rows} />}
      {tab === 'snags' && <Snags project={project} rows={rows} />}
      {tab === 'summary' && <Summary month={month} />}
    </>
  );
}

type Rows = Awaited<ReturnType<typeof siteRows>>;
const translator = async () => { const lang = await getLang(); return (x: string, v?: Record<string, string | number>) => tr(lang, x, v); };
async function Filter({ tab, project, rows }: { tab: string; project: string; rows: Rows }) {
  const t = await translator();
  return (
    <form className="card row" style={{ alignItems: 'end' }}>
      <input type="hidden" name="tab" value={tab} />
      <label className="f" style={{ flex: 1 }}><span>{t('Project')}</span><select className="inp" name="project" defaultValue={project}><option value="">{t('All sites')}</option>{rows.map(r => <option key={r.id} value={r.id}>{r.code}{r.name !== r.code ? ` · ${r.name}` : ''}</option>)}</select></label>
      <button className="btn">{t('Show')}</button>
    </form>);
}

function Projects({ rows, lang }: { rows: Rows; lang: Lang }) {
  const t = (x: string, v?: Record<string, string | number>) => tr(lang, x, v);
  const now = today();
  if (!rows.length) return <div className="empty card">{t('No project is in Execution or Handover yet. A project gets there when its schedule baseline is set (Planning), or by hand from the project page.')}</div>;
  return (
    <div className="grid g2">{rows.map(r => (
      <div key={r.id} className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}><Link href={`/cost-centers/${r.id}`}>{r.code}</Link>{r.name !== r.code ? <span className="muted" style={{ fontWeight: 400 }} dir="auto"> · {r.name}</span> : ''}</h2><span className={'pill ' + (r.phase === 'handover' ? 'posted' : 'pending')}>{t(phaseLabel(r.phase))}</span></div>
        <div className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>{t('Site engineer')} {r.site_eng ?? '—'} · {t('manager')} {r.manager ?? '—'} · {t('last report')} {r.last_report ?? t('none yet')}{r.mine ? ` · ${t('yours')}` : ''}</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.today_id ? <Link className={'btn sm ' + (r.today_status === 'draft' ? 'pri' : '')} href={`/site/reports/${r.today_id}`}>{r.today_status === 'draft' ? t("Finish today's report") : `${t("Today's report")} (${lang === 'ar' ? t(label(REPORT_STATUSES, r.today_status ?? '')) : label(REPORT_STATUSES, r.today_status ?? '').toLowerCase()})`}</Link>
            : <Link className="btn sm pri" href={`/site/reports/new?project=${r.id}&day=${now}`}>{t("Today's report")}</Link>}
          <Link className="btn sm" href={`/site/inspections/new?project=${r.id}`}>{t('Ask for inspection')}</Link>
          <Link className="btn sm" href={`/site/snags?project=${r.id}`}>{t('Snag list')}{r.open_snags + r.fixed_snags ? ` (${r.open_snags + r.fixed_snags})` : ''}</Link>
          <Link className="btn sm" href={`/site/handover/${r.id}`}>{t(r.handover_status === 'signed' ? 'Handover certificate ✓' : r.handover_status ? 'Handover certificate (draft)' : 'Handover')}</Link>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{lang === 'ar' ? <>{r.reports} {t('reports')} · {r.open_inspections} {t('inspections waiting')} · {r.open_snags} {t('open snags')}{r.fixed_snags ? `، ${r.fixed_snags} ${t('fixed to verify')}` : ''}</>
          : <>{r.reports} report{r.reports === 1 ? '' : 's'} · {r.open_inspections} inspection{r.open_inspections === 1 ? '' : 's'} waiting · {r.open_snags} open snag{r.open_snags === 1 ? '' : 's'}{r.fixed_snags ? `, ${r.fixed_snags} fixed to verify` : ''}</>}</div>
      </div>))}</div>);
}

async function Reports({ project, rows }: { project: string; rows: Rows }) {
  const t = await translator();
  const list = await listReports({ project: project || undefined });
  return (
    <>
      <Filter tab="reports" project={project} rows={rows} />
      {list.length === 0 ? <div className="empty card">{t("No site report yet. Open My sites and tap Today's report.")}</div> : (
        <div className="tw"><table>
          <thead><tr><th>{t('Report')}</th><th>{t('Day')}</th><th>{t('Project')}</th><th className="num">{t('Manpower')}</th><th className="hide-sm">{t('Work done')}</th><th className="num hide-sm">{t('Photos')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>{list.map(r => <tr key={r.id}><td><Link href={`/site/reports/${r.id}`} className="mono">{r.no}</Link></td><td className="mono">{r.day}</td><td>{r.code}</td><td className="num mono">{r.headcount}</td>
            <td className="hide-sm" dir="auto" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.work_done}</td><td className="num hide-sm">{r.photos}</td>
            <td><span className={'pill ' + pillOf(r.status)}>{t(label(REPORT_STATUSES, r.status))}</span></td></tr>)}</tbody>
        </table></div>)}
    </>);
}

async function Inspections({ project, rows }: { project: string; rows: Rows }) {
  const t = await translator();
  const list = await listInspections({ project: project || undefined });
  return (
    <>
      <Filter tab="inspections" project={project} rows={rows} />
      {list.length === 0 ? <div className="empty card">{t('No inspection requested yet.')}</div> : (
        <div className="tw"><table>
          <thead><tr><th>{t('Request')}</th><th>{t('Project')}</th><th>{t('What')}</th><th className="hide-sm">{t('Where')}</th><th>{t('For')}</th><th className="hide-sm">{t('Inspector')}</th><th>{t('Result')}</th></tr></thead>
          <tbody>{list.map(i => <tr key={i.id}><td><Link href={`/site/inspections/${i.id}`} className="mono">{i.no}</Link></td><td>{i.code}</td><td dir="auto">{i.title}{i.activity ? <span className="muted"> · {i.activity}</span> : ''}</td><td className="hide-sm" dir="auto">{i.location}</td><td className="mono">{i.requested_for}</td><td className="hide-sm">{i.inspector}</td>
            <td><span className={'pill ' + pillOf(i.status)}>{t(label(INSPECTION_STATUSES, i.status))}</span>{i.snag_no ? <span className="muted"> · S-{i.snag_no}</span> : ''}</td></tr>)}</tbody>
        </table></div>)}
    </>);
}

async function Snags({ project, rows }: { project: string; rows: Rows }) {
  const t = await translator();
  const list = await listSnags({ project: project || undefined, open: true });
  const p = rows.find(r => r.id === project);
  return (
    <>
      <Filter tab="snags" project={project} rows={rows} />
      {p && <p><Link className="btn" href={`/site/snags?project=${p.id}`}>{t('Open the snag list of {code}', { code: p.code })}</Link></p>}
      {list.length === 0 ? <div className="empty card">{t('No open snag.')}</div> : (
        <div className="tw"><table>
          <thead><tr><th>{t('Project')}</th><th>#</th><th>{t('Snag')}</th><th className="hide-sm">{t('Trade')}</th><th className="hide-sm">{t('Assigned to')}</th><th>{t('Due')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>{list.map(s => <tr key={s.id}><td><Link href={`/site/snags?project=${s.project_id}`}>{s.code}</Link></td><td className="mono">S-{s.snag_no}</td><td dir="auto">{s.area ? <b>{s.area} · </b> : ''}{s.description}</td><td className="hide-sm" dir="auto">{s.trade}</td><td className="hide-sm">{s.vendor ?? s.assignee ?? ''}</td>
            <td className="mono">{s.due ?? ''}</td><td><span className={'pill ' + pillOf(s.status)}>{t(label(SNAG_STATUSES, s.status))}</span></td></tr>)}</tbody>
        </table></div>)}
    </>);
}

async function Summary({ month }: { month: string }) {
  const t = await translator();
  const list = await siteSummary(month);
  return (
    <>
      <form className="card row" style={{ alignItems: 'end' }}>
        <input type="hidden" name="tab" value="summary" />
        <label className="f"><span>{t('Month')}</span><input className="inp" type="month" name="month" defaultValue={month} /></label>
        <button className="btn">{t('Show')}</button>
      </form>
      {list.length === 0 ? <div className="empty card">{t('Nothing on site yet.')}</div> : (
        <div className="tw"><table>
          <thead><tr><th>{t('Project')}</th><th className="num">{t('Reports')}</th><th className="num">{t('Man-days')}</th><th className="num hide-sm">{t('Hours')}</th><th className="num">{t('Inspections')}</th><th className="num hide-sm">{t('Passed · failed')}</th><th className="num">{t('Snags open')}</th><th className="num hide-sm">{t('Verified')}</th><th>{t('Handover')}</th></tr></thead>
          <tbody>{list.map(r => <tr key={r.id}><td><Link href={`/site?tab=reports&project=${r.id}`}>{r.code}</Link></td><td className="num mono">{r.reports}</td><td className="num mono">{r.man_days}</td><td className="num mono hide-sm">{r.hours}</td><td className="num mono">{r.inspections}</td><td className="num mono hide-sm">{r.passed} · {r.failed}</td>
            <td className="num mono">{r.open_snags ? <span className="pill rejected">{r.open_snags}</span> : 0}</td><td className="num mono hide-sm">{r.verified_snags}</td><td>{r.handover ? <span className={'pill ' + (r.handover === 'signed' ? 'posted' : 'pending')}>{t(r.handover)}</span> : ''}</td></tr>)}</tbody>
        </table></div>)}
      <p className="muted" style={{ fontSize: 13 }}>{t("Reports, man-days and hours are the month's sent reports; inspections and snags are the totals to date.")}</p>
    </>);
}
