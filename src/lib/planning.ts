import 'server-only';
import { sql, type Tx } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ, today } from './dates';
import { movePhase } from './projects';
import { type Activity, CALCULATOR_CATEGORY, CATEGORIES, LEAD_DAYS, addDays, isBehind, overdueDays, plannedPct, summarize } from './planning-calc';

// Planning: one activity per work category with planned dates (the Master BOQ's ten sections to start with, the planner adds
// or removes rows), a baseline frozen when the schedule is set (the project then moves to Execution and procurement gets the
// materials' needed-by dates), weekly progress from the site engineer, and a task raised for every activity that falls behind.

export const canPlan = (u: User) => hasRole(u, 'engineering', 'projects');
const need = (u: User, what: string) => { if (!canPlan(u)) throw new RuleError(`Only the engineers can ${what}.`); };
const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d\d-\d\d$/.test(s);

export const listActivities = (projectId: string, tx: Tx = sql) => tx<Activity[]>`
  select id, category, name, position, to_char(start_date,'YYYY-MM-DD') start_date, to_char(end_date,'YYYY-MM-DD') end_date, to_char(base_start,'YYYY-MM-DD') base_start, to_char(base_end,'YYYY-MM-DD') base_end,
    progress::float progress, to_char(progress_at,'YYYY-MM-DD') progress_at, note from activities where project_id = ${projectId} order by position, name`;

export type Schedule = { project_id: string; note: string; baselined_at: string | null; baselined_by: string | null; updated_at: string; updated_by: string | null };
export const getSchedule = async (projectId: string, tx: Tx = sql) => (await tx<Schedule[]>`
  select s.project_id, s.note, to_char(s.baselined_at at time zone ${TZ},'YYYY-MM-DD') baselined_at, b.name baselined_by, to_char(s.updated_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') updated_at, u.name updated_by
  from schedules s left join users b on b.id = s.baselined_by left join users u on u.id = s.updated_by where s.project_id = ${projectId}`)[0] ?? null;

/** Starts a project's schedule with the ten work categories (nothing dated yet). */
export async function startSchedule(user: User, projectId: string) {
  need(user, 'plan a project');
  await sql.begin(async tx => {
    const [p] = await tx<{ id: string; is_office: boolean }[]>`select id, is_office from projects where id = ${projectId}`;
    if (!p || p.is_office) throw new RuleError('Project not found.');
    const [has] = await tx`select 1 from schedules where project_id = ${projectId}`;
    if (has) return;
    await tx`insert into schedules (project_id, updated_by) values (${projectId}, ${user.id})`;
    for (const [i, c] of CATEGORIES.entries()) await tx`insert into activities (project_id, position, category, name) values (${projectId}, ${i + 1}, ${c.no}, ${c.title})`;
    await audit(tx, user, 'schedule', projectId, 'Schedule started', `${CATEGORIES.length} work categories`);
  });
}

/** The planner's dates and names: every row of the schedule at once. */
export async function saveActivities(user: User, projectId: string, rows: { id: string; name?: string; start?: string; end?: string; note?: string }[], note?: string) {
  need(user, 'change a schedule');
  await sql.begin(async tx => {
    const acts = await listActivities(projectId, tx);
    for (const r of rows) {
      const a = acts.find(x => x.id === r.id);
      if (!a) continue;
      const name = (r.name ?? a.name).trim();
      if (!name) throw new RuleError('Every activity needs a name.');
      const start = r.start === undefined ? a.start_date : r.start || null, end = r.end === undefined ? a.end_date : r.end || null;
      if ((start && !isDate(start)) || (end && !isDate(end))) throw new RuleError(`${name}: give the dates as YYYY-MM-DD.`);
      if (start && end && end < start) throw new RuleError(`${name}: the end comes before the start.`);
      await tx`update activities set name = ${name}, start_date = ${start}, end_date = ${end}, note = ${(r.note ?? a.note).trim()} where id = ${r.id}`;
    }
    await tx`update schedules set note = ${note === undefined ? sql`note` : note.trim()}, updated_by = ${user.id}, updated_at = now() where project_id = ${projectId}`;
    await audit(tx, user, 'schedule', projectId, 'Schedule saved');
  });
}

