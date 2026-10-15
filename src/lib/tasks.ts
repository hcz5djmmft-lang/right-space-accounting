import 'server-only';
import { sql, type Tx } from './db';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ } from './dates';

// Tasks for the team. Anyone signed in can add or edit a task; deleting is for its creator, its assignee or Management.
// The board moves by itself (update 18): a task arrives in To do; the assignee's clock-in on the task's project (or Start,
// for a task with no project) moves it to In progress; "Submit for review" puts it in Review and in the Approvals of whoever
// gave it; approved, it is Done; sent back, it is In progress again. Tasks raised from a document close with the document.

export const STATUSES = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'Review'], ['done', 'Done']] as const;
export type Status = typeof STATUSES[number][0];
export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = typeof PRIORITIES[number];
export const LINKS: Record<string, string> = { entry: '/entries/', 'payment-request': '/payment-requests/', 'sales-invoice': '/sales-invoices/', 'cost-center': '/cost-centers/', planning: '/planning/', design: '/design/', estimate: '/qs/', purchase: '/purchasing/', workorder: '/purchasing/work-orders/', claim: '/claims/', 'client-claim': '/claims/client/', variation: '/variations/', inspection: '/site/inspections/', 'site-report': '/site/reports/', snags: '/site/snags?project=', handover: '/site/handover/', budget: '/budgets?m=' };

/** Link types whose document closes the task by itself (site.ts inspections, followup.ts collections, procurement.ts late deliveries); every other task is handed in with Submit for review. */
export const SELF_CLOSING = ['inspection', 'sales-invoice', 'purchase'];

export type Task = {
  id: string; title: string; details: string; status: Status; priority: Priority; due: string | null;
  assignee_id: string | null; assignee_emp_id: string | null; assignee: string | null; assignee_key: string | null; link_type: string | null; link_id: string | null; link_label: string | null;
  created_by: string | null; creator: string | null; created_at: string; done_at: string | null; comments: number;
  project_id: string | null; project_code: string | null; submitted_at: string | null; submit_note: string; reviewer_id: string | null; reviewer: string | null;
};
const select = (where = sql``) => sql<Task[]>`
  select t.id, t.title, t.details, t.status, t.priority, to_char(t.due,'YYYY-MM-DD') due, t.assignee_id, t.assignee_emp_id, coalesce(e.name, a.name) assignee,
    case when t.assignee_emp_id is not null then 'e:' || t.assignee_emp_id when t.assignee_id is not null then 'u:' || t.assignee_id end assignee_key,
    t.link_type, t.link_id, t.link_label, t.created_by, c.name creator,
    to_char(t.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at, to_char(t.done_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') done_at,
    (select count(*)::int from task_comments x where x.task_id = t.id) comments,
    t.project_id, p.code project_code, to_char(t.submitted_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') submitted_at, t.submit_note, t.reviewer_id, r.name reviewer
  from tasks t left join users a on a.id = t.assignee_id left join employees e on e.id = t.assignee_emp_id left join users c on c.id = t.created_by
    left join projects p on p.id = t.project_id left join users r on r.id = t.reviewer_id
  ${where}
  order by case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, t.due nulls last, t.created_at`;

export const listTasks = (opts: { mine?: string; link?: { type: string; id: string } } = {}) =>
  opts.mine ? select(sql`where t.assignee_id = ${opts.mine} or exists (select 1 from employees e where e.id = t.assignee_emp_id and e.user_id = ${opts.mine})`)
  : opts.link ? select(sql`where t.link_type = ${opts.link.type} and t.link_id = ${opts.link.id}`)
  : select();
export async function getTask(id: string) { return (await select(sql`where t.id = ${id}`))[0]; }
export const openForUser = async (userId: string) => (await sql<{ n: number }[]>`select count(*)::int n from tasks t where status <> 'done' and (t.assignee_id = ${userId} or exists (select 1 from employees e where e.id = t.assignee_emp_id and e.user_id = ${userId}))`)[0].n;

