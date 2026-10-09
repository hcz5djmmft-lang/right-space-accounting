import 'server-only';
import { sql } from './db';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ } from './dates';

// Tasks for the team. Anyone signed in can add or edit a task; deleting is for its creator, its assignee or Management.

export const STATUSES = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'Review'], ['done', 'Done']] as const;
export type Status = typeof STATUSES[number][0];
export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = typeof PRIORITIES[number];
export const LINKS: Record<string, string> = { entry: '/entries/', 'payment-request': '/payment-requests/', 'sales-invoice': '/sales-invoices/', 'cost-center': '/cost-centers/' };

export type Task = {
  id: string; title: string; details: string; status: Status; priority: Priority; due: string | null;
  assignee_id: string | null; assignee: string | null; link_type: string | null; link_id: string | null; link_label: string | null;
  created_by: string | null; creator: string | null; created_at: string; done_at: string | null; comments: number;
};
const select = (where = sql``) => sql<Task[]>`
  select t.id, t.title, t.details, t.status, t.priority, to_char(t.due,'YYYY-MM-DD') due, t.assignee_id, a.name assignee,
    t.link_type, t.link_id, t.link_label, t.created_by, c.name creator,
    to_char(t.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at, to_char(t.done_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') done_at,
    (select count(*)::int from task_comments x where x.task_id = t.id) comments
  from tasks t left join users a on a.id = t.assignee_id left join users c on c.id = t.created_by
  ${where}
  order by case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, t.due nulls last, t.created_at`;

export const listTasks = (opts: { mine?: string; link?: { type: string; id: string } } = {}) =>
  opts.mine ? select(sql`where t.assignee_id = ${opts.mine}`)
  : opts.link ? select(sql`where t.link_type = ${opts.link.type} and t.link_id = ${opts.link.id}`)
  : select();
export async function getTask(id: string) { return (await select(sql`where t.id = ${id}`))[0]; }
export const openForUser = async (userId: string) => (await sql<{ n: number }[]>`select count(*)::int n from tasks where assignee_id = ${userId} and status <> 'done'`)[0].n;

export type TaskInput = {
  id?: string; title: string; details: string; status: Status; priority: Priority; due?: string | null; assignee_id?: string | null;
  link_type?: string | null; link_id?: string | null; link_label?: string | null;
};
export async function saveTask(user: User, i: TaskInput) {
  const title = i.title.trim();
  if (!title) throw new RuleError('Give the task a title.');
  if (!STATUSES.some(s => s[0] === i.status)) throw new RuleError('Unknown status.');
  if (!PRIORITIES.includes(i.priority)) throw new RuleError('Unknown priority.');
  if (i.link_type && !LINKS[i.link_type]) throw new RuleError('Unknown link.');
  const vals = { title, details: i.details ?? '', status: i.status, priority: i.priority, due: i.due || null, assignee_id: i.assignee_id || null,
    link_type: i.link_type || null, link_id: i.link_id || null, link_label: i.link_label || null };
  if (i.id) {
    const n = await sql`update tasks set ${sql(vals)}, updated_at = now(), done_at = case when ${i.status} = 'done' then coalesce(done_at, now()) else null end where id = ${i.id}`;
    if (!n.count) throw new RuleError('Task not found.');
    return i.id;
  }
  const [{ id }] = await sql<{ id: string }[]>`insert into tasks ${sql({ ...vals, created_by: user.id, done_at: i.status === 'done' ? new Date() : null })} returning id`;
  return id;
}

export async function setStatus(user: User, id: string, status: Status) {
  if (!STATUSES.some(s => s[0] === status)) throw new RuleError('Unknown status.');
  await sql`update tasks set status = ${status}, updated_at = now(), done_at = case when ${status} = 'done' then coalesce(done_at, now()) else null end where id = ${id}`;
}

export async function deleteTask(user: User, id: string) {
  const [t] = await sql<{ created_by: string | null; assignee_id: string | null }[]>`select created_by, assignee_id from tasks where id = ${id}`;
  if (!t) return;
  if (t.created_by !== user.id && t.assignee_id !== user.id && !hasRole(user, 'management')) throw new RuleError('Only the person who created or owns this task, or Management, can delete it.');
  await sql`delete from tasks where id = ${id}`;
}

export type Comment = { id: number; who: string | null; at: string; text: string };
export const listComments = (taskId: string) => sql<Comment[]>`
  select c.id, u.name who, to_char(c.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, c.text
  from task_comments c left join users u on u.id = c.user_id where c.task_id = ${taskId} order by c.at`;
export async function addComment(user: User, taskId: string, text: string) {
  text = text.trim();
  if (!text) return;
  await sql`insert into task_comments (task_id, user_id, text) values (${taskId}, ${user.id}, ${text})`;
  await sql`update tasks set updated_at = now() where id = ${taskId}`;
}