export async function addActivity(user: User, projectId: string, i: { name: string; category?: string; start?: string; end?: string }) {
  need(user, 'change a schedule');
  const name = i.name.trim();
  if (!name) throw new RuleError('Give the activity a name.');
  if ((i.start && !isDate(i.start)) || (i.end && !isDate(i.end))) throw new RuleError('Give the dates as YYYY-MM-DD.');
  if (i.start && i.end && i.end < i.start) throw new RuleError('The end comes before the start.');
  return sql.begin(async tx => {
    const [has] = await tx`select 1 from schedules where project_id = ${projectId}`;
    if (!has) throw new RuleError('Start the schedule first.');
    const [{ pos }] = await tx<{ pos: number }[]>`select coalesce(max(position), 0)::int + 1 pos from activities where project_id = ${projectId}`;
    const cat = i.category && CATEGORIES.some(c => c.no === i.category) ? i.category : 'other';
    const [a] = await tx<{ id: string }[]>`insert into activities (project_id, position, category, name, start_date, end_date) values (${projectId}, ${pos}, ${cat}, ${name}, ${i.start || null}, ${i.end || null}) returning id`;
    await audit(tx, user, 'schedule', projectId, 'Activity added', name);
    return a.id;
  });
}

export async function removeActivity(user: User, activityId: string) {
  need(user, 'change a schedule');
  await sql.begin(async tx => {
    const [a] = await tx<{ project_id: string; name: string; progress: number }[]>`select project_id, name, progress::float progress from activities where id = ${activityId}`;
    if (!a) throw new RuleError('Activity not found.');
    if (a.progress > 0) throw new RuleError('Work was already recorded on this activity; it stays on the schedule.');
    await tx`delete from activities where id = ${activityId}`;
    await audit(tx, user, 'schedule', a.project_id, 'Activity removed', a.name);
  });
}

/** Freezes the plan as the baseline, moves the project to Execution and dates the material plan for procurement. */
export async function setBaseline(user: User, projectId: string, note = '') {
  need(user, 'set the baseline');
  await sql.begin(async tx => {
    const acts = await listActivities(projectId, tx);
    if (acts.length === 0) throw new RuleError('The schedule is empty.');
    const undated = acts.filter(a => !a.start_date || !a.end_date);
    if (undated.length) throw new RuleError(`Date every activity first, or remove it: ${undated.map(a => a.name).join(', ')}.`);
    await tx`update activities set base_start = start_date, base_end = end_date where project_id = ${projectId}`;
    await tx`update schedules set baselined_at = now(), baselined_by = ${user.id}, note = ${note.trim() || sql`note`}, updated_by = ${user.id}, updated_at = now() where project_id = ${projectId}`;
    // procurement's needed-by dates: a week before the category starts
    let dated = 0;
    for (const [calc, cat] of Object.entries(CALCULATOR_CATEGORY)) {
      const start = acts.filter(a => a.category === cat && a.start_date).map(a => a.start_date!).sort()[0];
      if (!start) continue;
      const r = await tx`update material_plan set needed_by = ${addDays(start, -LEAD_DAYS)} where project_id = ${projectId} and calculator = ${calc}`;
      dated += r.count;
    }
    const s = summarize(acts, today());
    await audit(tx, user, 'schedule', projectId, 'Baseline set', `${s.start} to ${s.end} · ${acts.length} activities · ${dated} materials dated`);
    const [p] = await tx<{ phase: string | null }[]>`select phase from projects where id = ${projectId}`;
    if (p?.phase === 'planning') await movePhase(tx, user, projectId, 'execution', 'Schedule baseline set');
  });
}

/** Whether the login is the project's site engineer or manager (their employee files carry the login). */
export const onSiteTeam = async (projectId: string, userId: string, tx: Tx = sql) =>
  !!(await tx`select 1 from projects p join employees e on e.id in (p.site_eng_id, p.manager_id) where p.id = ${projectId} and e.user_id = ${userId}`)[0];

/** Who gets the delay task: the site engineer's file, else the project manager's, else whoever records the progress. */
async function delayOwner(tx: Tx, projectId: string, fallback: string) {
  const [p] = await tx<{ emp: string | null; login: string | null; code: string }[]>`
    select coalesce(p.site_eng_id, p.manager_id) emp, e.user_id login, p.code from projects p left join employees e on e.id = coalesce(p.site_eng_id, p.manager_id) where p.id = ${projectId}`;
  return { emp: p?.emp ?? null, who: p?.login ?? (p?.emp ? null : fallback), code: p?.code ?? '' };
}

