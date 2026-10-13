import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { fmtMin } from '@/lib/attendance-calc';
import { KINDS } from '@/lib/design-calc';
import { canDesign, designHoursVsFee, designStatus, listSets, register } from '@/lib/design';
import { phaseLabel } from '@/lib/projects';
import { createSetAction } from './actions';

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string; error?: string; saved?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { tab = 'sets', project, error, saved } = await searchParams;
  const tabs = [['sets', 'In design'], ['register', 'Drawing register'], ['status', 'Design status'], ['hours', 'Hours and cost']] as const;
  return (
    <>
      <div className="head"><div><h1>Design</h1><p>Every project in design: the Main Concept (2D and 3D) and the Shop drawings, each approved by the head of design, the technical office head and the director of engineering, with a chat per set.</p></div></div>
      <div className="tabs">{tabs.map(([k, v]) => <Link key={k} href={`/design?tab=${k}${project ? `&project=${project}` : ''}`} className={tab === k ? 'on' : ''}>{v}</Link>)}</div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      {tab === 'sets' && <Sets canStart={canDesign(user)} />}
      {tab === 'register' && <Register project={project} />}
      {tab === 'status' && <Status />}
      {tab === 'hours' && <Hours />}
    </>
  );
}

async function Sets({ canStart }: { canStart: boolean }) {
  const [sets, projects] = await Promise.all([
    listSets(),
    sql<{ id: string; code: string; name: string; phase: string | null }[]>`select id, code, name, phase from projects where not is_office and (phase = 'design' or exists (select 1 from drawing_sets s where s.project_id = projects.id)) order by code`,
  ]);
  if (projects.length === 0) return <div className="empty card">No project is in design. A project reaches the Design phase once its Project Information form is complete and the interior design is to be prepared.</div>;
  return (
    <>{projects.map(p => {
      const mine = sets.filter(s => s.project_id === p.id);
      return (
        <div key={p.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}><Link href={`/cost-centers/${p.id}`}>{p.code}</Link> <span className="muted" style={{ fontWeight: 400 }} dir="auto">· {p.name}{p.phase ? ` · ${phaseLabel(p.phase)}` : ''}</span></h2>
            <span className="row"><Link className="btn sm" href={`/design?tab=register&project=${p.id}`}>Register</Link><Link className="btn sm" href={`/design/finishes?project=${p.id}`}>Finishes & materials</Link></span>
          </div>
          <div className="tw" style={{ marginTop: 8 }}><table>
            <thead><tr><th>Set</th><th>Status</th><th className="hide-sm">Designer</th><th className="num hide-sm">Drawings · files</th><th></th></tr></thead>
            <tbody>{KINDS.map(([kind, label]) => {
              const open = mine.find(s => s.kind === kind && ['draft', 'design_head', 'to_head', 'director', 'approved', 'client', 'rejected'].includes(s.status));
              const last = open ?? mine.find(s => s.kind === kind);
              return (
                <tr key={kind}><td>{label}{last ? <span className="muted"> v{last.version}</span> : ''}</td>
                  <td>{last ? <span className={'pill ' + (['approved', 'client_approved', 'ifc'].includes(last.status) ? 'posted' : last.status === 'rejected' ? 'rejected' : last.status === 'draft' ? '' : 'pending')}>{last.status_label}</span> : <span className="muted">not started</span>}</td>
                  <td className="hide-sm">{last?.designer ?? ''}</td><td className="num hide-sm">{last ? `${last.drawings} · ${last.files}` : ''}</td>
                  <td>{last ? <Link className="btn sm" href={`/design/${last.id}`}>Open</Link> : null}
                    {!open && canStart && <form action={createSetAction.bind(null, p.id, kind)} style={{ display: 'inline' }}><button className="btn sm" style={{ marginLeft: 6 }}>{last ? 'New set' : 'Start'}</button></form>}</td></tr>);
            })}</tbody></table></div>
        </div>);
    })}</>);
}

async function Register({ project }: { project?: string }) {
  const projects = await sql<{ id: string; code: string }[]>`select id, code from projects where not is_office order by code`;
  const rows = project ? await register(project) : [];
  return (
    <>
      <form className="row" style={{ marginBottom: 12 }}><input type="hidden" name="tab" value="register" />
        <select className="inp" name="project" defaultValue={project ?? ''} style={{ maxWidth: 240 }}><option value="">Choose a project…</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
        <button className="btn">Show</button></form>
      {!project ? null : rows.length === 0 ? <div className="empty card">No drawings on this project yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Title</th><th className="num">Rev</th><th>Set</th><th>Status</th><th className="hide-sm">Issued</th><th className="num">Files</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id} style={r.superseded ? { opacity: 0.55 } : undefined}><td className="mono">{r.no}</td><td dir="auto">{r.title}</td><td className="num">{r.rev}</td>
            <td><Link href={`/design/${r.set_id}`}>{r.kind_label} v{r.version}</Link></td>
            <td>{r.superseded ? <span className="pill">superseded</span> : r.ifc ? <span className="pill posted">IFC</span> : <span className="pill pending">{r.set_status_label}</span>}</td>
            <td className="hide-sm mono">{r.issued_on ?? ''}</td><td className="num">{r.files}</td></tr>)}</tbody></table></div>)}
    </>);
}

async function Status() {
  const rows = await designStatus();
  return rows.length === 0 ? <div className="empty card">No drawing set is moving.</div> : (
    <div className="tw"><table>
      <thead><tr><th>Project</th><th>Set</th><th>Where it stands</th><th className="hide-sm">Waiting for</th><th className="num">Days</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td><Link href={`/cost-centers/${r.project_id}`}>{r.project_code}</Link></td><td><Link href={`/design/${r.id}`}>{r.kind_label} v{r.version}</Link></td>
        <td>{r.step}</td><td className="hide-sm">{r.signers || r.designer || ''}</td><td className="num">{r.waiting_days >= 3 ? <span className="pill rejected">{r.waiting_days}</span> : r.waiting_days}</td></tr>)}</tbody></table></div>);
}

async function Hours() {
  const rows = await designHoursVsFee();
  return rows.length === 0 ? <div className="empty card">No design hours yet. Designers start and stop the design clock on the Clock in page.</div> : (
    <div className="tw"><table>
      <thead><tr><th>Project</th><th className="hide-sm">Phase</th><th className="num">Designers</th><th className="num">Hours</th><th className="num">Cost</th><th className="num">Design fee</th><th className="num">Left of the fee</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.project_id}><td><Link href={`/cost-centers/${r.project_id}`}>{r.code}</Link></td><td className="hide-sm">{phaseLabel(r.phase)}</td><td className="num">{r.people || ''}</td><td className="num">{fmtMin(r.minutes)}</td>
        <td className="num mono">{fmt(r.cost)}</td><td className="num mono">{r.design_fee != null ? fmt(r.design_fee) : <span className="muted">not set</span>}</td>
        <td className="num mono">{r.design_fee != null ? <span className={r.design_fee - r.cost < 0 ? 'pill rejected' : ''}>{fmt(r.design_fee - r.cost)}</span> : ''}</td></tr>)}</tbody></table></div>);
}
