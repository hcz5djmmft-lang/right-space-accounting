// Planning against the test database: a schedule started from the Master BOQ sections, dated and baselined (the project
// moves to Execution and the material plan gets its needed-by dates), weekly progress from the site engineer with delays
// raised as tasks once, the schedule list and progress report, and the pending steps.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-plan-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const { today } = await import('@/lib/dates');
const { addDays, CATEGORIES } = await import('@/lib/planning-calc');
const pl = await import('@/lib/planning');
const q = await import('@/lib/qs');
const tasks = await import('@/lib/tasks');
const { pendingSteps } = await import('@/lib/pending');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr' | 'projects')[]; dept_id?: string };
const mgmt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'], dept_id: 'mgt' };
const mohamed: U = { id: '', email: 'mohamed@x.test', name: 'Mohamed TO', roles: ['projects'], dept_id: 'to' };
const ziad: U = { id: '', email: 'ziad@x.test', name: 'Ziad Finance', roles: ['finance'], dept_id: 'fin' };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [], dept_id: 'site' };
let project = '', saraEmp = '';
const T = today();
const acts = () => pl.listActivities(project);
const phaseOf = async (id: string) => (await sql<{ phase: string }[]>`select phase from projects where id = ${id}`)[0].phase;
const form = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, schedules, activities, activity_progress, tasks, estimates, material_plan, user_positions, project_phases, project_info, boqs cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null`;
  await sql`insert into departments (id, code, name, parent_id, roles) values ('to', 'TO', 'Technical Office', 'eng', '{engineering,projects}'), ('site', 'SITE', 'Site execution', 'eng', '{engineering,projects}') on conflict (id) do nothing`;
  for (const u of [mgmt, mohamed, ziad, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id ?? null}) returning id`)[0].id;
  saraEmp = (await sql<{ id: string }[]>`insert into employees (name, user_id, dept_id, basic, job_title) values ('Sara Site', ${sara.id}, 'site', 9000, 'Site engineer') returning id`)[0].id;
  project = (await sql<{ id: string }[]>`insert into projects (code, name, phase, area, created_by, site_eng_id) values ('PH-P1', 'Planning test unit', 'qs', 120, ${mohamed.id}, ${saraEmp}) returning id`)[0].id;
  await sql`insert into project_info (project_id, data) values (${project}, ${sql.json({ client_name: 'Mr Hassan', gross_area: '120' })})`;
  // the client accepts the estimate: the project lands in Planning with a material plan
  const est = await q.createEstimate(mohamed as never, project);
  await q.saveInputs(mohamed as never, est, 'pricing', form({ bathrooms: '1' }));
  await q.sendEstimate(mohamed as never, est);
  await q.decideEstimate(ziad as never, est, true, 'Signed');
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('a schedule', () => {
  it('is started by the engineers with the ten work categories, once', async () => {
    expect(await phaseOf(project)).toBe('planning');
    await expect(pl.startSchedule(sara as never, project)).rejects.toThrow(/Only the engineers/);
    await expect(pl.startSchedule(mohamed as never, 'office')).rejects.toThrow(/Project not found/);
    expect((await pendingSteps(mohamed as never)).map(s => s.title)).toContain('Set the schedule of PH-P1 and its baseline');
    await pl.startSchedule(mohamed as never, project);
    await pl.startSchedule(mohamed as never, project);
    const a = await acts();
    expect(a).toHaveLength(10);
    expect(a.map(x => x.name)).toEqual(CATEGORIES.map(c => c.title));
    expect(a.map(x => x.category)).toEqual(CATEGORIES.map(c => c.no));
    expect(a.every(x => !x.start_date && !x.end_date && Number(x.progress) === 0)).toBe(true);
    expect((await pl.getSchedule(project))!).toMatchObject({ baselined_at: null, updated_by: 'Mohamed TO' });
    expect((await pl.scheduleRows()).find(r => r.code === 'PH-P1')).toMatchObject({ has_schedule: true, activities: 10, dated: 0, site_eng: 'Sara Site', expected_end: null });
  });
  it('checks the planner\'s dates and names', async () => {
    const [a] = await acts();
    await expect(pl.saveActivities(mohamed as never, project, [{ id: a.id, start: '2026-10-10', end: '2026-10-01' }])).rejects.toThrow(/end comes before the start/);
    await expect(pl.saveActivities(mohamed as never, project, [{ id: a.id, start: '10/10/2026' }])).rejects.toThrow(/YYYY-MM-DD/);
    await expect(pl.saveActivities(mohamed as never, project, [{ id: a.id, name: ' ' }])).rejects.toThrow(/needs a name/);
    await expect(pl.saveActivities(sara as never, project, [])).rejects.toThrow(/Only the engineers/);
    await pl.saveActivities(mohamed as never, project, [{ id: a.id, name: 'Demolition and preparation', start: addDays(T, -10), end: addDays(T, 9), note: 'two crews' }], 'Client wants the keys by year end');
    const [b] = await acts();
    expect(b).toMatchObject({ name: 'Demolition and preparation', start_date: addDays(T, -10), end_date: addDays(T, 9), note: 'two crews' });
    expect((await pl.getSchedule(project))!.note).toBe('Client wants the keys by year end');
  });
  it('takes extra activities and drops them again while no work is recorded', async () => {
    await expect(pl.addActivity(mohamed as never, project, { name: '' })).rejects.toThrow(/Give the activity a name/);
    await expect(pl.addActivity(mohamed as never, 'office', { name: 'Snags' })).rejects.toThrow(/Start the schedule first/);
    const id = await pl.addActivity(mohamed as never, project, { name: 'Snag list and cleaning', category: 'nope', start: addDays(T, 10), end: addDays(T, 12) });
    const a = await acts();
    expect(a).toHaveLength(11);
    expect(a.at(-1)).toMatchObject({ id, name: 'Snag list and cleaning', category: 'other', position: 11 });
    await pl.removeActivity(mohamed as never, id);
    expect(await acts()).toHaveLength(10);
  });
  it('is baselined only when every activity is dated; the project then moves to Execution and the materials get their needed-by dates', async () => {
    await expect(pl.setBaseline(mohamed as never, project)).rejects.toThrow(`Date every activity first, or remove it: ${CATEGORIES[1].title}, `);
    const a = await acts();
    await pl.saveActivities(mohamed as never, project, a.map((x, i) => (i === 9 ? { id: x.id, start: addDays(T, 5), end: addDays(T, 20) } : { id: x.id, start: addDays(T, -10), end: addDays(T, 9) })));
    await expect(pl.setBaseline(sara as never, project)).rejects.toThrow(/Only the engineers/);
    await pl.setBaseline(mohamed as never, project, 'Agreed with the client');
    const b = await acts();
    expect(b.every(x => x.base_start === x.start_date && x.base_end === x.end_date)).toBe(true);
    expect((await pl.getSchedule(project))!).toMatchObject({ baselined_at: T, baselined_by: 'Mohamed TO', note: 'Agreed with the client' });
    expect(await phaseOf(project)).toBe('execution');
    const plan = await sql<{ calculator: string; d: string | null }[]>`select calculator, to_char(min(needed_by),'YYYY-MM-DD') d from material_plan where project_id = ${project} group by calculator order by calculator`;
    expect(plan.find(m => m.calculator === 'bathroom')!.d).toBe(addDays(T, -17));   // category 2 starts T-10, materials a week before
    expect(plan.find(m => m.calculator === 'sanitary')!.d).toBe(addDays(T, -2));    // category 10 starts T+5
    expect((await sql<{ action: string }[]>`select action from audit_log where entity = 'schedule' and entity_id = ${project} order by at`).map(r => r.action)).toEqual(['Schedule started', 'Schedule saved', 'Activity added', 'Activity removed', 'Schedule saved', 'Baseline set']);
    expect((await pendingSteps(mohamed as never)).map(s => s.title)).not.toContain('Set the schedule of PH-P1 and its baseline');
  });
});