/** Raises one open task per activity that is behind (late, or ten points under the plan); returns how many were raised now. */
export async function raiseDelayTasks(tx: Tx, user: User, projectId: string, now = today()) {
  const acts = await listActivities(projectId, tx);
  const { emp, who, code } = await delayOwner(tx, projectId, user.id);
  let raised = 0;
  for (const a of acts) {
    if (!isBehind(a, now)) continue;
    const [open] = await tx`select 1 from tasks where activity_id = ${a.id} and status <> 'done'`;
    if (open) continue;
    const late = overdueDays(a, now);
    const details = late ? `${a.name} was due ${a.end_date} and is ${late} day${late === 1 ? '' : 's'} late at ${a.progress} %.` : `${a.name} is at ${a.progress} % against ${plannedPct(a, now)} % planned by ${now} (ends ${a.end_date}).`;
    await tx`insert into tasks (title, details, status, priority, due, assignee_id, assignee_emp_id, link_type, link_id, link_label, activity_id, project_id, created_by)
      values (${`Delay: ${a.name} · ${code}`}, ${details}, 'todo', 'high', ${a.end_date}, ${who}, ${emp}, 'planning', ${projectId}, ${code}, ${a.id}, ${projectId}, ${user.id})`;
    raised++;
  }
  return raised;
}

/** The site engineer's weekly figures: progress % per activity, recorded for the week, with the late ones flagged as tasks. */
export async function recordProgress(user: User, projectId: string, week: string, entries: { id: string; pct: string | number; note?: string }[]) {
  if (!canPlan(user) && !(await onSiteTeam(projectId, user.id))) throw new RuleError('Only the site engineer, the project manager or the engineers record progress.');
  if (!isDate(week)) throw new RuleError('Give the week as a date.');
  return sql.begin(async tx => {
    const acts = await listActivities(projectId, tx);
    let n = 0;
    for (const e of entries) {
      const a = acts.find(x => x.id === e.id);
      if (!a || e.pct === '' || e.pct == null) continue;
      const pct = Number(e.pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new RuleError(`${a.name}: progress is a percentage from 0 to 100.`);
      if (pct === Number(a.progress) && !(e.note ?? '').trim()) continue;
      if (pct < Number(a.progress)) throw new RuleError(`${a.name}: progress cannot go down from ${a.progress} % (fix the earlier entry with HR or Management).`);
      await tx`insert into activity_progress (activity_id, week, pct, note, user_id) values (${a.id}, ${week}, ${pct}, ${(e.note ?? '').trim()}, ${user.id})`;
      await tx`update activities set progress = ${pct}, progress_at = ${week} where id = ${a.id}`;
      n++;
    }
    const raised = await raiseDelayTasks(tx, user, projectId);
    await audit(tx, user, 'schedule', projectId, 'Progress recorded', `week ${week} · ${n} activities${raised ? ` · ${raised} delay task${raised === 1 ? '' : 's'} raised` : ''}`);
    return { recorded: n, raised };
  });
}

export const progressHistory = (projectId: string) => sql<{ week: string; name: string; pct: number; note: string; who: string | null }[]>`
  select to_char(p.week,'YYYY-MM-DD') week, a.name, p.pct::float pct, p.note, u.name who from activity_progress p join activities a on a.id = p.activity_id left join users u on u.id = p.user_id
  where a.project_id = ${projectId} order by p.week desc, p.at desc limit 60`;

export type ScheduleRow = { id: string; code: string; name: string; phase: string | null; site_eng: string | null; baselined_at: string | null; has_schedule: boolean } & ReturnType<typeof summarize>;
/** Every project with a schedule or in a phase that needs one, each summarised for the list and the Schedule progress report. */
export async function scheduleRows(now = today()): Promise<ScheduleRow[]> {
  const projects = await sql<{ id: string; code: string; name: string; phase: string | null; site_eng: string | null; baselined_at: string | null; has_schedule: boolean }[]>`
    select p.id, p.code, p.name, p.phase, u.name site_eng, to_char(s.baselined_at at time zone ${TZ},'YYYY-MM-DD') baselined_at, s.project_id is not null has_schedule
    from projects p left join schedules s on s.project_id = p.id left join employees u on u.id = p.site_eng_id
    where not p.is_office and (s.project_id is not null or p.phase in ('planning','execution','handover')) order by p.code`;
  const out: ScheduleRow[] = [];
  for (const p of projects) out.push({ ...p, ...summarize(p.has_schedule ? await listActivities(p.id) : [], now) });
  return out;
}

/** Projects whose weekly progress is due (a week or more since the last entry) for the pending steps. */
export const progressDue = (now = today()) => sql<{ id: string; code: string; site_user: string | null; manager_user: string | null }[]>`
  select p.id, p.code, se.user_id site_user, me.user_id manager_user from projects p join schedules s on s.project_id = p.id and s.baselined_at is not null
  left join employees se on se.id = p.site_eng_id left join employees me on me.id = p.manager_id
  where p.phase = 'execution' and exists (select 1 from activities a where a.project_id = p.id and a.progress < 100 and a.start_date <= ${now}::date and coalesce(a.progress_at, '2000-01-01') <= ${now}::date - 7) order by p.code`;
