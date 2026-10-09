import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { hasRole } from '@/lib/roles';
import { getTask, listComments, LINKS } from '@/lib/tasks';
import { TaskForm } from '@/components/TaskForm';
import { commentAction, deleteTaskAction, saveTaskAction } from '../actions';

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTask(id);
  if (!t) notFound();
  const [people, comments] = await Promise.all([sql<{ id: string; name: string }[]>`select id, name from users where active order by name`, listComments(id)]);
  const mayDelete = t.created_by === user.id || t.assignee_id === user.id || hasRole(user, 'management');
  return (
    <>
      <div className="head"><div><h1 dir="auto">{t.title}</h1><p>Added by {t.creator ?? '—'} · {t.created_at}{t.done_at ? ` · done ${t.done_at}` : ''}</p></div>
        <div className="row"><Link className="btn" href="/tasks">Back to board</Link>{mayDelete && <form action={deleteTaskAction.bind(null, id)}><button className="btn bad">Delete</button></form>}</div></div>
      {error && <div className="msg bad">{error}</div>}
      {t.link_type && t.link_id && LINKS[t.link_type] && <div className="msg good">Linked to <Link href={LINKS[t.link_type] + t.link_id}>{t.link_label || t.link_id}</Link></div>}
      <TaskForm t={t} people={people} action={saveTaskAction} me={user.id} />
      <div className="card"><h2>Comments</h2>
        {comments.length === 0 && <p className="muted">No comments yet.</p>}
        {comments.map(c => <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><div className="muted" style={{ fontSize: 12 }}>{c.who ?? '—'} · {c.at}</div><div dir="auto">{c.text}</div></div>)}
        <form action={commentAction.bind(null, id)} className="row" style={{ marginTop: 10 }}>
          <input className="inp" name="text" dir="auto" placeholder="Write a comment" style={{ flex: 1 }} required /><button className="btn">Comment</button></form>
      </div>
    </>
  );
}
