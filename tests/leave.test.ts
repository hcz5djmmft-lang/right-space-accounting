// Leave requests through the department head and HR, pay items and loans into the payroll run, and the HR reports, against the test database.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-leave-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const hr = await import('@/lib/hr');
const leave = await import('@/lib/leave');
const pi = await import('@/lib/pay-items');
const pay = await import('@/lib/payroll');
const rep = await import('@/lib/hr-reports');
const docs = await import('@/lib/documents');
const tasks = await import('@/lib/tasks');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr')[]; dept_id?: string };
const hrm: U = { id: '', email: 'haitham@x.test', name: 'Haitham HR', roles: ['hr'], dept_id: 'adm' };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'], dept_id: 'fin' };
const youssef: U = { id: '', email: 'youssef@x.test', name: 'Youssef Eng', roles: ['engineering'], dept_id: 'eng' };
const omar: U = { id: '', email: 'omar@x.test', name: 'Omar Office', roles: [], dept_id: 'eng' };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Admin', roles: [], dept_id: 'adm' };
let omarEmp = '', saraEmp = '', first = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, attendance, design_sessions, attachments, payroll_runs, leave_requests, loans, pay_items, tasks cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null, hr = '{}'`;
  await sql`delete from employees`;
  for (const u of [hrm, fin, youssef, omar, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id ?? null}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${youssef.id} where id = 'eng'`;
  await sql`update departments set head_user_id = ${hrm.id} where id = 'adm'`;
  omarEmp = await hr.saveEmployeeFile(hrm as never, { name: 'Omar Office', work_location: 'office', dept_id: 'eng', hire_date: '2020-01-15', birth_date: '1990-06-01', contract_end: '2026-10-25' });
  saraEmp = await hr.saveEmployeeFile(hrm as never, { name: 'Sara Admin', work_location: 'office', dept_id: 'adm', hire_date: '2026-03-10', gender: 'female', probation_end: '2026-10-01' });
  await sql`update employees set basic = 8800, allowances = 0, no_deductions = true where id = ${omarEmp}`;
  await sql`update employees set basic = 6000, allowances = 600 where id = ${saraEmp}`;
  await hr.linkLogin(hrm as never, omarEmp, omar.id);
  await hr.linkLogin(hrm as never, saraEmp, sara.id);
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('leave requests', () => {
  it('a person asks from their own file; the request goes to the head of their department and counts as waiting', async () => {
    await expect(leave.requestLeave(fin as never, { type: 'annual', from: '2026-10-18', to: '2026-10-22' })).rejects.toThrow(/not linked to an employee file/);
    first = await leave.requestLeave(omar as never, { type: 'annual', from: '2026-10-18', to: '2026-10-22', reason: 'family' }); // Sunday to Thursday
    const r = await leave.getLeave(first);
    expect(r).toMatchObject({ employee_id: omarEmp, type: 'annual', type_label: 'Annual leave', days: 5, status: 'head', head_user_id: youssef.id, head_name: 'Youssef Eng', reason: 'family', dept_name: 'Engineering' });
    expect(await leave.balanceOf(omarEmp, 2026)).toEqual({ year: 2026, entitlement: 21, taken: 0, pending: 5, balance: 21, thirty: false });
  });
  it('refuses overlaps, three casual days and more than the balance; only HR files for someone else', async () => {
    await expect(leave.requestLeave(omar as never, { type: 'sick', from: '2026-10-22', to: '2026-10-25' })).rejects.toThrow(/overlap/);
    await expect(leave.requestLeave(omar as never, { type: 'casual', from: '2026-11-01', to: '2026-11-03' })).rejects.toThrow(/at most 2 days/);
    await expect(leave.requestLeave(omar as never, { type: 'annual', from: '2026-11-01', to: '2026-11-30' })).rejects.toThrow(/Only 16 days of annual leave are left/);
    await expect(leave.requestLeave(omar as never, { type: 'annual', from: '2026-12-28', to: '2027-01-03' })).rejects.toThrow(/within one year/);
    await expect(leave.requestLeave(omar as never, { employee_id: saraEmp, type: 'annual', from: '2026-11-01', to: '2026-11-02' })).rejects.toThrow(/Only HR can file leave for someone else/);
  });
  it('the head signs first, then HR; the Approvals feed shows each their step and the balance moves to taken', async () => {
    const r = await leave.getLeave(first);
    expect(leave.canDecide(fin as never, r)).toBe(false);
    expect(leave.canDecide(hrm as never, r)).toBe(false);
    await expect(leave.decideLeave(hrm as never, first, true)).rejects.toThrow(/waits for the department head/);
    expect((await leave.leaveWaitingFor(youssef as never)).map(x => x.id)).toEqual([first]);
    expect((await docs.waitingForUser(youssef as never)).some(w => w.href === `/leave/${first}` && /Leave · Department head/.test(w.type))).toBe(true);
    await leave.decideLeave(youssef as never, first, true, 'fine by me');
    expect(await leave.getLeave(first)).toMatchObject({ status: 'hr', head_signer: 'Youssef Eng', hr_signer: null, decision_note: 'fine by me' });
    await expect(leave.decideLeave(youssef as never, first, true)).rejects.toThrow(/waits for HR/);
    expect((await leave.leaveWaitingFor(youssef as never))).toHaveLength(0);
    expect((await leave.leaveWaitingFor(hrm as never)).map(x => x.id)).toEqual([first]);
    await leave.decideLeave(hrm as never, first, true);
    expect(await leave.getLeave(first)).toMatchObject({ status: 'approved', hr_signer: 'Haitham HR' });
    expect(await leave.balanceOf(omarEmp, 2026)).toMatchObject({ taken: 5, pending: 0, balance: 16 });
    await expect(leave.decideLeave(hrm as never, first, false)).rejects.toThrow(/already decided/);
  });
  it('a head who is also HR signs both steps at once; rejecting and withdrawing close a request', async () => {
    const id = await leave.requestLeave(sara as never, { type: 'casual', from: '2026-11-01', to: '2026-11-02' });
    expect(await leave.getLeave(id)).toMatchObject({ status: 'head', head_user_id: hrm.id });
    await leave.decideLeave(hrm as never, id, true);
    expect(await leave.getLeave(id)).toMatchObject({ status: 'approved', head_signer: 'Haitham HR', hr_signer: 'Haitham HR' });
    expect(await leave.balanceOf(saraEmp, 2026)).toMatchObject({ entitlement: 17, taken: 2, balance: 15 });  // hired in March: 21 × 10 / 12

    const no = await leave.requestLeave(omar as never, { type: 'annual', from: '2026-11-08', to: '2026-11-09' });
    await leave.decideLeave(youssef as never, no, false, 'site handover that week');
    expect(await leave.getLeave(no)).toMatchObject({ status: 'rejected', decision_note: 'site handover that week', head_signer: 'Youssef Eng' });
    await expect(leave.cancelLeave(omar as never, no)).rejects.toThrow(/already closed/);

    const mine = await leave.requestLeave(omar as never, { type: 'sick', from: '2026-11-15', to: '2026-11-16' });
    await expect(leave.cancelLeave(sara as never, mine)).rejects.toThrow(/Only HR can cancel/);
    await leave.cancelLeave(omar as never, mine);
    expect((await leave.getLeave(mine)).status).toBe('cancelled');
    // HR cancels an approved leave that was not taken, and HR files a paper request for someone else
    await leave.cancelLeave(hrm as never, id);
    expect(await leave.balanceOf(saraEmp, 2026)).toMatchObject({ taken: 0, balance: 17 });
    const paper = await leave.requestLeave(hrm as never, { employee_id: omarEmp, type: 'unpaid', from: '2026-11-29', to: '2026-12-02' }); // Sun, Mon, Tue, Wed
    expect(await leave.getLeave(paper)).toMatchObject({ days: 4, status: 'head', employee_id: omarEmp });
    await leave.decideLeave(youssef as never, paper, true);
    await leave.decideLeave(hrm as never, paper, true);
    expect((await leave.listLeave({ employee: omarEmp, status: ['approved'] })).map(r => r.type).sort()).toEqual(['annual', 'unpaid']);
    expect(await leave.listLeave({ year: 2026 })).toHaveLength(5);
  });
  it('unpaid days are split by month for the payroll fill', async () => {
    expect(await leave.unpaidDays('2026-11')).toEqual(new Map([[omarEmp, 2]]));
    expect(await leave.unpaidDays('2026-12')).toEqual(new Map([[omarEmp, 2]]));
    expect(await leave.unpaidDays('2026-10')).toEqual(new Map());
  });
});

