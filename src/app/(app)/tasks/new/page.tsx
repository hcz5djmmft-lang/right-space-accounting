import { requireUser } from '@/lib/auth';
import { listAssignees } from '@/lib/hr';
import { listProjects } from '@/lib/queries';
import { isHead, LINKS } from '@/lib/tasks';
import { TaskForm } from '@/components/TaskForm';
import { saveTaskAction } from '../actions';

export default async function NewTask({ searchParams }: { searchParams: Promise<{ error?: string; link_type?: string; link_id?: string; link_label?: string; project?: string }> }) {
  const user = await requireUser();
  const { error, link_type, link_id, link_label, project } = await searchParams;
  const [all, projects, head] = await Promise.all([listAssignees(), listProjects(), isHead(user)]);
  // only a head gives tasks to others (update 20); anyone may add one for themselves
  const people = head ? all : all.filter(p => p.user_id === user.id);
  const link = link_type && link_id && LINKS[link_type] ? { type: link_type, id: link_id, label: link_label ?? '' } : null;
  // a task raised from a project's page belongs to that project
  const proj = project ?? (link && ['cost-center', 'planning', 'handover', 'snags'].includes(link.type) ? link.id : null);
  return (
    <>
      <div className="head"><div><h1>New task</h1></div></div>
      {error && <div className="msg bad">{error}</div>}
      <TaskForm people={people} projects={projects} action={saveTaskAction} me={user.id} link={link} project={proj} />
    </>
  );
}
