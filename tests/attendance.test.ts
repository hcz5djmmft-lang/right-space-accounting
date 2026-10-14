// Clock in and out, HR checks, the timesheet into payroll, and the design clock, against the test database.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-att-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const att = await import('@/lib/attendance');
const hr = await import('@/lib/hr');
const pay = await import('@/lib/payroll');
const files = await import('@/lib/attachments');
const { DEFAULT_HR } = await import('@/lib/attendance-calc');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr' | 'projects')[] };
const hrm: U = { id: '', email: 'haitham@x.test', name: 'Haitham HR', roles: ['hr'] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const omar: U = { id: '', email: 'omar@x.test', name: 'Omar Office', roles: ['projects'] };   // a designer: the projects role offers Design and Site
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [] };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 2)]);
const selfie = { name: 'selfie.jpg', body: jpeg };
const office = { lat: 31.2001, lng: 29.9187, acc: 10 }, far = { lat: 31.2100, lng: 29.9187, acc: 10 };
const t = (iso: string) => new Date(iso);
let omarEmp = '', saraEmp = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, attendance, work_sessions, attachments, payroll_runs cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null, hr = '{}'`;
  await sql`delete from employees`;
  for (const u of [hrm, fin, omar, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  omarEmp = await hr.saveEmployeeFile(hrm as never, { name: 'Omar Office', work_location: 'office' });
  saraEmp = await hr.saveEmployeeFile(hrm as never, { name: 'Sara Site', work_location: 'site', project_id: 'ph-b1302' });
  await pay.saveEmployee(fin as never, { id: omarEmp, code: 'E001', name: 'Omar Office', job_title: '', basic: 8800, allowances: 0, insurable: 0, bank_account: '', active: true, no_deductions: true });
  await hr.linkLogin(hrm as never, omarEmp, omar.id);
  await hr.linkLogin(hrm as never, saraEmp, sara.id);
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('clock in and out', () => {
  it('needs an employee file and a selfie; without an office location set, office staff clock in anywhere', async () => {
    await expect(att.clockIn(hrm as never, office, selfie)).rejects.toThrow(/not linked to an employee file/);
    await expect(att.clockIn(omar as never, office, null)).rejects.toThrow(/selfie/);
    const { id, message } = await att.clockIn(omar as never, far, selfie, t('2026-10-13T06:40:00Z')); // 09:40 Cairo, 25 min late
    expect(message).toBe('Clocked in. Your position was recorded (accurate to about 10 m); the office location is not set yet, so it was not compared.');
    const open = await att.openRecord(omarEmp);
    expect(open).toMatchObject({ id, day: '2026-10-13', in_time: '09:40', in_place: 'unknown', late_min: 25, category: 'office', project_id: null });
    expect(await att.openSession(omarEmp)).toMatchObject({ category: 'office', project_id: null, attendance_id: id, start_time: '09:40' });
    await expect(att.clockIn(omar as never, far, selfie)).rejects.toThrow(/already clocked in since 09:40/);
    const [photo] = await files.listAttachments('attendance', id);
    expect(photo).toMatchObject({ tag: 'in', who: 'Omar Office' });
    // the person sees their own selfie, HR too, a colleague does not
    expect((await files.readAttachment(photo.id, omar as never))?.body.equals(jpeg)).toBe(true);
    expect(await files.readAttachment(photo.id, hrm as never)).toBeTruthy();
    await expect(files.readAttachment(photo.id, sara as never)).rejects.toThrow();
  });
  it('clocking out fixes worked and overtime minutes', async () => {
    await expect(att.clockOut(sara as never, office, selfie)).rejects.toThrow(/not clocked in/);
    const out = await att.clockOut(omar as never, null, selfie, t('2026-10-13T15:40:00Z')); // 18:40: 9 h worked, 1:40 overtime; the phone gave no position
    expect(out.message).toBe('Clocked out without a location: your phone did not give one. Allow the location for this site: in Safari tap aA next to the address, then Website Settings, Location, Allow.');
    const [r] = await att.listRecords({ employee: omarEmp, period: '2026-10' });
    expect(r).toMatchObject({ out_time: '18:40', worked_min: 540, overtime_min: 100, late_min: 25, out_place: 'unknown', out_lat: null });
    expect(await att.openSession(omarEmp)).toBeNull();                 // the office stretch closed with the day
    expect((await att.listSessions({ employee: omarEmp }))[0]).toMatchObject({ category: 'office', minutes: 540, end_time: '18:40' });
    expect((await files.listAttachments('attendance', r.id)).map(f => f.tag)).toEqual(['in', 'out']);
  });
  it('once HR sets the office, office staff must be inside the radius; site staff clock in anywhere and HR sees where', async () => {
    await expect(att.saveHr(fin as never, DEFAULT_HR)).rejects.toThrow(/Only HR/);
    await att.saveHr(hrm as never, { ...DEFAULT_HR, office_lat: 31.2001, office_lng: 29.9187, office_radius_m: 150 });
    await expect(att.clockIn(omar as never, far, selfie, t('2026-10-14T06:00:00Z'))).rejects.toThrow(/1101 m from the office/);
    await expect(att.clockIn(omar as never, null, selfie, t('2026-10-14T06:00:00Z'))).rejects.toThrow(/Your phone gave no location, so the system cannot see you are at the office\. Allow the location for this site: in Safari tap aA/);
    const near = { lat: 31.2005, lng: 29.9190, acc: 8 };
    expect((await att.clockIn(omar as never, near, selfie, t('2026-10-14T06:00:00Z'))).message).toBe('Clocked in at the office, 53 m from its pin (accurate to about 8 m).');
    expect(await att.openRecord(omarEmp)).toMatchObject({ in_place: 'office', late_min: 0 });
    // Sara is site staff on PH-B1302: with no pin on the project yet, a site clock-in is recorded wherever she is
    const sIn = await att.clockIn(sara as never, far, selfie, t('2026-10-14T05:30:00Z'));
    expect(sIn.message).toBe('Clocked in on site PH-B1302. Your position was recorded (accurate to about 10 m); this project has no location pin yet, so it was not compared.');
    expect(await att.openRecord(saraEmp)).toMatchObject({ in_place: 'unknown', in_lat: 31.21, in_lng: 29.9187, category: 'site', project_id: 'ph-b1302', project_code: 'PH-B1302' });   // recorded, not checked
    expect(await att.openSession(saraEmp)).toMatchObject({ category: 'site', project_code: 'PH-B1302' });
    expect((await att.clockOut(sara as never, far, selfie, t('2026-10-14T13:00:00Z'))).message).toMatch(/^Clocked out on site PH-B1302\. Your position was recorded/);
  });
  it('HR checks a day, closes a forgotten one, and the month summary counts it all', async () => {
    const [open] = await att.listRecords({ employee: omarEmp, day: '2026-10-14' });
    await expect(att.checkRecord(fin as never, open.id, '')).rejects.toThrow(/Only HR/);
    await att.closeRecord(hrm as never, open.id, t('2026-10-14T14:00:00Z'), 'forgot to clock out'); // 17:00
    const [closed] = await att.listRecords({ employee: omarEmp, day: '2026-10-14' });
    expect(closed).toMatchObject({ out_time: '17:00', worked_min: 480, overtime_min: 0, hr_note: 'forgot to clock out', checker: 'Haitham HR' });
    expect(await att.openSession(omarEmp)).toBeNull();
    expect((await att.listSessions({ employee: omarEmp }))[0]).toMatchObject({ category: 'office', minutes: 480, end_time: '17:00' });
    await expect(att.closeRecord(hrm as never, open.id, t('2026-10-14T15:00:00Z'), '')).rejects.toThrow(/already closed/);
    const [first] = await att.listRecords({ employee: omarEmp, day: '2026-10-13' });
    await att.checkRecord(hrm as never, first.id, 'late, ok');
    const rows = await att.monthSummary('2026-10');
    expect(rows.find(r => r.employee_id === omarEmp)).toMatchObject({ days: 2, late_days: 1, late_min: 25, overtime_min: 100, worked_min: 1020, unchecked: 0, open: 0, away: 0 });
    expect(rows.find(r => r.employee_id === saraEmp)).toMatchObject({ days: 1, late_min: 0, unchecked: 1 });
  });
  it('payroll fills overtime pay and the lateness deduction from the timesheet', async () => {
    // Omar: 8,800 a month = 50 an hour; overtime 100 min × 50 × 1.35 = 112.50; late 25 min × 50 = 20.83
    const feed = await att.timesheetFeed('2026-10');
    expect(feed.get(omarEmp)).toEqual({ overtime: 112.5, late: 20.83 });
    await pay.createRun(fin as never, '2026-10', '2026-10-31');
    await pay.fillFromTimesheets(fin as never, '2026-10');
    const run = await pay.getRun('2026-10');
    const line = run!.lines.find(l => l.employee_id === omarEmp)!;
    expect(line).toMatchObject({ overtime: 112.5, late: 20.83, gross: 8891.67, net: 8891.67 });
    await pay.saveRun(fin as never, '2026-10', [{ employee_id: omarEmp, overtime: 0, deductions: 100, late: 50 }]);
    expect((await pay.getRun('2026-10'))!.lines.find(l => l.employee_id === omarEmp)).toMatchObject({ overtime: 0, late: 50, deductions: 100, gross: 8750, net: 8650 });
    await pay.deleteRun(fin as never, '2026-10');
  });
});

describe('project pins', () => {
  it('a pinned project checks site clock-ins the way the office does; no pin records only', async () => {
    await expect(att.savePin(sara as never, 'ph-b1302', 31.2001, 29.9187, 100)).rejects.toThrow(/Only Engineering, Projects, HR or Finance/);
    await expect(att.savePin(hrm as never, 'ph-b1302', 31.2001, null, 100)).rejects.toThrow(/both the latitude and the longitude/);
    await expect(att.savePin(hrm as never, 'ph-b1302', 95, 29.9187, 100)).rejects.toThrow(/not a valid position/);
    await expect(att.savePin(hrm as never, 'ph-b1302', 31.2001, 29.9187, 0)).rejects.toThrow(/allowed distance/);
    await att.savePin(hrm as never, 'ph-b1302', 31.2001, 29.9187, 100);
    expect((await att.projectPins()).find(p => p.id === 'ph-b1302')).toMatchObject({ code: 'PH-B1302', pinned: true, radius: 100 });
    await expect(att.clockIn(sara as never, far, selfie, t('2026-10-15T05:30:00Z'))).rejects.toThrow(/You are about 1101 m from the PH-B1302 site \(allowed 100 m\)\. Clock in at the PH-B1302 site\./);
    await expect(att.clockIn(sara as never, null, selfie, t('2026-10-15T05:30:00Z'))).rejects.toThrow(/cannot see you are at the PH-B1302 site/);
    const r = await att.clockIn(sara as never, { lat: 31.2005, lng: 29.9190, acc: 12 }, selfie, t('2026-10-15T05:30:00Z'));
    expect(r.message).toBe('Clocked in on site PH-B1302, 53 m from the project pin (accurate to about 12 m).');
    expect(await att.openRecord(saraEmp)).toMatchObject({ in_place: 'site', category: 'site', project_code: 'PH-B1302' });
    // she switches to Office at noon and clocks out far from both: the clock-out is checked against what she is on now (the office), recorded as away, HR sees it, nothing refused
    await att.switchTo(sara as never, { category: 'office', projectId: null }, t('2026-10-15T09:00:00Z'));
    expect((await att.clockOut(sara as never, far, selfie, t('2026-10-15T13:00:00Z'))).message).toBe('Clocked out about 1101 m from the office, outside the allowed distance; HR will see it.');
    expect((await att.listRecords({ employee: saraEmp, day: '2026-10-15' }))[0]).toMatchObject({ out_place: 'away' });
    expect((await att.listSessions({ employee: saraEmp, period: '2026-10' })).map(x => [x.category, x.minutes])).toEqual([['office', 240], ['site', 210], ['site', 450]]);
    // HR closes a forgotten day at a time before the person's last switch: the stretch ends where it started, never before
    await att.clockIn(sara as never, { lat: 31.2005, lng: 29.9190, acc: 12 }, selfie, t('2026-10-16T05:00:00Z'));
    await att.switchTo(sara as never, { category: 'office', projectId: null }, t('2026-10-16T10:00:00Z'));
    const [day16] = await att.listRecords({ employee: saraEmp, day: '2026-10-16' });
    await att.closeRecord(hrm as never, day16.id, t('2026-10-16T08:00:00Z'), 'left at 11');
    expect((await att.listSessions({ employee: saraEmp, period: '2026-10' })).slice(0, 2).map(x => [x.category, x.minutes, x.end_time])).toEqual([['office', 1, '13:00'], ['site', 300, '13:00']]);
    expect(await att.openSession(saraEmp)).toBeNull();
    expect((await att.monthSummary('2026-10')).find(x => x.employee_id === saraEmp)).toMatchObject({ days: 3, away: 1 });
    await att.savePin(hrm as never, 'ph-b1302', null, null, 100);   // cleared: back to recording only
    expect((await att.projectPins()).find(p => p.id === 'ph-b1302')).toMatchObject({ pinned: false });
  });
});

describe('what the day is for', () => {
  it('a design clock-in opens a design stretch on the project; switching closes it with its minutes and cost from the salary', async () => {
    const at = t('2026-10-15T07:00:00Z');
    await expect(att.clockIn(omar as never, office, selfie, at, { category: 'design', projectId: null })).rejects.toThrow(/Choose the project/);
    await expect(att.clockIn(omar as never, office, selfie, at, { category: 'design', projectId: 'office' })).rejects.toThrow(/Choose the project/);
    await expect(att.clockIn(omar as never, office, selfie, at, { category: 'nonsense', projectId: null })).rejects.toThrow(/Choose what you are clocking in for/);
    await expect(att.clockIn(omar as never, office, selfie, at, { category: 'payments', projectId: null })).rejects.toThrow(/Choose what you are clocking in for/); // Omar is not in Finance
    const [other] = await sql<{ id: string }[]>`select id from projects where not is_office and id <> 'ph-b1302' order by code limit 1`;
    await sql`update projects set status = 'On hold' where id = ${other.id}`;
    await expect(att.clockIn(omar as never, office, selfie, at, { category: 'design', projectId: other.id })).rejects.toThrow(/Choose the project/);   // not Active any more
    await sql`update projects set status = 'Active' where id = ${other.id}`;
    // a design clock left running from before this update is closed unfinished at the next clock-in, 0 minutes, with a note
    await sql`insert into work_sessions (employee_id, project_id, category, start_at, note) values (${omarEmp}, 'ph-b1302', 'design', ${t('2026-10-12T07:00:00Z')}, 'old clock')`;
    const r = await att.clockIn(omar as never, { lat: 31.2005, lng: 29.9190, acc: 8 }, selfie, at, { category: 'design', projectId: 'ph-b1302', note: 'Concept 3D' });
    expect((await att.listSessions({ employee: omarEmp, period: '2026-10' })).find(x => x.day === '2026-10-12')).toMatchObject({ minutes: 0, cost: 0, end_time: '10:00', note: 'old clock · left running, closed unfinished at the next clock-in' });
    expect(r.message).toBe('Clocked in for design on PH-B1302 at the office, 53 m from its pin (accurate to about 8 m).');
    expect(await att.openRecord(omarEmp)).toMatchObject({ category: 'design', project_id: 'ph-b1302', in_place: 'office' });
    expect(await att.openSession(omarEmp)).toMatchObject({ category: 'design', project_code: 'PH-B1302', note: 'Concept 3D', start_time: '10:00', attendance_id: r.id });
    await expect(att.switchTo(omar as never, { category: 'design', projectId: 'ph-b1302' })).rejects.toThrow(/already on Design on PH-B1302 since 10:00/);
    await expect(att.switchTo(sara as never, { category: 'office', projectId: null })).rejects.toThrow(/Clock in first/);
    await att.switchTo(omar as never, { category: 'office', projectId: null }, t('2026-10-15T09:30:00Z')); // 150 min × 50/h = 125
    const [d] = await att.listSessions({ employee: omarEmp, category: 'design' });
    expect(d).toMatchObject({ project_code: 'PH-B1302', minutes: 150, rate: 50, cost: 125, note: 'Concept 3D', start_time: '10:00', end_time: '12:30' });
    expect(await att.openSession(omarEmp)).toMatchObject({ category: 'office', project_id: null, start_time: '12:30' });
    expect((await att.designTotals('ph-b1302'))[0]).toMatchObject({ minutes: 150, cost: 125, people: 1, open: 0 });
    expect(await att.listSessions({ project: 'ph-b1302', period: '2026-10' })).toHaveLength(5);   // Sara's three site stretches, Omar's design one and his old clock
    await att.clockOut(omar as never, { lat: 31.2005, lng: 29.9190, acc: 8 }, selfie, t('2026-10-15T14:00:00Z'));
    const mins = await att.categoryMinutes('2026-10');
    expect(mins.filter(m => m.employee_id === omarEmp)).toEqual([
      expect.objectContaining({ category: 'design', minutes: 150 }), expect.objectContaining({ category: 'office', minutes: 540 + 480 + 270 }),
    ]);
  });
  it('Finance staff get the finance categories; a wrong pick is refused', async () => {
    const [fd] = await sql<{ id: string }[]>`insert into departments (code, name) values ('FIN', 'Finance') on conflict (code) do update set name = 'Finance' returning id`;
    await sql`update employees set dept_id = ${fd.id} where id = ${omarEmp}`;
    const r = await att.clockIn(omar as never, { lat: 31.2005, lng: 29.9190, acc: 8 }, selfie, t('2026-10-18T06:00:00Z'), { category: 'payments', projectId: 'ph-b1302' });
    expect(r.message).toBe('Clocked in for payments at the office, 53 m from its pin (accurate to about 8 m).');
    expect(await att.openRecord(omarEmp)).toMatchObject({ category: 'payments', project_id: null });   // no project on a finance category
    await att.switchTo(omar as never, { category: 'reports', projectId: null }, t('2026-10-18T08:00:00Z'));
    expect((await att.listSessions({ employee: omarEmp, category: 'payments' }))[0]).toMatchObject({ minutes: 120, cost: 100 });
    await att.clockOut(omar as never, null, selfie, t('2026-10-18T14:00:00Z')).catch(() => null);
  });
});
