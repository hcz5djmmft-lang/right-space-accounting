import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { canPlan } from '@/lib/planning';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';
import { INSPECTION_STATUSES, canSite, getInspection, label } from '@/lib/site';
import { cancelInspectionAction, decideInspectionAction } from '../../actions';
import { pillOf } from '../../ui';

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { ok, error } = await searchParams;
  const i = await getInspection(id);
  if (!i) notFound();
  const [files, log] = await Promise.all([listAttachments('inspection', id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'inspection' and g.entity_id = ${id} order by g.at desc limit 20`]);
  const site = await canSite(user, i.project_id), eng = canPlan(user);
  const decide = i.status === 'open' && (i.inspector_id === user.id || eng);
  return (
    <>
      <div className="head"><div><h1>{i.no} · {i.code}</h1><p dir="auto">Inspection request{i.project_name !== i.code ? ` · ${i.project_name}` : ''} · <span className={'pill ' + pillOf(i.status)}>{label(INSPECTION_STATUSES, i.status)}</span></p></div>
        <div className="row">{i.task_id && <Link className="btn" href={`/tasks/${i.task_id}`}>Task</Link>}<Link className="btn" href={`/site?tab=inspections&project=${i.project_id}`}>All inspections</Link><Link className="btn" href="/site">Site execution</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">What</div><div className="v" style={{ fontSize: 16 }} dir="auto">{i.title}</div>{i.activity && <div className="muted" style={{ fontSize: 12 }}>{i.activity}</div>}</div>
        <div className="tile"><div className="k">Where</div><div className="v" style={{ fontSize: 16 }} dir="auto">{i.location || '—'}</div></div>
        <div className="tile"><div className="k">Inspection day</div><div className="v mono">{i.requested_for}</div><div className="muted" style={{ fontSize: 12 }}>asked by {i.requested_by_name ?? '—'} · {i.created_at}</div></div>
        <div className="tile"><div className="k">Inspector</div><div className="v" style={{ fontSize: 16 }}>{i.inspector ?? '—'}</div></div>
      </div>
      {i.status !== 'open' && (
        <div className="card"><h2 style={{ marginTop: 0 }}>Result</h2>
          <p style={{ margin: 0 }}><span className={'pill ' + pillOf(i.status)}>{label(INSPECTION_STATUSES, i.status)}</span>{i.inspected_at ? ` · ${i.inspected_by_name ?? ''} · ${i.inspected_at}` : ''}</p>
          {i.result_note && <p dir="auto" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{i.result_note}</p>}
          {i.snag_no && <p style={{ margin: '8px 0 0' }}>On the snag list as <Link href={`/site/snags?project=${i.project_id}`}>S-{i.snag_no}</Link> for the site engineer to fix; ask for a new inspection once it is done.</p>}
        </div>)}
      {decide && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Record the result</h2>
          <div className="grid g2">
            <form action={decideInspectionAction.bind(null, id, true)} className="f"><span>Passed</span><input className="inp" name="note" dir="auto" placeholder="Remarks (optional)" /><button className="btn pri" style={{ marginTop: 6 }}>Passed</button></form>
            <form action={decideInspectionAction.bind(null, id, false)} className="f"><span>Failed: what must be fixed (goes on the snag list)</span><input className="inp" name="note" dir="auto" placeholder="Slope wrong on the floor drain line" required /><button className="btn bad" style={{ marginTop: 6 }}>Failed</button></form>
          </div>
        </div>)}
      {i.status === 'open' && site && <form action={cancelInspectionAction.bind(null, id)} className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}><button className="btn">Cancel the request</button></form>}
      <Attachments entity="inspection" id={id} path={`/site/inspections/${id}`} items={files} userId={user.id} canRemove={eng} locked={false} />
      <div className="card"><h2 style={{ marginTop: 0 }}>History</h2><div className="log">{log.map((h, k) => <div key={k}>{h.at} · {h.who ?? ''} · {h.action}{h.note ? ` — ${h.note}` : ''}</div>)}</div></div>
    </>
  );
}
