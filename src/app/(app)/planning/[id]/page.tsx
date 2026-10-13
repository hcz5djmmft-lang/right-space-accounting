import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { phaseLabel } from '@/lib/projects';
import { CATEGORIES, addDays, bar, daysBetween, duration, expectedEnd, isBehind, overdueDays, plannedPct, summarize, weekLabel, weeks } from '@/lib/planning-calc';
import { canPlan, getSchedule, listActivities, onSiteTeam, progressHistory } from '@/lib/planning';
import { addActivityAction, recordProgressAction, removeActivityAction, saveActivitiesAction, setBaselineAction } from '../actions';

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const [p] = await sql<{ id: string; code: string; name: string; phase: string | null; is_office: boolean }[]>`select id, code, name, phase, is_office from projects where id = ${id}`;
  if (!p || p.is_office) notFound();
  const [schedule, acts, history, log] = await Promise.all([getSchedule(id), listActivities(id), progressHistory(id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'schedule' and g.entity_id = ${id} order by g.at desc limit 20`]);
  if (!schedule) notFound();
  const now = today();
  const edit = canPlan(user);
  const site = edit || await onSiteTeam(id, user.id);
  const s = summarize(acts, now);
  const cols = weeks(acts, now);
  const first = cols[0], span = daysBetween(first, addDays(cols[cols.length - 1], 6));
  const todayPos = bar(now, now, first, span);
  return (
    <>
      <div className="head"><div><h1><Link href={`/cost-centers/${id}`}>{p.code}</Link> · Schedule</h1>
        <p dir="auto">{p.name !== p.code ? `${p.name} · ` : ''}{phaseLabel(p.phase ?? '')}{schedule.baselined_at ? ` · baseline set ${schedule.baselined_at}${schedule.baselined_by ? ` by ${schedule.baselined_by}` : ''}` : ' · no baseline yet'}</p></div>
        <Link className="btn" href="/planning">All schedules</Link></div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Planned by today</div><div className="v mono">{s.dated ? `${s.planned_pct} %` : '—'}</div></div>
        <div className="tile"><div className="k">Done</div><div className="v mono">{s.dated ? `${s.actual_pct} %` : '—'}</div></div>
        <div className="tile"><div className="k">Behind the plan</div><div className="v mono">{s.behind ? <span className="pill rejected">{s.behind}</span> : s.dated ? 0 : '—'}</div></div>
        <div className="tile"><div className="k">Expected finish{s.base_end ? ` · baseline ${s.base_end}` : ''}</div><div className="v mono">{s.expected_end ?? '—'}{s.slip_days > 0 ? <span className="pill rejected" style={{ marginLeft: 6 }}>+{s.slip_days} d</span> : ''}</div></div>
      </div>

      <form action={saveActivitiesAction.bind(null, id)} className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Work categories and dates</h2>{edit && <button className="btn pri">Save schedule</button>}</div>
        <p className="muted" style={{ fontSize: 13 }}>One row per work category (the Master BOQ&apos;s sections to start with); add rows for anything else. Dates are calendar days, both ends counted.</p>
        <div className="tw"><table>
          <thead><tr><th>#</th><th>Activity</th><th>Start</th><th>End</th><th className="num">Days</th><th className="hide-sm">Baseline</th><th className="num">Done</th>{edit && <th></th>}</tr></thead>
          <tbody>{acts.map((a, i) => (
            <tr key={a.id}><td className="mono">{i + 1}</td>
              <td dir="auto" style={{ minWidth: 200 }}>{edit ? <><input type="hidden" name="id" value={a.id} /><input className="inp" name={`name_${a.id}`} defaultValue={a.name} dir="auto" style={{ width: '100%', minWidth: 200 }} /></> : a.name}
                {edit ? <input className="inp" name={`note_${a.id}`} defaultValue={a.note} placeholder="Note" dir="auto" style={{ width: '100%', marginTop: 4, fontSize: 12 }} /> : a.note && <div className="muted" style={{ fontSize: 12 }}>{a.note}</div>}</td>
              <td>{edit ? <input className="inp mono" type="date" name={`start_${a.id}`} defaultValue={a.start_date ?? ''} /> : <span className="mono">{a.start_date ?? ''}</span>}</td>
              <td>{edit ? <input className="inp mono" type="date" name={`end_${a.id}`} defaultValue={a.end_date ?? ''} /> : <span className="mono">{a.end_date ?? ''}</span>}</td>
              <td className="num mono">{duration(a) || ''}</td>
              <td className="hide-sm mono" style={{ fontSize: 12 }}>{a.base_start ? `${a.base_start} → ${a.base_end}` : ''}</td>
              <td className="num mono">{a.progress} %</td>
              {edit && <td>{Number(a.progress) === 0 && <button formAction={removeActivityAction.bind(null, id, a.id)} className="lnk bad" style={{ fontSize: 12 }}>remove</button>}</td>}
            </tr>))}</tbody></table></div>
        {edit && <label className="f" style={{ marginTop: 10 }}><span>Schedule note</span><input className="inp" name="note" defaultValue={schedule.note} dir="auto" /></label>}
      </form>
      {edit && (
        <div className="card grid g2">
          <form action={addActivityAction.bind(null, id)} className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="f" style={{ flex: 1, minWidth: 160 }}><span>New activity</span><input className="inp" name="name" dir="auto" placeholder="Marble works" required /></label>
            <label className="f"><span>Category</span><select className="inp" name="category" defaultValue="other"><option value="other">Other</option>{CATEGORIES.map(c => <option key={c.no} value={c.no}>{c.no}. {c.title}</option>)}</select></label>
            <label className="f"><span>Start</span><input className="inp mono" type="date" name="start" /></label>
            <label className="f"><span>End</span><input className="inp mono" type="date" name="end" /></label>
            <button className="btn">Add activity</button>
          </form>
          <form action={setBaselineAction.bind(null, id)} className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="f" style={{ flex: 1, minWidth: 160 }}><span>{schedule.baselined_at ? 'Set the baseline again (replaces it)' : 'Baseline: freezes the dates, moves the project to Execution and dates the material plan'}</span><input className="inp" name="note" dir="auto" placeholder="Note (optional)" /></label>
            <button className="btn pri">{schedule.baselined_at ? 'Set the baseline again' : 'Set the baseline'}</button>
          </form>
        </div>)}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Gantt</h2>
        {s.dated === 0 ? <p className="muted">Date the activities to see the chart.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 160 + cols.length * 56 }}>
              <div style={{ display: 'flex', fontSize: 11, color: 'var(--muted)' }}><div style={{ width: 160, flex: 'none' }}></div>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>{cols.map(w => <div key={w} className="mono" style={{ borderLeft: '1px solid var(--line)', paddingLeft: 3 }}>{weekLabel(w)}</div>)}</div></div>
              {acts.map(a => { const b = bar(a.start_date, a.end_date, first, span), bb = bar(a.base_start, a.base_end, first, span); return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', minHeight: 30, borderTop: '1px solid var(--line)' }}>
                  <div dir="auto" style={{ width: 160, flex: 'none', fontSize: 12, paddingRight: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</div>
                  <div style={{ flex: 1, position: 'relative', height: 26 }}>
                    {todayPos && <div style={{ position: 'absolute', left: `${todayPos.left}%`, top: 0, bottom: 0, borderLeft: '2px dashed var(--bad)', opacity: 0.6 }} />}
                    {bb && <div style={{ position: 'absolute', left: `${bb.left}%`, width: `${bb.width}%`, top: 18, height: 5, background: 'var(--line)', borderRadius: 3 }} title={`baseline ${a.base_start} → ${a.base_end}`} />}
                    {b && <div style={{ position: 'absolute', left: `${b.left}%`, width: `${b.width}%`, top: 3, height: 14, background: isBehind(a, now) ? 'var(--bad)' : 'var(--accent, #c9a24a)', opacity: 0.35, borderRadius: 4 }} title={`${a.start_date} → ${a.end_date}`} />}
                    {b && <div style={{ position: 'absolute', left: `${b.left}%`, width: `${(b.width * Number(a.progress)) / 100}%`, top: 3, height: 14, background: isBehind(a, now) ? 'var(--bad)' : 'var(--accent, #c9a24a)', borderRadius: 4 }} title={`${a.progress} % done`} />}
                  </div>
                </div>); })}
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Light bar = planned, full bar = done, thin grey bar = baseline, dashed line = today; red = behind the plan.</p>
          </div>)}
      </div>

      <div className="card" id="progress">
        <h2 style={{ marginTop: 0 }}>This week&apos;s progress</h2>
        {!site ? <p className="muted">The site engineer, the project manager or the engineers record progress here.</p> : s.dated === 0 ? <p className="muted">Date the activities first.</p> : (
          <form action={recordProgressAction.bind(null, id)}>
            <div className="row" style={{ marginBottom: 8 }}><label className="f"><span>Week of</span><input className="inp mono" type="date" name="week" defaultValue={now} required /></label></div>
            <div className="tw"><table>
              <thead><tr><th>Activity</th><th className="num hide-sm">Planned by today</th><th className="num">Done %</th><th>Note</th><th className="hide-sm">Expected end</th></tr></thead>
              <tbody>{acts.filter(a => a.start_date && a.end_date).map(a => (
                <tr key={a.id}><td dir="auto">{a.name}{isBehind(a, now) && <span className="pill rejected" style={{ marginLeft: 6 }}>{overdueDays(a, now) ? `${overdueDays(a, now)} d late` : 'behind'}</span>}</td>
                  <td className="num mono hide-sm">{plannedPct(a, now)} %</td>
                  <td className="num"><input type="hidden" name="id" value={a.id} /><input className="inp mono" type="number" name={`pct_${a.id}`} min="0" max="100" step="1" defaultValue={Number(a.progress)} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td><input className="inp" name={`pnote_${a.id}`} dir="auto" placeholder="What was done" style={{ minWidth: 140 }} /></td>
                  <td className="hide-sm mono">{expectedEnd(a, now)}</td></tr>))}</tbody></table></div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Record progress</button></div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>An activity past its end date, or ten points under the plan, raises a task for the site engineer (or the project manager).</p>
          </form>)}
      </div>

      <div className="card log"><h2 style={{ marginTop: 0 }}>History</h2>
        {history.map((h, i) => <div key={'p' + i}>{h.week} · {h.who ?? ''} · {h.name}: {h.pct} %{h.note ? ` — ${h.note}` : ''}</div>)}
        {log.map((g, i) => <div key={'l' + i}>{g.at} · {g.who ?? ''} · {g.action}{g.note ? ` — ${g.note}` : ''}</div>)}</div>
    </>
  );
}