describe('pay items and loans', () => {
  it('HR or Finance add the month\'s items; a loan makes its own instalments from its first month, the last one smaller', async () => {
    await expect(pi.addPayItem(omar as never, { employee_id: omarEmp, period: '2026-11', kind: 'bonus', amount: 500 })).rejects.toThrow(/Only HR or Finance/);
    await expect(pi.addPayItem(fin as never, { employee_id: omarEmp, period: '2026-11', kind: 'bonus', amount: 0 })).rejects.toThrow(/Enter the amount/);
    await pi.addPayItem(hrm as never, { employee_id: omarEmp, period: '2026-11', kind: 'bonus', amount: 500, note: 'October target' });
    await pi.addPayItem(fin as never, { employee_id: omarEmp, period: '2026-11', kind: 'penalty', amount: 100 });
    const adv = await pi.addPayItem(fin as never, { employee_id: omarEmp, period: '2026-11', kind: 'advance', amount: 200 });
    const gone = await pi.addPayItem(fin as never, { employee_id: saraEmp, period: '2026-11', kind: 'deduction', amount: 50 });
    await pi.removePayItem(fin as never, gone);
    expect((await pi.listPayItems({ period: '2026-11' })).map(i => [i.name, i.label, i.amount, i.run_period])).toEqual([
      ['Omar Office', 'Bonus', 500, null], ['Omar Office', 'Penalty', 100, null], ['Omar Office', 'Advance recovered', 200, null]]);
    expect(adv).toBeTruthy();

    await expect(pi.addLoan(fin as never, { employee_id: omarEmp, amount: 3000, monthly: 4000, start_period: '2026-11' })).rejects.toThrow(/larger than the loan/);
    await pi.addLoan(fin as never, { employee_id: omarEmp, amount: 2500, monthly: 1000, start_period: '2026-11', note: 'car repair' });
    expect(await pi.dueInstalments(fin as never, '2026-10')).toBe(0);     // not started yet
    expect(await pi.dueInstalments(fin as never, '2026-11')).toBe(1);
    expect(await pi.dueInstalments(fin as never, '2026-11')).toBe(0);     // once a month
    let [loan] = await pi.listLoans(omarEmp);
    expect(loan).toMatchObject({ amount: 2500, monthly: 1000, paid: 0, remaining: 1500, closed: false, note: 'car repair' });
    expect((await pi.listPayItems({ period: '2026-11' })).find(i => i.kind === 'loan')).toMatchObject({ amount: 1000, loan_id: loan.id });
    expect(await pi.dueInstalments(fin as never, '2026-12')).toBe(1);
    expect(await pi.dueInstalments(fin as never, '2027-01')).toBe(1);     // 500 left: the last instalment closes the loan
    expect(await pi.dueInstalments(fin as never, '2027-02')).toBe(0);
    [loan] = await pi.listLoans(omarEmp);
    expect(loan).toMatchObject({ remaining: 0, closed: true });
    expect((await pi.listPayItems({ employee: omarEmp })).filter(i => i.kind === 'loan').map(i => [i.period, i.amount])).toEqual([['2027-01', 500], ['2026-12', 1000], ['2026-11', 1000]]);
  });
  it('the payroll fill takes the items, the loan instalment and the unpaid days into the three columns', async () => {
    // Omar: 8,800 a month over 22 days = 400 a day; 2 unpaid days in November = 800 off the gross with the 100 penalty
    await pay.createRun(fin as never, '2026-11', '2026-11-30');
    await pay.fillFromRecords(fin as never, '2026-11');
    const line = (await pay.getRun('2026-11'))!.lines.find(l => l.employee_id === omarEmp)!;
    expect(line).toMatchObject({ overtime: 500, late: 900, deductions: 1200, gross: 8400, net: 7200 });
    const items = await pi.listPayItems({ period: '2026-11' });
    expect(items.every(i => i.run_period === '2026-11')).toBe(true);
    expect((await pi.listLoans(omarEmp))[0]).toMatchObject({ paid: 1000 });
    // an item can still be removed while the run is a draft, and the fill then recomputes
    await pi.removePayItem(fin as never, items.find(i => i.kind === 'penalty')!.id);
    await pay.fillFromRecords(fin as never, '2026-11');
    expect((await pay.getRun('2026-11'))!.lines.find(l => l.employee_id === omarEmp)).toMatchObject({ late: 800, gross: 8500, net: 7300 });
    await pay.deleteRun(fin as never, '2026-11');
    expect((await pi.listPayItems({ period: '2026-11' })).every(i => i.run_period === null)).toBe(true);
  });
});