describe('weekly progress', () => {
  it('comes from the site engineer or the engineers, as percentages that never go down', async () => {
    const a = await acts();
    await expect(pl.recordProgress(ziad as never, project, T, [])).rejects.toThrow(/Only the site engineer/);
    await expect(pl.recordProgress(sara as never, project, 'this week', [])).rejects.toThrow(/week as a date/);
    await expect(pl.recordProgress(sara as never, project, T, [{ id: a[0].id, pct: '150' }])).rejects.toThrow(/0 to 100/);
    const r = await pl.recordProgress(sara as never, project, T, a.map((x, i) => ({ id: x.id, pct: i === 9 ? '' : i === 1 ? 0 : 60, note: i === 1 ? 'tiles not delivered' : '' })));
    expect(r).toEqual({ recorded: 9, raised: 1 });
    const b = await acts();
    expect(b[0]).toMatchObject({ progress: 60, progress_at: T });
    expect(b[9]).toMatchObject({ progress: 0, progress_at: null });
    await expect(pl.recordProgress(sara as never, project, T, [{ id: a[0].id, pct: 50 }])).rejects.toThrow(/cannot go down from 60/);
    expect((await pl.progressHistory(project))[0]).toMatchObject({ week: T, who: 'Sara Site' });
    expect(await pl.progressHistory(project)).toHaveLength(9);
  });
  it('raises one high task per activity behind the plan, for the site engineer, and not twice', async () => {
    const a = await acts();
    const open = await tasks.listTasks({ mine: sara.id });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ title: `Delay: ${CATEGORIES[1].title} · PH-P1`, priority: 'high', status: 'todo', assignee_emp_id: saraEmp, assignee_id: sara.id, link_type: 'planning', link_id: project, due: a[1].end_date });
    expect(open[0].details).toMatch(/is at 0 % against 55 % planned/);
    expect((await pl.recordProgress(sara as never, project, T, [{ id: a[1].id, pct: 10 }])).raised).toBe(0);
    expect(await tasks.listTasks({ mine: sara.id })).toHaveLength(1);
    // a late activity: the planner shortens its end to three days ago
    await pl.saveActivities(mohamed as never, project, [{ id: a[2].id, end: addDays(T, -3) }]);
    expect((await pl.recordProgress(mohamed as never, project, T, [])).raised).toBe(1);
    const late = (await tasks.listTasks({ mine: sara.id })).find(t => t.title.startsWith(`Delay: ${a[2].name}`))!;
    expect(late.details).toMatch(/is 3 days late at 60 %/);
    expect(await tasks.openForUser(sara.id)).toBe(2);
    await expect(pl.removeActivity(mohamed as never, a[2].id)).rejects.toThrow(/Work was already recorded/);
    // once the task is done, a new delay is raised again
    await sql`update tasks set status = 'done' where activity_id = ${a[1].id}`;
    expect((await pl.recordProgress(sara as never, project, T, [{ id: a[1].id, pct: 20 }])).raised).toBe(1);
  });
  it('shows in the schedule list, the progress report and the pending steps when a week has passed', async () => {
    const row = (await pl.scheduleRows()).find(r => r.code === 'PH-P1')!;
    expect(row).toMatchObject({ phase: 'execution', baselined_at: T, dated: 10, behind: 2, base_end: addDays(T, 20) });
    expect(row.actual_pct).toBeGreaterThan(40);
    expect(row.planned_pct).toBeGreaterThan(40);
    expect(row.expected_end! >= addDays(T, 20)).toBe(true);
    expect(await pl.progressDue()).toHaveLength(0);                 // recorded today
    await sql`update activities set progress_at = ${addDays(T, -7)} where project_id = ${project}`;
    expect(await pl.progressDue()).toMatchObject([{ code: 'PH-P1', site_user: sara.id, manager_user: null }]);
    expect((await pendingSteps(sara as never)).map(s => s.title)).toContain('Record this week\'s progress on PH-P1');
    expect((await pendingSteps(ziad as never)).map(s => s.title)).not.toContain('Record this week\'s progress on PH-P1');
    expect((await pendingSteps(sara as never)).find(s => s.kind === 'progress')!.href).toBe(`/planning/${project}#progress`);
  });
});
