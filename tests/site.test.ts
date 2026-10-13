// Site execution against the test database: the daily site report from the phone (manpower, work, one per project and day,
// sent and reviewed), inspection requests as tasks for the inspector with Failed landing on the snag list, the snag list's
// states, the handover certificate that moves the project to Handover and signs once every snag is verified, pending steps.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-site-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const { today } = await import('@/lib/dates');
const { addDays } = await import('@/lib/planning-calc');
const site = await import('@/lib/site');
const planning = await import('@/lib/planning');
const att = await import('@/lib/attachments');
const { pendingSteps } = await import('@/lib/pending');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[]; dept_id: string | null };
const youssef: U = { id: '', email: 'youssef@x.test', name: 'Youssef', roles: ['engineering'], dept_id: 'eng' };
const adel: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'], dept_id: 'fin' };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [], dept_id: null };
const omar: U = { id: '', email: 'omar@x.test', name: 'Omar Buyer', roles: [], dept_id: 'pur' };
const project = 'cs-ch2505';
const T = today(), Y = addDays(T, -1);
let acts: { id: string; name: string }[] = [], other = '', report = '', failedSnag = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, tasks, schedules, site_reports, inspection_requests, snags, handovers, attachments, user_positions cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`insert into departments (id, code, name) values ('pur', 'PUR', 'Purchasing') on conflict do nothing`;
  await sql`insert into departments (id, code, name, parent_id, roles) values ('site', 'SITE', 'Site execution', 'eng', '{engineering,projects}') on conflict (id) do nothing`;
  for (const u of [youssef, adel, sara, omar]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${youssef.id} where id = 'eng'`;
  const saraEmp = (await sql<{ id: string }[]>`insert into employees (name, user_id, dept_id, basic, job_title) values ('Sara Site', ${sara.id}, 'site', 9000, 'Site engineer') returning id`)[0].id;
  await sql`update projects set site_eng_id = ${saraEmp}, manager_id = null, status = 'Active', phase = 'execution' where id = ${project}`;
  await planning.startSchedule(youssef as never, project);
  acts = await planning.listActivities(project);
  [{ id: other }] = await sql<{ id: string }[]>`select id from projects where not is_office and id <> ${project} order by code limit 1`;
  await sql`update projects set phase = 'planning', status = 'Active' where id = ${other}`;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('daily site reports', () => {
  it('asks the site engineer for today\'s report, saves one per project and day with manpower and the activities worked, sends it, and the engineers review it', async () => {
    const ask = (steps: { title: string }[]) => steps.some(s => /Send today's site report for/.test(s.title));
    expect(ask(await pendingSteps(sara as never))).toBe(true);
    expect(ask(await pendingSteps(omar as never))).toBe(false);
    await expect(site.saveReport(omar as never, { project, day: T, work_done: 'x', manpower: [], activities: [] })).rejects.toThrow(/Only the site engineer/);
    await expect(site.saveReport(sara as never, { project, day: '2099-01-01', work_done: 'x', manpower: [], activities: [] })).rejects.toThrow(/has not come yet/);
    report = await site.saveReport(sara as never, { project, day: T, weather: 'Hot', work_done: 'Bathroom 1 plumbing rough-in, kitchen chasing', materials: '20 bags of cement', issues: '',
      manpower: [{ trade: 'Plumbing', headcount: 3 }, { trade: 'Labour', headcount: '2', hours: 10 }, { trade: '', headcount: '' }, { trade: 'Tiling', headcount: '0' }], activities: [acts[1].id, 'not-an-activity'] });
    const r = await site.getReport(report);
    expect(r).toMatchObject({ status: 'draft', weather: 'Hot', headcount: 5, photos: 0 });
    expect(r!.no).toMatch(/^SR-\d{5}$/);
    expect((await site.listManpower(report)).map(m => [m.trade, m.headcount, m.hours])).toEqual([['Plumbing', 3, 8], ['Labour', 2, 10]]);
    expect((await site.listWork(report)).map(w => w.activity_id)).toEqual([acts[1].id]);
    expect(ask(await pendingSteps(sara as never))).toBe(true);   // a draft is not sent yet
    await expect(site.saveReport(sara as never, { project, day: T, work_done: 'again', manpower: [], activities: [] })).rejects.toThrow(/already a site report \(SR-/);
    await expect(site.saveReport(sara as never, { id: report, project, day: T, work_done: 'x', manpower: [{ trade: 'Plumbing', headcount: 2.5 }], activities: [] })).rejects.toThrow(/whole number/);
    // the empty report cannot be sent
    const empty = await site.saveReport(sara as never, { project, day: Y, work_done: '', manpower: [{ trade: 'Labour', headcount: 1 }], activities: [] });
    await expect(site.submitReport(sara as never, empty)).rejects.toThrow(/Say what was done/);
    await site.deleteReport(sara as never, empty);
    expect(await site.getReport(empty)).toBeNull();
    await expect(site.reviewReport(youssef as never, report)).rejects.toThrow(/not been sent/);
    await site.submitReport(sara as never, report);
    expect((await site.getReport(report))!.status).toBe('submitted');
    expect(ask(await pendingSteps(sara as never))).toBe(false);
    await expect(site.submitReport(sara as never, report)).rejects.toThrow(/already sent/);
    await expect(site.deleteReport(sara as never, report)).rejects.toThrow(/sent report stays/);
    await expect(site.reviewReport(sara as never, report)).rejects.toThrow(/Only the engineers/);
    await site.reviewReport(youssef as never, report, 'Good; photograph the chasing tomorrow');
    const done = await site.getReport(report);
    expect(done).toMatchObject({ status: 'reviewed', review_note: 'Good; photograph the chasing tomorrow', reviewed_by_name: 'Youssef' });
    await expect(site.saveReport(sara as never, { id: report, project, day: T, work_done: 'late edit', manpower: [], activities: [] })).rejects.toThrow(/reviewed/);
  });

  it('photos: the site team adds them to its own project\'s report, others do not', async () => {
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const id = await att.addAttachment(sara as never, 'site-report', report, 'photo.jpg', jpg);
    expect(id).toBeTruthy();
    expect((await site.getReport(report))!.photos).toBe(1);
    await expect(att.addAttachment(omar as never, 'site-report', report, 'photo.jpg', jpg)).rejects.toThrow(/site team or the engineers/);
  });
});

describe('inspection requests', () => {
  it('raises a high task for the inspector (the manager, else the Technical Office head, else the Engineering head); Failed goes on the snag list and closes the task', async () => {
    expect(await site.defaultInspector(project)).toBe(youssef.id);
    await expect(site.raiseInspection(sara as never, { project, title: '', requested_for: T })).rejects.toThrow(/Say what is to be inspected/);
    const id = await site.raiseInspection(sara as never, { project, activity: acts[1].id, title: 'Bathroom 1 rough-in', location: 'Master bathroom', requested_for: T });
    const i = (await site.getInspection(id))!;
    expect(i).toMatchObject({ status: 'open', inspector_id: youssef.id, inspector: 'Youssef', activity: acts[1].name, requested_by_name: 'Sara Site' });
    expect(i.no).toMatch(/^IR-\d{5}$/);
    const [t] = await sql<{ assignee_id: string; priority: string; link_type: string; link_id: string; status: string; due: string }[]>`select assignee_id, priority, link_type, link_id, status, to_char(due,'YYYY-MM-DD') due from tasks where id = ${i.task_id}`;
    expect(t).toMatchObject({ assignee_id: youssef.id, priority: 'high', link_type: 'inspection', link_id: id, status: 'todo', due: T });
    await expect(site.decideInspection(sara as never, id, true)).rejects.toThrow(/Only the inspector/);
    await expect(site.decideInspection(youssef as never, id, false, '')).rejects.toThrow(/Say what failed/);
    failedSnag = (await site.decideInspection(youssef as never, id, false, 'Slope wrong on the drain line'))!;
    expect(failedSnag).toBeTruthy();
    const s = (await site.getSnag(failedSnag))!;
    expect(s).toMatchObject({ snag_no: 1, status: 'open', priority: 'high', assignee_id: sara.id, inspection_id: id, area: 'Master bathroom' });
    expect(s.description).toMatch(/Bathroom 1 rough-in: Slope wrong/);
    expect(s.trade).toBe(acts[1].name);
    expect((await sql<{ status: string }[]>`select status from tasks where id = ${i.task_id}`)[0].status).toBe('done');
    expect((await site.getInspection(id))!).toMatchObject({ status: 'failed', snag_no: 1, inspected_by_name: 'Youssef' });
    await expect(site.decideInspection(youssef as never, id, true)).rejects.toThrow(/already failed/);
    // the re-inspection passes with a chosen inspector; a third request is cancelled and its task goes
    const id2 = await site.raiseInspection(sara as never, { project, title: 'Bathroom 1 rough-in, second visit', requested_for: addDays(T, 1), inspector: adel.id });
    expect(await site.decideInspection(adel as never, id2, true, 'OK')).toBeNull();
    const id3 = await site.raiseInspection(youssef as never, { project, title: 'Kitchen chasing', requested_for: addDays(T, 2) });
    await expect(site.cancelInspection(omar as never, id3)).rejects.toThrow(/Only the site engineer/);
    await site.cancelInspection(sara as never, id3);
    expect((await site.getInspection(id3))!.status).toBe('cancelled');
    expect((await sql`select 1 from tasks where link_type = 'inspection' and link_id = ${id3}`).length).toBe(0);
    expect((await site.listInspections({ project, open: true })).length).toBe(0);
  });
});

describe('the snag list', () => {
  it('goes open > fixed > verified, numbered per project; the pending steps count the snags to fix and to verify', async () => {
    await expect(site.addSnag(omar as never, { project, description: 'x' })).rejects.toThrow(/Only the site engineer/);
    await expect(site.addSnag(sara as never, { project, description: '  ' })).rejects.toThrow(/Describe the snag/);
    const s2 = await site.addSnag(sara as never, { project, area: 'Kitchen', description: 'Paint cracked above the door', trade: 'Painting', due: T });
    expect((await site.getSnag(s2))!).toMatchObject({ snag_no: 2, status: 'open', priority: 'normal', assignee_id: sara.id, found_by_name: 'Sara Site' });
    const titles = (await pendingSteps(sara as never)).map(s => s.title);
    expect(titles.some(t => /^Fix 2 snags on /.test(t))).toBe(true);
    await expect(site.setSnagStatus(sara as never, s2, 'verified')).rejects.toThrow(/is open; it cannot be marked verified/);
    await site.setSnagStatus(sara as never, s2, 'fixed', 'Repainted');
    expect((await site.getSnag(s2))!).toMatchObject({ status: 'fixed', fixed_note: 'Repainted', fixed_by_name: 'Sara Site' });
    expect((await pendingSteps(youssef as never)).some(s => /^Verify 1 fixed snag on /.test(s.title))).toBe(true);
    await site.setSnagStatus(youssef as never, s2, 'open');
    expect((await site.getSnag(s2))!).toMatchObject({ status: 'open', fixed_at: null, fixed_note: '' });
    await site.setSnagStatus(sara as never, s2, 'fixed');
    await site.setSnagStatus(youssef as never, s2, 'verified');
    expect((await site.getSnag(s2))!).toMatchObject({ status: 'verified', verified_by_name: 'Youssef' });
    await expect(site.setSnagStatus(youssef as never, s2, 'cancelled')).rejects.toThrow(/is verified/);
    const s3 = await site.addSnag(youssef as never, { project, description: 'Scratch on the glass', priority: 'low' });
    await site.setSnagStatus(youssef as never, s3, 'cancelled');
    expect(await site.snagCounts(project)).toEqual({ open: 1, fixed: 0, verified: 1, cancelled: 1, outstanding: 1 });
    expect((await site.listSnags({ project, open: true })).map(s => s.snag_no)).toEqual([1]);
  });
});

describe('the handover certificate', () => {
  it('drafts only after Execution (the project moves to Handover) and signs once every snag is verified or the outstanding ones are listed', async () => {
    await expect(site.saveHandover(sara as never, project, { date: T, client_rep: 'Mr Hassan', defects_months: 12 })).rejects.toThrow(/Only the engineers or Finance/);
    await expect(site.saveHandover(youssef as never, other, { date: T, client_rep: 'x', defects_months: 12 })).rejects.toThrow(/comes after Execution/);
    await expect(site.saveHandover(youssef as never, project, { date: T, client_rep: 'x', defects_months: 'twelve' })).rejects.toThrow(/number of months/);
    await site.saveHandover(youssef as never, project, { date: T, client_rep: 'Mr Hassan', defects_months: 12, notes: 'Keys and manuals handed over' });
    const h = (await site.getHandover(project))!;
    expect(h).toMatchObject({ status: 'draft', client_rep: 'Mr Hassan', company_rep: 'Youssef', defects_months: 12 });
    expect(h.no).toMatch(/^HO-\d{5}$/);
    expect((await sql<{ phase: string }[]>`select phase from projects where id = ${project}`)[0].phase).toBe('handover');
    await expect(site.signHandover(youssef as never, project)).rejects.toThrow(/1 snag is not verified yet/);
    await site.saveHandover(adel as never, project, { date: T, client_rep: 'Mr Hassan', defects_months: 6, outstanding: 'Master bathroom drain slope, to be redone within two weeks' });
    expect((await site.getHandover(project))!.defects_months).toBe(6);
    await site.signHandover(youssef as never, project);
    const signed = (await site.getHandover(project))!;
    expect(signed).toMatchObject({ status: 'signed', snags_open: 1, signed_by_name: 'Youssef' });
    await expect(site.saveHandover(youssef as never, project, { date: T, client_rep: 'x', defects_months: 12 })).rejects.toThrow(/signed; it cannot change/);
    await expect(site.signHandover(youssef as never, project)).rejects.toThrow(/already signed/);
    expect((await sql<{ phase: string }[]>`select phase from projects where id = ${project}`)[0].phase).toBe('handover');
  });
});

describe('the Site page and the summary', () => {
  it('lists the sites (site staff see their own), and sums reports, man-days, inspections and snags', async () => {
    const rows = await site.siteRows(sara as never);
    expect(rows.map(r => r.id)).toEqual([project]);
    expect(rows[0]).toMatchObject({ mine: true, site_eng: 'Sara Site', today_id: report, today_status: 'reviewed', reports: 1, open_inspections: 0, open_snags: 1, fixed_snags: 0, handover_status: 'signed', last_report: T });
    expect((await site.siteRows(omar as never)).length).toBe(0);
    expect((await site.siteRows(youssef as never)).some(r => r.id === project)).toBe(true);
    const row = (await site.siteSummary(T.slice(0, 7))).find(r => r.id === project)!;
    expect(row).toMatchObject({ reports: 1, man_days: 5, hours: 44, inspections: 3, passed: 1, failed: 1, snags: 3, open_snags: 1, verified_snags: 1, handover: 'signed' });
    expect(await site.manpowerByTrade(project)).toEqual([{ trade: 'Plumbing', man_days: 3, hours: 24 }, { trade: 'Labour', man_days: 2, hours: 20 }]);
  });
});
