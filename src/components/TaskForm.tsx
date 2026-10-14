import { PRIORITIES, STATUSES, type Task } from '@/lib/tasks';

type People = { key: string; name: string; detail: string; user_id: string | null }[];
type Projects = { id: string; code: string; name: string; status: string | null; is_office: boolean }[];
/** Server-rendered task form; the action is a server action. The assignee list is every employee (see hr.listAssignees).
 *  There is no status box: the board moves by itself (clock-in on the project, Start, Submit for review, the review). */
export function TaskForm({ t, people, projects, action, me, link, project }: {
  t?: Partial<Task>; people: People; projects: Projects; action: (f: FormData) => Promise<void>; me: string;
  link?: { type: string; id: string; label: string } | null; project?: string | null;
}) {
  const l = link ?? (t?.link_type && t.link_id ? { type: t.link_type, id: t.link_id, label: t.link_label ?? '' } : null);
  const status = STATUSES.find(s => s[0] === (t?.status ?? 'todo'))?.[1];
  return (
    <form action={action} className="card">
      {t?.id && <input type="hidden" name="id" value={t.id} />}
      {l && <><input type="hidden" name="link_type" value={l.type} /><input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="link_label" value={l.label} /></>}
      <label className="f"><span>Title</span><input className="inp" name="title" dir="auto" defaultValue={t?.title ?? ''} required autoFocus /></label>
      <div className="grid g4" style={{ marginTop: 10 }}>
        <label className="f"><span>Project</span><select className="inp" name="project" defaultValue={t?.project_id ?? project ?? ''}>
          <option value="">No project (office or department work)</option>
          {projects.filter(p => !p.is_office && (p.status !== 'Closed' || p.id === t?.project_id)).map(p => <option key={p.id} value={p.id}>{p.code === p.name ? p.code : `${p.code} · ${p.name}`}</option>)}</select></label>
        <label className="f"><span>Assigned to</span><select className="inp" name="assignee" defaultValue={t?.assignee_key ?? (t?.id ? '' : (people.find(p => p.user_id === me)?.key ?? ''))}>
          <option value="">Unassigned</option>{people.map(p => <option key={p.key} value={p.key}>{p.name}{p.detail ? ` · ${p.detail}` : ''}</option>)}</select></label>
        <label className="f"><span>Priority</span><select className="inp" name="priority" defaultValue={t?.priority ?? 'normal'}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></label>
        <label className="f"><span>Due date</span><input className="inp" type="date" name="due" defaultValue={t?.due ?? ''} /></label>
      </div>
      <label className="f" style={{ marginTop: 10 }}><span>Details</span><textarea className="inp" name="details" dir="auto" rows={4} defaultValue={t?.details ?? ''} /></label>
      {l && <p className="muted" style={{ fontSize: 13 }}>Linked to {l.label || l.id}</p>}
      <p className="muted" style={{ fontSize: 13 }}>{t?.id ? `Now: ${status}. ` : 'A new task starts in To do. '}With a project, it moves to In progress when the person clocks in on that project; with none, when they tap Start. Then Submit for review sends it to you for approval.</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn pri">Save task</button></div>
    </form>
  );
}
