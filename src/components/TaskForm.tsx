import { PRIORITIES, STATUSES, type Task } from '@/lib/tasks';

type People = { id: string; name: string }[];
/** Server-rendered task form; the action is a server action. */
export function TaskForm({ t, people, action, me, link }: {
  t?: Partial<Task>; people: People; action: (f: FormData) => Promise<void>; me: string;
  link?: { type: string; id: string; label: string } | null;
}) {
  const l = link ?? (t?.link_type && t.link_id ? { type: t.link_type, id: t.link_id, label: t.link_label ?? '' } : null);
  return (
    <form action={action} className="card">
      {t?.id && <input type="hidden" name="id" value={t.id} />}
      {l && <><input type="hidden" name="link_type" value={l.type} /><input type="hidden" name="link_id" value={l.id} /><input type="hidden" name="link_label" value={l.label} /></>}
      <label className="f"><span>Title</span><input className="inp" name="title" dir="auto" defaultValue={t?.title ?? ''} required autoFocus /></label>
      <div className="grid g4" style={{ marginTop: 10 }}>
        <label className="f"><span>Status</span><select className="inp" name="status" defaultValue={t?.status ?? 'todo'}>{STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f"><span>Priority</span><select className="inp" name="priority" defaultValue={t?.priority ?? 'normal'}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></label>
        <label className="f"><span>Due date</span><input className="inp" type="date" name="due" defaultValue={t?.due ?? ''} /></label>
        <label className="f"><span>Assignee</span><select className="inp" name="assignee_id" defaultValue={t?.assignee_id ?? (t?.id ? '' : me)}>
          <option value="">Unassigned</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <label className="f" style={{ marginTop: 10 }}><span>Details</span><textarea className="inp" name="details" dir="auto" rows={4} defaultValue={t?.details ?? ''} /></label>
      {l && <p className="muted" style={{ fontSize: 13 }}>Linked to {l.label || l.id}</p>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn pri">Save task</button></div>
    </form>
  );
}
