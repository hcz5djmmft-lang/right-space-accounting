import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { LINKS } from '@/lib/tasks';
import { TaskForm } from '@/components/TaskForm';
import { saveTaskAction } from '../actions';

export default async function NewTask({ searchParams }: { searchParams: Promise<{ error?: string; link_type?: string; link_id?: string; link_label?: string }> }) {
  const user = await requireUser();
  const { error, link_type, link_id, link_label } = await searchParams;
  const people = await sql<{ id: string; name: string }[]>`select id, name from users where active order by name`;
  const link = link_type && link_id && LINKS[link_type] ? { type: link_type, id: link_id, label: link_label ?? '' } : null;
  return (
    <>
      <div className="head"><div><h1>New task</h1></div></div>
      {error && <div className="msg bad">{error}</div>}
      <TaskForm people={people} action={saveTaskAction} me={user.id} link={link} />
    </>
  );
}
