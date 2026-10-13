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

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr')[] };
const hrm: U = { id: '', email: 'haitham@x.test', name: 'Haitham HR', roles: ['hr'] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const omar: U = { id: '', email: 'omar@x.test', name: 'Omar Office', roles: [] };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [] };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 2)]);
const selfie = { name: 'selfie.jpg', body: jpeg };
const office = { lat: 31.2001, lng: 29.9187, acc: 10 }, far = { lat: 31.2100, lng: 29.9187, acc: 10 };
const t = (iso: string) => new Date(iso);
let omarEmp = '', saraEmp = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, attendance, design_sessions, attachments, payroll_runs cascade`;
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
    const id = await att.clockIn(omar as never, far, selfie, t('2026-10-13T06:40:00Z')); // 09:40 Cairo, 25 min late
    const open = await att.openRecord(omarEmp);
    expect(open).toMatchObject({ id, day: '2026-10-13', in_time: '09:40', in_place: 'unknown', late_min: 25 });
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
    await att.clockOut(omar as never, far, selfie, t('2026-10-13T15:40:00Z')); // 18:40: 9 h worked, 1:40 overtime
    const [r] = await att.listRecords({ employee: omarEmp, period: '2026-10' });
    expect(r).toMatchObject({ out_time: '18:40', worked_min: 540, overtime_min: 100, late_min: 25, out_place: 'unknown' });
    expect((await files.listAttachments('attendance', r.id)).map(f => f.tag)).toEqual(['in', 'out']);
  });
  it('once HR sets the office, office staff must be inside the radius; site staff clock in anywhere and HR sees where', async () => {
    await expect(att.saveHr(fin as never, DEFAULT_HR)).rejects.toThrow(/Only HR/);
    await att.saveHr(hrm as never, { ...DEFAULT_HR, office_lat: 31.2001, office_lng: 29.9187, office_radius_m: 150 });
    await expect(att.clockIn(omar as never, far, selfie, t('2026-10-14T06:00:00Z'))).rejects.toThrow(/1101 m from the office/);
    await expect(att.clockIn(omar as never, null, selfie, t('2026-10-14T06:00:00Z'))).rejects.toThrow(/Allow the location/);
    await att.clockIn(omar as never, { lat: 31.2005, lng: 29.9190, acc: 8 }, selfie, t('2026-10-14T06:00:00Z'));
    expect(await att.openRecord(omarEmp)).toMatchObject({ in_place: 'office', late_min: 0 });
    await att.clockIn(sara as never, far, selfie, t('2026-10-14T05:30:00Z'));
    expect(await att.openRecord(saraEmp)).toMatchObject({ in_place: 'site', in_lat: 31.21, in_lng: 29.9187 });
    await att.clockOut(sara as never, far, selfie, t('2026-10-14T13:00:00Z'));
  });
  it('HR checks a day, closes a forgotten one, and the month summary counts it all', async () => {
    const [open] = await att.listRecords({ employee: omarEmp, day: '2026-10-14' });
    await expect(att.checkRecord(fin as never, open.id, '')).rejects.toThrow(/Only HR/);
    await att.closeRecord(hrm as never, open.id, t('2026-10-14T14:00:00Z'), 'forgot to clock out'); // 17:00
    const [closed] = await att.listRecords({ employee: omarEmp, day: '2026-10-14' });
    expect(closed).toMatchObject({ out_time: '17:00', worked_min: 480, overtime_min: 0, hr_note: 'forgot to clock out', checker: 'Haitham HR' });
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

describe('design clock', () => {
  it('a designer works on one project at a time; stopping fixes the minutes and the cost from the salary', async () => {
    await expect(att.startDesign(omar as never, 'office')).rejects.toThrow(/Choose a project/);
    await att.startDesign(omar as never, 'ph-b1302', 'Concept 3D', t('2026-10-15T07:00:00Z'));
    await expect(att.startDesign(omar as never, 'ph-b1302')).rejects.toThrow(/already working on PH-B1302 since 10:00/);
    await expect(att.stopDesign(sara as never)).rejects.toThrow(/not working on a project/);
    await att.stopDesign(omar as never, t('2026-10-15T09:30:00Z')); // 150 min × 50/h = 125
    const [s] = await att.listSessions({ employee: omarEmp });
    expect(s).toMatchObject({ project_code: 'PH-B1302', minutes: 150, rate: 50, cost: 125, note: 'Concept 3D', start_time: '10:00', end_time: '12:30' });
    expect((await att.designTotals('ph-b1302'))[0]).toMatchObject({ minutes: 150, cost: 125, people: 1, open: 0 });
    expect((await att.listSessions({ project: 'ph-b1302', period: '2026-10' }))).toHaveLength(1);
  });
});