describe('HR reports', () => {
  it('reminds HR of contracts and probations, missing insurance numbers and documents', async () => {
    const rows = await rep.reminders('2026-10-13');
    const of = (emp: string, kind: string) => rows.find(r => r.employee_id === emp && r.kind === kind);
    expect(of(omarEmp, 'contract')).toMatchObject({ text: 'Contract ends 2026-10-25', due: '2026-10-25', urgent: false });
    expect(of(saraEmp, 'probation')).toMatchObject({ text: 'Probation ended 2026-10-01: confirm or end the contract', urgent: true });
    expect(of(omarEmp, 'insurance')).toBeUndefined();    // no_deductions: insurance does not apply
    expect(of(saraEmp, 'insurance')).toMatchObject({ text: 'No social insurance number on the file' });
    expect(of(omarEmp, 'documents')).toMatchObject({ text: '12 employment documents missing' });
    expect(of(saraEmp, 'documents')).toMatchObject({ text: '11 employment documents missing' });  // the military certificate does not apply
    expect(of(omarEmp, 'leave')).toBeUndefined();
    expect(rows[0].urgent).toBe(true);
    expect((await rep.reminders('2026-10-20')).find(r => r.employee_id === omarEmp && r.kind === 'contract')).toMatchObject({ urgent: true });
    expect((await rep.reminders('2026-11-01')).find(r => r.employee_id === omarEmp && r.kind === 'contract')).toMatchObject({ text: 'Contract ended 2026-10-25: renew it or close the file', urgent: true });
  });
  it('shows headcount, leave balances and missing documents per employee', async () => {
    expect(await rep.headcount()).toEqual([
      { dept: 'Admin & HR', office: 1, site: 0, total: 1, with_login: 1 }, { dept: 'Engineering', office: 1, site: 0, total: 1, with_login: 1 }]);
    const bal = await rep.leaveBalances(2026);
    expect(bal.find(r => r.employee_id === omarEmp)).toMatchObject({ entitlement: 21, taken: 5, pending: 0, balance: 16, sick: 0, unpaid: 4 });
    expect(bal.find(r => r.employee_id === saraEmp)).toMatchObject({ entitlement: 17, taken: 0, balance: 17 });
    const missing = await rep.documentsMissing();
    expect(missing.find(r => r.employee_id === saraEmp)!.missing).not.toContain('Military service certificate');
    expect(missing.find(r => r.employee_id === omarEmp)!.missing).toHaveLength(12);
  });
  it('KPIs count each person\'s tasks against their due dates and their attendance in the month', async () => {
    const done = await tasks.saveTask(youssef as never, { title: 'Concept 2D', details: '', status: 'done', priority: 'normal', due: '2026-10-08', assignee_emp_id: omarEmp });
    const lateDone = await tasks.saveTask(youssef as never, { title: 'Shop drawings', details: '', status: 'done', priority: 'normal', due: '2026-10-05', assignee_emp_id: omarEmp });
    const open = await tasks.saveTask(youssef as never, { title: 'Site visit', details: '', status: 'todo', priority: 'high', due: '2026-10-10', assignee_emp_id: omarEmp });
    await tasks.saveTask(youssef as never, { title: 'Filing', details: '', status: 'doing', priority: 'normal', due: '2026-10-30', assignee_emp_id: saraEmp });
    await sql`update tasks set created_at = '2026-10-01T08:00:00Z', done_at = '2026-10-07T08:00:00Z' where id = ${done}`;
    await sql`update tasks set created_at = '2026-10-01T08:00:00Z', done_at = '2026-10-09T08:00:00Z' where id = ${lateDone}`;
    await sql`update tasks set created_at = '2026-09-20T08:00:00Z' where id = ${open}`;  // older, still open: counted in October
    await sql`insert into attendance (employee_id, day, in_at, out_at, late_min, overtime_min, worked_min) values
      (${omarEmp}, '2026-10-05', '2026-10-05T06:00Z', '2026-10-05T14:00Z', 0, 0, 480), (${omarEmp}, '2026-10-06', '2026-10-06T06:30Z', '2026-10-06T15:00Z', 30, 60, 510)`;
    const rows = await rep.kpis('2026-10', '2026-10-13');
    expect(rows.find(r => r.employee_id === omarEmp)).toMatchObject({ assigned: 3, done: 2, on_time: 1, late_done: 1, open: 1, overdue: 1, avg_days: 7, days_present: 2, late_days: 1, late_min: 30, overtime_min: 60, design_min: 0 });
    expect(rows.find(r => r.employee_id === saraEmp)).toMatchObject({ assigned: 1, done: 0, open: 1, overdue: 0, avg_days: null, days_present: 0 });
    expect((await rep.kpis('2026-09', '2026-10-13')).find(r => r.employee_id === omarEmp)).toMatchObject({ assigned: 1, open: 1, done: 0 });
  });
});