/** `assignee_id` is the login (for "assigned to me" and the badge), `assignee_emp_id` the employee file; either may be missing. */
/** The status is not typed: a new task starts in To do and then moves by itself (see the top of this file). */
export type TaskInput = {
  id?: string; title: string; details: string; priority: Priority; due?: string | null; status?: Status; assignee_id?: string | null; assignee_emp_id?: string | null;
  link_type?: string | null; link_id?: string | null; link_label?: string | null; project_id?: string | null;
};
const HEAD_POSITIONS = ['eng_director', 'to_head', 'design_head', 'site_head', 'procurement_head', 'hr_head', 'finance_head'];
/** Update 20 (item 12): only a head gives tasks to others: Management, a department's head, the holder of a head position
 *  (Director of Engineering, Technical Office head…). */
export async function isHead(user: User, tx: Tx = sql) {
  if (hasRole(user, 'management')) return true;
  return !!(await tx`select 1 where exists (select 1 from departments where head_user_id = ${user.id} and active)
    or exists (select 1 from user_positions where user_id = ${user.id} and position in ${tx(HEAD_POSITIONS)})`)[0];
}
async function forSelf(user: User, i: Pick<TaskInput, 'assignee_id' | 'assignee_emp_id'>) {
  if (!i.assignee_id && !i.assignee_emp_id) return true;
  if (i.assignee_emp_id) return !!(await sql`select 1 from employees where id = ${i.assignee_emp_id} and user_id = ${user.id}`)[0];
  return i.assignee_id === user.id;
}

export async function saveTask(user: User, i: TaskInput) {
  const title = i.title.trim();
  if (!(await forSelf(user, i)) && !(await isHead(user))) {
    const [old] = i.id ? await sql<{ assignee_id: string | null; assignee_emp_id: string | null }[]>`select assignee_id, assignee_emp_id from tasks where id = ${i.id}` : [];
    const same = old && (old.assignee_id ?? null) === (i.assignee_id || null) && (old.assignee_emp_id ?? null) === (i.assignee_emp_id || null);
    if (!same) throw new RuleError('Only department heads give tasks to others. You can add a task for yourself.');
  }
  if (!title) throw new RuleError('Give the task a title.');
  if (!PRIORITIES.includes(i.priority)) throw new RuleError('Unknown priority.');
  if (i.link_type && !LINKS[i.link_type]) throw new RuleError('Unknown link.');
  if (i.project_id && !(await sql`select 1 from projects where id = ${i.project_id}`)[0]) throw new RuleError('That project no longer exists.');
  const vals = { title, details: i.details ?? '', priority: i.priority, due: i.due || null, assignee_id: i.assignee_id || null, assignee_emp_id: i.assignee_emp_id || null,
    link_type: i.link_type || null, link_id: i.link_id || null, link_label: i.link_label || null, project_id: i.project_id || null };
  if (i.id) {
    const n = await sql`update tasks set ${sql(vals)}, updated_at = now() where id = ${i.id}`;
    if (!n.count) throw new RuleError('Task not found.');
    return i.id;
  }
  const status = i.status ?? 'todo';   // the form never sends one: a new task starts in To do
  if (!STATUSES.some(s => s[0] === status)) throw new RuleError('Unknown status.');
  const [{ id }] = await sql<{ id: string }[]>`insert into tasks ${sql({ ...vals, status, created_by: user.id, done_at: status === 'done' ? new Date() : null })} returning id`;
  return id;
}

const isAssignee = (userId: string) => sql`(t.assignee_id = ${userId} or exists (select 1 from employees e where e.id = t.assignee_emp_id and e.user_id = ${userId}))`;
async function mine(user: User, id: string) {
  const [t] = await sql<{ status: Status; mine: boolean; created_by: string | null; project_id: string | null; link_type: string | null }[]>`
    select t.status, ${isAssignee(user.id)} mine, t.created_by, t.project_id, t.link_type from tasks t where t.id = ${id}`;
  if (!t) throw new RuleError('Task not found.');
  return t;
}

