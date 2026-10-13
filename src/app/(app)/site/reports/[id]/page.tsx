import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { canPlan } from '@/lib/planning';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';
import { REPORT_STATUSES, canSite, getReport, label, listManpower, listWork } from '@/lib/site';
import { deleteReportAction, reviewReportAction, submitReportAction } from '../../actions';
import { pillOf } from '../../ui';

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { ok, error } = await searchParams;
  const r = await getReport(id);
  if (!r) notFound();
  const [man, work, files, log] = await Promise.all([listManpower(id), listWork(id), listAttachments('site-report', id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'site-report' and g.entity_id = ${id} order by g.at desc limit 20`]);
  const site = await canSite(user, r.project_id), eng = canPlan(user);
  const chain = [
    { key: 'draft', name: 'Draft', note: `${r.created_by_name ?? ''} · ${r.created_at}` },
    { key: 'submitted', name: 'Sent', note: r.submitted_at ? `${r.submitted_by_name ?? ''} · ${r.submitted_at}` : 'the site engineer sends it' },
    { key: 'reviewed', name: 'Reviewed', note: r.reviewed_at ? `${r.reviewed_by_name ?? ''} · ${r.reviewed_at}${r.review_note ? ` — ${r.review_note}` : ''}` : 'by the engineers' },
  ].map(s => ({ ...s, cur: s.key === r.status }));
  const hours = man.reduce((a, m) => a + m.headcount * m.hours, 0);
  return (
    <>
      <div className="head"><div><h1>{r.no} · {r.code} · {r.day}</h1><p dir="auto">Daily site report{r.project_name !== r.code ? ` · ${r.project_name}` : ''} · <span className={'pill ' + pillOf(r.status)}>{label(REPORT_STATUSES, r.status)}</span></p></div>
        <div className="row"><Link className="btn" href={`/print/site-report/${id}`} target="_blank">Print</Link><Link className="btn" href={`/site?tab=reports&project=${r.project_id}`}>All reports</Link><Link className="btn" href="/site">Site execution</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="steps">{chain.map(s => <div key={s.key} className={s.cur ? 'cur' : ''}><b>{s.name}</b><div className="muted" style={{ fontSize: 13 }}>{s.note}</div></div>)}</div>
      <div className="tiles">
        <div className="tile"><div className="k">Manpower</div><div className="v mono">{r.headcount}</div><div className="muted" style={{ fontSize: 12 }}>{hours} hours</div></div>
        <div className="tile"><div className="k">Weather</div><div className="v">{r.weather || '—'}</div></div>
        <div className="tile"><div className="k">Photos</div><div className="v mono">{files.length}</div></div>
        <div className="tile"><div className="k">Visitors</div><div className="v" style={{ fontSize: 15 }} dir="auto">{r.visitors || '—'}</div></div>
      </div>
      <div className="grid g2">
        <div className="card"><h2 style={{ marginTop: 0 }}>Work done today</h2><div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{r.work_done || <span className="muted">Nothing written yet.</span>}</div>
          {work.length > 0 && <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>{work.map(w => <li key={w.activity_id} dir="auto">{w.name}</li>)}</ul>}</div>
        <div className="card"><h2 style={{ marginTop: 0 }}>Manpower on site</h2>
          {man.length === 0 ? <span className="muted">No manpower recorded.</span> : <div className="tw"><table><thead><tr><th>Trade</th><th className="num">People</th><th className="num">Hours each</th></tr></thead>
            <tbody>{man.map(m => <tr key={m.id}><td dir="auto">{m.trade}</td><td className="num mono">{m.headcount}</td><td className="num mono">{m.hours}</td></tr>)}<tr><td><b>Total</b></td><td className="num mono"><b>{r.headcount}</b></td><td className="num mono">{hours} h</td></tr></tbody></table></div>}
          {(r.materials || r.issues) && <div style={{ marginTop: 10 }}>{r.materials && <p style={{ margin: '0 0 6px' }}><b>Materials received:</b> <span dir="auto">{r.materials}</span></p>}{r.issues && <p style={{ margin: 0 }}><b>Issues, delays, safety:</b> <span dir="auto">{r.issues}</span></p>}</div>}</div>
      </div>
      {(site || eng) && r.status !== 'reviewed' && (
        <div className="card row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" href={`/site/reports/new?edit=${id}`}>Edit</Link>
          {r.status === 'draft' && <form action={submitReportAction.bind(null, id)}><button className="btn pri">Send the report</button></form>}
          {r.status === 'draft' && <form action={deleteReportAction.bind(null, id)}><button className="btn bad">Delete draft</button></form>}
          {r.status === 'submitted' && eng && <form action={reviewReportAction.bind(null, id)} className="row" style={{ gap: 6, flex: 1, justifyContent: 'flex-end' }}><input className="inp" name="note" placeholder="Note for the site (optional)" dir="auto" style={{ flex: 1, minWidth: 180 }} /><button className="btn pri">Mark reviewed</button></form>}
        </div>)}
      <Attachments entity="site-report" id={id} path={`/site/reports/${id}`} items={files} userId={user.id} canRemove={eng} locked={r.status === 'reviewed'} />
      <div className="card"><h2 style={{ marginTop: 0 }}>History</h2><div className="log">{log.map((h, i) => <div key={i}>{h.at} · {h.who ?? ''} · {h.action}{h.note ? ` — ${h.note}` : ''}</div>)}</div></div>
    </>
  );
}
