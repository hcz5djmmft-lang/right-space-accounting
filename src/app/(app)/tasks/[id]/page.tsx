import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listAssignees } from '@/lib/hr';
import { listProjects } from '@/lib/queries';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { canReview, getTask, listComments, LINKS, SELF_CLOSING, STATUSES } from '@/lib/tasks';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';
import { TaskForm } from '@/components/TaskForm';
import { commentAction, deleteTaskAction, reviewAction, saveTaskAction, startAction, submitAction } from '../actions';

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const t = await getTask(id);
  if (!t) notFound();
  const [people, projects, comments, files, [me]] = await Promise.all([listAssignees(), listProjects(), listComments(id), listAttachments('task', id),
    sql<{ mine: boolean }[]>`select (${t.assignee_id} = ${user.id} or exists (select 1 from employees e where e.id = ${t.assignee_emp_id} and e.user_id = ${user.id})) mine`]);
  const mine = !!me?.mine;
  const mayDelete = t.created_by === user.id || t.assignee_id === user.id || hasRole(user, 'management');
  // a task whose document closes it (inspection, collection, late delivery) is handed in by finishing that document, not with Submit
  const fromDoc = !!t.link_type && SELF_CLOSING.includes(t.link_type);
  const status = STATUSES.find(s => s[0] === t.status)?.[1];
  return (
    <>
      <div className="head"><div><h1 dir="auto">{t.title}</h1><p>Added by {t.creator ?? '—'} · {t.created_at}{t.project_code ? ` · ${t.project_code}` : ''} · <b>{status}</b>{t.done_at ? ` ${t.done_at}` : ''}</p></div>
        <div className="row"><Link className="btn" href="/tasks">Back to board</Link>{mayDelete && <form action={deleteTaskAction.bind(null, id)}><button className="btn bad">Delete</button></form>}</div></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {t.link_type && t.link_id && LINKS[t.link_type] && <div className="msg good">Linked to <Link href={LINKS[t.link_type] + t.link_id}>{t.link_label || t.link_id}</Link></div>}

      {t.status === 'todo' && mine && (fromDoc
        ? <div className="msg good">This task closes by itself when {t.link_label || 'its document'} is finished{t.project_id ? `; your clock-in on ${t.project_code} shows it In progress` : ''}.</div>
        : t.project_id
        ? <div className="msg good">This task moves to In progress when you clock in on {t.project_code} (Clock in &gt; Clock in for: Site or Design on a project).</div>
        : <form action={startAction.bind(null, id, `/tasks/${id}`)} className="card row" style={{ justifyContent: 'space-between' }}><span>Ready to work on it?</span><button className="btn pri">Start</button></form>)}
      {(t.status === 'doing' || t.status === 'todo') && mine && !fromDoc && (
        <form action={submitAction.bind(null, id)} className="card">
          <h2 style={{ marginTop: 0 }}>Submit for review</h2>
          <label className="f"><span>Note (optional)</span><input className="inp" name="note" dir="auto" placeholder="What was done" /></label>
          <p className="muted" style={{ fontSize: 13 }}>Add a photo under Files below if it helps. The task goes to Review and waits in the Approvals of {t.created_by && t.created_by !== user.id ? t.creator : 'Management'}.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Submit for review</button></div>
        </form>)}
      {t.status === 'review' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>In review</h2>
          <p style={{ margin: '0 0 8px' }}>Submitted {t.submitted_at}{t.submit_note ? <> · <span dir="auto">{t.submit_note}</span></> : ''} · waiting for {t.reviewer ?? 'Management'}</p>
          {canReview(user, t) && (
            <form className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
              <label className="f" style={{ flex: 1, minWidth: 200 }}><span>Note (needed to send back)</span><input className="inp" name="note" dir="auto" /></label>
              <button className="btn" formAction={reviewAction.bind(null, id, false)}>Send back</button>
              <button className="btn pri" formAction={reviewAction.bind(null, id, true)}>Approve</button>
            </form>)}
        </div>)}

      <TaskForm t={t} people={people} projects={projects} action={saveTaskAction} me={user.id} />
      <div className="card"><h2 style={{ marginTop: 0 }}>Files</h2>
        <Attachments entity="task" id={id} path={`/tasks/${id}`} items={files} userId={user.id} canRemove={mayDelete} locked={t.status === 'done'} /></div>
      <div className="card"><h2>Comments</h2>
        {comments.length === 0 && <p className="muted">No comments yet.</p>}
        {comments.map(c => <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><div className="muted" style={{ fontSize: 12 }}>{c.who ?? '—'} · {c.at}</div><div dir="auto">{c.text}</div></div>)}
        <form action={commentAction.bind(null, id)} className="row" style={{ marginTop: 10 }}>
          <input className="inp" name="text" dir="auto" placeholder="Write a comment" style={{ flex: 1 }} required /><button className="btn">Comment</button></form>
      </div>
    </>
  );
}