/** A task with no project starts when its person taps Start; a project's task starts at their clock-in on the project. */
export async function startTask(user: User, id: string) {
  const t = await mine(user, id);
  if (!t.mine && t.created_by !== user.id && !hasRole(user, 'management')) throw new RuleError('Only the person the task is assigned to starts it.');
  if (t.status !== 'todo') throw new RuleError('This task has already started.');
  await sql`update tasks set status = 'doing', updated_at = now() where id = ${id}`;
}

/** The clock-in (or a switch) on a project: that person's To do tasks of the project move to In progress. Returns how many moved. */
export async function startOnClockIn(tx: Tx, employeeId: string, userId: string, projectId: string) {
  const r = await tx`update tasks t set status = 'doing', updated_at = now()
    where t.status = 'todo' and t.project_id = ${projectId} and (t.assignee_emp_id = ${employeeId} or t.assignee_id = ${userId})`;
  return r.count;
}

/** The assignee hands the work in: the task goes to Review and waits in Approvals for whoever gave it (Management when they gave it to themselves). */
export async function submitTask(user: User, id: string, note = '') {
  const t = await mine(user, id);
  if (!t.mine) throw new RuleError('Only the person the task is assigned to submits it.');
  if (t.status === 'review') throw new RuleError('This task is already waiting for review.');
  if (t.status === 'done') throw new RuleError('This task is already done.');
  if (t.link_type && SELF_CLOSING.includes(t.link_type)) throw new RuleError('This task is handed in by finishing its document; it closes by itself.');
  const reviewer = t.created_by && t.created_by !== user.id ? t.created_by : null;
  await sql.begin(async tx => {
    await tx`update tasks set status = 'review', submitted_at = now(), submit_note = ${note.trim()}, reviewer_id = ${reviewer}, updated_at = now() where id = ${id}`;
    await tx`insert into task_comments (task_id, user_id, text) values (${id}, ${user.id}, ${`Submitted for review${note.trim() ? `: ${note.trim()}` : '.'}`})`;
  });
}

const mayReview = (user: User, reviewerId: string | null) => reviewerId ? reviewerId === user.id || hasRole(user, 'management') : hasRole(user, 'management');

/** Approve marks the task Done; Send back returns it to In progress with the reason as a comment. */
export async function reviewTask(user: User, id: string, approve: boolean, note = '') {
  const [t] = await sql<{ status: Status; reviewer_id: string | null }[]>`select status, reviewer_id from tasks where id = ${id}`;
  if (!t) throw new RuleError('Task not found.');
  if (t.status !== 'review') throw new RuleError('This task is not waiting for review.');
  if (!mayReview(user, t.reviewer_id)) throw new RuleError('Only the person who gave this task, or Management, reviews it.');
  if (!approve && !note.trim()) throw new RuleError('Say what is missing, so it can be fixed.');
  await sql.begin(async tx => {
    await tx`update tasks set status = ${approve ? 'done' : 'doing'}, done_at = ${approve ? new Date() : null}, updated_at = now() where id = ${id}`;
    await tx`insert into task_comments (task_id, user_id, text) values (${id}, ${user.id}, ${approve ? `Approved${note.trim() ? `: ${note.trim()}` : '.'}` : `Sent back: ${note.trim()}`})`;
  });
}

/** Moves a task to any column; used by the system and tests only (people move tasks by Start, Submit and the review). */
export async function setStatus(user: User, id: string, status: Status) {
  if (!STATUSES.some(s => s[0] === status)) throw new RuleError('Unknown status.');
  await sql`update tasks set status = ${status}, updated_at = now(), done_at = case when ${status} = 'done' then coalesce(done_at, now()) else null end where id = ${id}`;
}

/** Tasks waiting in Review for this person's approval. */
export const tasksToReview = (user: User) => select(sql`where t.status = 'review' and (t.reviewer_id = ${user.id} or (${hasRole(user, 'management')} and t.reviewer_id is null))`);
export const canReview = (user: User, t: Pick<Task, 'status' | 'reviewer_id'>) => t.status === 'review' && mayReview(user, t.reviewer_id);

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
