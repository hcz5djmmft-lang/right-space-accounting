// HR employee files: personal data, Office or Site, the Employment Documents checklist with files, logins from the file, tasks for any employee.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-hr-'));
const { sql } = await import('@/lib/db');
const hr = await import('@/lib/hr');
const att = await import('@/lib/attachments');
const tasks = await import('@/lib/tasks');
const pay = await import('@/lib/payroll');
const { sentInTest } = await import('@/lib/mail');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr')[] };
const hrm: U = { id: '', email: 'haitham@x.test', name: 'Haitham HR', roles: ['hr'] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, tasks, attachments cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`delete from employees`;
  for (const u of [hrm, fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('employee files', () => {
  let sara = '', omar = '';
  it('HR creates files; codes are numbered; a woman starts with the military certificate not applicable', async () => {
    await expect(hr.saveEmployeeFile(eng as never, { name: 'X', work_location: 'office' })).rejects.toThrow(/Only HR or Finance/);
    sara = await hr.saveEmployeeFile(hrm as never, { name: 'Sara Site', job_title: 'Site engineer', project_id: 'ph-b1302', work_location: 'site', gender: 'female', phone: '0100', hire_date: '2026-09-01', contract_type: 'probation', probation_end: '2026-12-01' });
    omar = await hr.saveEmployeeFile(fin as never, { name: 'Omar Office', work_location: 'office', gender: 'male', personal_email: 'Omar@X.test' });
    await expect(hr.saveEmployeeFile(hrm as never, { name: 'Bad', work_location: 'moon' as never })).rejects.toThrow(/Office or Site/);
    const list = await hr.listEmployeeFiles();
    expect(list.map(e => [e.code, e.name, e.work_location, e.project_code])).toEqual([['E001', 'Sara Site', 'site', 'PH-B1302'], ['E002', 'Omar Office', 'office', null]]);
    expect(list[1].personal_email).toBe('omar@x.test');
    const docs = await hr.listDocuments(sara);
    expect(docs).toHaveLength(hr.DOCUMENTS.length);
    expect(docs.find(d => d.key === 'military_cert')).toMatchObject({ status: 'na' });
    expect(list[0]).toMatchObject({ docs_received: 0, docs_missing: hr.DOCUMENTS.length - 1 });
    // salary is Finance's: an HR save leaves it alone
    await pay.saveEmployee(fin as never, { id: omar, code: 'E002', name: 'Omar Office', job_title: '', basic: 9000, allowances: 1000, insurable: 0, bank_account: '', active: true });
    await hr.saveEmployeeFile(hrm as never, { id: omar, name: 'Omar Office', work_location: 'office', phone: '0111' });
    expect((await pay.getEmployee(omar))).toMatchObject({ basic: 9000, allowances: 1000 });
    expect((await hr.getEmployeeFile(omar))).toMatchObject({ phone: '0111', personal_email: null, work_location: 'office' });
  });
  it('the documents checklist is saved as a whole; received ones get a date; photographs are counted', async () => {
    const rows = hr.DOCUMENTS.map(d => ({ key: d.key, status: ['birth_cert', 'national_id', 'photographs'].includes(d.key) ? 'received' : ['driving_licence', 'military_cert'].includes(d.key) ? 'na' : 'missing', qty: d.key === 'photographs' ? 4 : null, note: d.key === 'national_id' ? '2 copies' : '' }));
    await hr.saveDocuments(hrm as never, sara, rows, '2026-10-13');
    const docs = await hr.listDocuments(sara);
    expect(docs.find(d => d.key === 'birth_cert')).toMatchObject({ status: 'received', received_on: '2026-10-13' });
    expect(docs.find(d => d.key === 'photographs')).toMatchObject({ status: 'received', qty: 4 });
    expect(docs.find(d => d.key === 'national_id')).toMatchObject({ note: '2 copies' });
    expect(docs.find(d => d.key === 'edu_cert')).toMatchObject({ status: 'missing', received_on: null });
    const [f] = (await hr.listEmployeeFiles()).filter(e => e.id === sara);
    expect(f).toMatchObject({ docs_received: 3, docs_missing: hr.DOCUMENTS.length - 5 });
    await expect(hr.saveDocuments(hrm as never, sara, [{ key: 'nope', status: 'received' }], '2026-10-13')).rejects.toThrow(/Unknown document/);
    await expect(hr.saveDocuments(eng as never, sara, [], '2026-10-13')).rejects.toThrow(/Only HR or Finance/);
  });
  it('document files are tagged with the document; only HR and Finance add, see or remove them', async () => {
    await expect(att.addAttachment(eng as never, 'employee', sara, 'id.jpg', jpeg)).rejects.toThrow(/Only HR or Finance/);
    const a = await att.addAttachment(hrm as never, 'employee', sara, 'id-front.jpg', jpeg, 'national_id');
    await att.addAttachment(fin as never, 'employee', sara, 'birth.jpg', jpeg, 'birth_cert');
    const files = await att.listAttachments('employee', sara);
    expect(files.map(f => [f.file_name, f.tag])).toEqual([['id-front.jpg', 'national_id'], ['birth.jpg', 'birth_cert']]);
    await expect(att.readAttachment(a, eng as never)).rejects.toThrow(/HR and Finance/);
    expect((await att.readAttachment(a, hrm as never))?.body.equals(jpeg)).toBe(true);
    await expect(att.removeAttachment(eng as never, a)).rejects.toThrow(/Only the person/);
    await att.removeAttachment(hrm as never, files[1].id); // HR removes Finance's upload on an employee file
    expect(await att.listAttachments('employee', sara)).toHaveLength(1);
  });
  it('HR creates a login from the file (temporary password shown once, emailed), or links an existing one', async () => {
    await expect(hr.createLogin(fin as never, sara, 'sara@x.test')).rejects.toThrow(/Only HR or Management/);
    await expect(hr.createLogin(hrm as never, sara, 'not an email')).rejects.toThrow(/valid email/);
    const r = await hr.createLogin(hrm as never, sara, 'Sara@X.test');
    expect(r.email).toBe('sara@x.test');
    expect(r.password).toHaveLength(8);
    const f = await hr.getEmployeeFile(sara);
    expect(f).toMatchObject({ login_email: 'sara@x.test', login_active: true, personal_email: 'sara@x.test' });
    const [u] = await sql`select name, roles, dept_id from users where id = ${f.user_id}`;
    expect(u).toMatchObject({ name: 'Sara Site', roles: [] });
    expect(sentInTest.at(-1)).toMatchObject({ to: ['sara@x.test'], subject: 'Your Right Space login' });
    expect(sentInTest.at(-1)!.text).toContain(r.password);
    await expect(hr.createLogin(hrm as never, sara, 'other@x.test')).rejects.toThrow(/already has a login/);
    await expect(hr.createLogin(hrm as never, omar, 'sara@x.test')).rejects.toThrow(/Link to an existing login/);
    // Omar is Omar Engineer, who already signs in
    await expect(hr.linkLogin(hrm as never, omar, f.user_id)).rejects.toThrow(/belongs to the file of Sara Site/);
    await hr.linkLogin(hrm as never, omar, eng.id);
    expect((await hr.getEmployeeFile(omar)).login_email).toBe('eng@x.test');
  });
  it('tasks are assigned to employees; the login beside it keeps "assigned to me" working', async () => {
    const people = await hr.listAssignees();
    expect(people.map(p => [p.name, p.detail])).toEqual([['Omar Office', ''], ['Sara Site', 'Site engineer'], ['Fatma Finance', 'login only'], ['Haitham HR', 'login only']]);
    const t1 = await tasks.saveTask(hrm as never, { title: 'Bring the labour office certificate', details: '', status: 'todo', priority: 'normal', ...(await hr.resolveAssignee('e:' + sara)) });
    const t2 = await tasks.saveTask(hrm as never, { title: 'Check the September bank statement', details: '', status: 'todo', priority: 'normal', ...(await hr.resolveAssignee('u:' + fin.id)) });
    await expect(hr.resolveAssignee('e:nobody')).rejects.toThrow(/no longer exists/);
    const saraUser = (await hr.getEmployeeFile(sara)).user_id!;
    expect(await tasks.getTask(t1)).toMatchObject({ assignee: 'Sara Site', assignee_emp_id: sara, assignee_id: saraUser, assignee_key: 'e:' + sara });
    expect(await tasks.getTask(t2)).toMatchObject({ assignee: 'Fatma Finance', assignee_emp_id: null, assignee_key: 'u:' + fin.id });
    expect((await tasks.listTasks({ mine: saraUser })).map(t => t.id)).toEqual([t1]);
    expect(await tasks.openForUser(saraUser)).toBe(1);
    expect(await tasks.openForUser(eng.id)).toBe(0);
    // an employee with no login can still be given a task
    const noLogin = await hr.saveEmployeeFile(hrm as never, { name: 'Ali Driver', work_location: 'site' });
    const t3 = await tasks.saveTask(hrm as never, { title: 'Driving licence copies', details: '', status: 'todo', priority: 'low', ...(await hr.resolveAssignee('e:' + noLogin)) });
    expect(await tasks.getTask(t3)).toMatchObject({ assignee: 'Ali Driver', assignee_id: null });
  });
});
