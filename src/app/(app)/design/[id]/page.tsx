import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import type { Attachment } from '@/lib/attachments';
import { EDITABLE, STEPS, isStep } from '@/lib/design-calc';
import { canChat, canDesign, canSign, getSet, listDrawings, listMessages, signersFor } from '@/lib/design';
import { DocFiles } from '@/components/DocFiles';
import { addDrawingAction, clientDecisionAction, decideSetAction, ifcAction, newRevisionAction, postMessageAction, removeDrawingAction, reopenSetAction, sendToClientAction, submitSetAction } from '../actions';

export default async function SetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved, error } = await searchParams;
  const set = await getSet(id);
  if (!set) notFound();
  const [drawings, messages, signer, chatter, log] = await Promise.all([
    listDrawings(id, true), listMessages(id), canSign(user, set), canChat(user, set),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'drawing_set' and g.entity_id = ${id} order by g.at desc limit 40`,
  ]);
  const ids = drawings.map(w => w.id);
  const files = ids.length ? await sql<(Attachment & { entity_id: string })[]>`
    select a.id, a.entity_id, a.file_name, a.mime_type, a.size_bytes::int size_bytes, a.uploaded_by, u.name who, a.tag, to_char(a.uploaded_at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at
    from attachments a left join users u on u.id = a.uploaded_by where a.entity = 'drawing' and a.entity_id = any(${ids}) order by a.uploaded_at` : [];
  const designer = canDesign(user);
  const editable = designer && EDITABLE.includes(set.status);
  const canIfc = hasRole(user, 'management') || (await signersFor('to_head')).includes(user.id) || (await signersFor('director')).includes(user.id);
  const path = `/design/${id}`;
  const stepIdx = STEPS.findIndex(s => s.status === set.status);
  const sign = (k: string) => ({ design_head: [set.design_head_signer, set.design_head_at], to_head: [set.to_head_signer, set.to_head_at], director: [set.director_signer, set.director_at] } as Record<string, (string | null)[]>)[k];
  const pillClass = ['approved', 'client_approved', 'ifc'].includes(set.status) ? 'posted' : set.status === 'rejected' ? 'rejected' : set.status === 'draft' ? '' : 'pending';
  return (
    <>
      <div className="head"><div><h1><Link href={`/cost-centers/${set.project_id}`}>{set.project_code}</Link> · {set.kind_label} <span className="muted">v{set.version}</span></h1>
        <p dir="auto">{set.project_name} · <span className={'pill ' + pillClass}>{set.status_label}</span>{set.designer ? ` · designer ${set.designer}` : ''}</p></div>
        <div className="row"><Link className="btn" href="/design">All design</Link><Link className="btn" href={`/design?tab=register&project=${set.project_id}`}>Register</Link></div></div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="steps">
        <div className={EDITABLE.includes(set.status) ? 'cur' : ''}><b>Designer</b><div className="muted" style={{ fontSize: 12 }}>{set.submitted_at ? `submitted ${set.submitted_at}` : set.status === 'rejected' ? 'revising' : 'preparing'}</div></div>
        {STEPS.map((st, i) => { const [by, at] = sign(st.status); return (
          <div key={st.status} className={set.status === st.status ? 'cur' : ''}><b>{st.label}</b><div className="muted" style={{ fontSize: 12 }}>{by && at ? `${set.status === 'rejected' && i === stepIdx ? 'sent back' : 'signed'} by ${by} · ${at}` : set.status === st.status ? 'waiting' : 'next'}</div></div>); })}
        {set.kind === 'shop'
          ? <div className={set.status === 'ifc' ? 'cur' : ''}><b>Issued for construction</b><div className="muted" style={{ fontSize: 12 }}>{set.ifc_at ? `${set.ifc_by_name} · ${set.ifc_at}` : 'after approval'}</div></div>
          : <div className={['client', 'client_approved'].includes(set.status) ? 'cur' : ''}><b>Client</b><div className="muted" style={{ fontSize: 12 }}>{set.status === 'client_approved' ? `approved · ${set.client_at}` : set.status === 'client' ? `sent ${set.client_sent_at}` : 'after approval'}</div></div>}
      </div>
      {set.decision_note && ['rejected', 'draft'].includes(set.status) && <div className="msg bad">Sent back: {set.decision_note}</div>}
      {set.client_note && <div className="msg" style={{ background: 'var(--panel)' }}>Client: {set.client_note}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Drawings</h2>
          {editable && <form action={submitSetAction.bind(null, id)}><button className="btn pri">Submit for approval</button></form>}
          {isStep(set.status) && signer && (
            <form className="row"><input className="inp" name="note" dir="auto" placeholder="Note (needed when sending back)" style={{ minWidth: 200 }} />
              <button className="btn pri" formAction={decideSetAction.bind(null, id, true)}>Approve</button>
              <button className="btn bad" formAction={decideSetAction.bind(null, id, false)}>Send back</button></form>)}
          {set.status === 'approved' && set.kind !== 'shop' && designer && <form action={sendToClientAction.bind(null, id)}><button className="btn pri">Send to the client</button></form>}
          {set.status === 'approved' && set.kind === 'shop' && canIfc && <form action={ifcAction.bind(null, id)}><button className="btn pri">Issue for construction</button></form>}
          {set.status === 'client' && designer && (
            <form className="row"><input className="inp" name="note" dir="auto" placeholder="The client's comments" style={{ minWidth: 200 }} />
              <button className="btn pri" formAction={clientDecisionAction.bind(null, id, true)}>Client approved</button>
              <button className="btn" formAction={clientDecisionAction.bind(null, id, false)}>Client asked for changes</button></form>)}
        </div>
        <div className="tw" style={{ marginTop: 10 }}><table>
          <thead><tr><th>No.</th><th>Title</th><th className="num">Rev</th><th>Files</th>{set.status === 'ifc' && <th className="hide-sm">Issued</th>}{editable && <th></th>}</tr></thead>
          <tbody>{drawings.length === 0 && <tr><td colSpan={6} className="muted">No drawings on this set yet.</td></tr>}
            {drawings.map(w => (
              <tr key={w.id} style={w.superseded ? { opacity: 0.5 } : undefined}>
                <td className="mono">{w.no}</td><td dir="auto">{w.title}{w.note && <div className="muted" style={{ fontSize: 12 }}>{w.note}</div>}</td><td className="num">{w.rev}{w.superseded ? <span className="muted"> (superseded)</span> : ''}</td>
                <td>{editable && !w.superseded ? <DocFiles entity="drawing" id={w.id} path={path} tag="" items={files.filter(f => f.entity_id === w.id)} canRemove /> :
                  <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>{files.filter(f => f.entity_id === w.id).map(f => <a key={f.id} href={`/files/${f.id}`} target="_blank" rel="noopener">{f.mime_type === 'application/pdf' ? '📄' : '🖼'} {f.file_name}</a>)}</div>}</td>
                {set.status === 'ifc' && <td className="hide-sm mono">{w.issued_on ?? ''}</td>}
                {editable && <td>{!w.superseded && <span className="row" style={{ gap: 6 }}>
                  <form action={newRevisionAction.bind(null, id, w.id)}><button className="lnk" style={{ fontSize: 12 }}>new revision</button></form>
                  {w.files === 0 && <form action={removeDrawingAction.bind(null, id, w.id)}><button className="lnk bad" style={{ fontSize: 12 }}>remove</button></form>}</span>}</td>}
              </tr>))}
          </tbody></table></div>
        {editable && (
          <form action={addDrawingAction.bind(null, id)} className="row" style={{ marginTop: 10 }}>
            <input className="inp mono" name="no" placeholder="No." style={{ width: 90 }} required />
            <input className="inp" name="title" dir="auto" placeholder="Drawing title" style={{ flex: 1, minWidth: 160 }} required />
            <button className="btn">Add drawing</button>
          </form>)}
        {designer && !EDITABLE.includes(set.status) && set.status !== 'ifc' && (
          <form action={reopenSetAction.bind(null, id)} className="row" style={{ marginTop: 10 }}>
            <input className="inp" name="note" dir="auto" placeholder="Why it is being revised" style={{ flex: 1, minWidth: 160 }} />
            <button className="btn">Reopen for revision (v{set.version + 1})</button></form>)}
      </div>

      <div className="card" id="chat">
        <h2 style={{ marginTop: 0 }}>Chat</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>The designer, the head of design, the technical office head and the director of engineering talk here; every step is noted too.</p>
        {messages.length === 0 && <p className="muted">Nothing said yet.</p>}
        {messages.map(m => <div key={m.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><div className="muted" style={{ fontSize: 12 }}>{m.who ?? '—'} · {m.at}</div><div dir="auto">{m.text}</div></div>)}
        {chatter && <form action={postMessageAction.bind(null, id)} className="row" style={{ marginTop: 10 }}>
          <input className="inp" name="text" dir="auto" placeholder="Write to the group" style={{ flex: 1 }} required /><button className="btn">Send</button></form>}
      </div>
      <div className="card log"><h2 style={{ marginTop: 0 }}>History</h2>{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? ''} · {g.action}{g.note ? ` — ${g.note}` : ''}</div>)}</div>
    </>
  );
}
