// Projects: the Project Information form and the phases, the Engineering sections, the org-chart positions and project files, against the test database.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-proj-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const pr = await import('@/lib/projects');
const org = await import('@/lib/org');
const files = await import('@/lib/attachments');
const { approverFor } = await import('@/lib/documents');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr' | 'projects')[]; dept_id?: string };
const mgmt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'], dept_id: 'mgt' };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'], dept_id: 'fin' };
const youssef: U = { id: '', email: 'youssef@x.test', name: 'Youssef Eng', roles: ['engineering'], dept_id: 'eng' };
const mohamed: U = { id: '', email: 'mohamed@x.test', name: 'Mohamed TO', roles: ['projects'], dept_id: 'to' };  // the section's roles, as the login merges them
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [], dept_id: 'site' };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 3)]);
let p1 = '', p2 = '';
const full = { client_name: 'Mr Hassan', title: 'Fit-out of 1402', pi_date: '2026-10-13', unit_type: 'Apartment', gross_area: 180, unit_status: 'Bare Shell', finishing_level: 'Lux', design_status: 'To Be Prepared', scope: ['painting', 'tiling'], pricing_method: 'Detailed BOQ' };

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, project_info, project_phases, user_positions, attachments cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null`;
  await sql`insert into departments (id, code, name, parent_id, roles) values ('to', 'TO', 'Technical Office', 'eng', '{engineering,projects}'), ('site', 'SITE', 'Site execution', 'eng', '{engineering,projects}') on conflict (id) do nothing`;
  await sql`update departments set head_user_id = null, parent_id = case when id in ('to','site') then 'eng' end`;
  for (const u of [mgmt, fin, youssef, mohamed, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id ?? null}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${youssef.id} where id = 'eng'`;
  await sql`update projects set phase = 'execution' where not is_office`;
  p1 = (await sql<{ id: string }[]>`insert into projects (code, name, phase, created_by) values ('PH-B1402', 'Unit 1402', 'form', ${youssef.id}) returning id`)[0].id;
  p2 = (await sql<{ id: string }[]>`insert into projects (code, name, phase, created_by) values ('CS-R77', 'Roof 77', 'form', ${youssef.id}) returning id`)[0].id;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('Engineering sections', () => {
  it('a section without a head sends its requests to the head of Engineering; with a head, to that head', async () => {
    expect(await approverFor(sql, { dept: 'to' })).toEqual({ id: youssef.id, label: 'Engineering head' });
    expect(await approverFor(sql, { dept: 'site' })).toEqual({ id: youssef.id, label: 'Engineering head' });
    expect(await approverFor(sql, { dept: 'eng' })).toEqual({ id: youssef.id, label: 'Engineering head' });
    await sql`update departments set head_user_id = ${mohamed.id} where id = 'to'`;
    expect(await approverFor(sql, { dept: 'to' })).toEqual({ id: mohamed.id, label: 'Technical Office head' });
    const tree = await org.listDepartmentTree();
    expect(tree.find(d => d.id === 'to')).toMatchObject({ parent_name: 'Engineering', label: 'Engineering › Technical Office' });
    expect(tree.find(d => d.id === 'eng')).toMatchObject({ parent_id: null, label: 'Engineering' });
  });
});

describe('the project form and the phases', () => {
  it('starts empty, is saved by an engineer, and lists what is still required', async () => {
    const empty = await pr.getInfo(p1);
    expect(empty).toMatchObject({ answered: 0, completed_at: null, rev: '' });
    expect(empty.missing).toHaveLength(10);
    await expect(pr.saveInfo(sara as never, p1, { data: { client_name: 'X' }, notes: {} })).rejects.toThrow(/Only Engineering or Finance/);
    await pr.saveInfo(mohamed as never, p1, { rev: '1', data: { client_name: 'Mr Hassan', bedrooms: 3 }, notes: { client_name: 'call after 5 pm', bedrooms: '  ', nothing: 'x' } });
    const info = await pr.getInfo(p1);
    expect(info).toMatchObject({ rev: '1', answered: 2, data: { client_name: 'Mr Hassan', bedrooms: 3 }, notes: { client_name: 'call after 5 pm', nothing: 'x' }, updated_by: 'Mohamed TO' });
    expect(info.missing).toHaveLength(9);
    await expect(pr.completeForm(mohamed as never, p1)).rejects.toThrow(/Still to answer: Project title/);
    expect((await sql<{ phase: string }[]>`select phase from projects where id = ${p1}`)[0].phase).toBe('form');
  });
  it('a complete form moves the project to Design when the design is to be prepared, else to QS and pricing', async () => {
    await pr.saveInfo(youssef as never, p1, { rev: '1', data: full, notes: {} });
    expect(await pr.completeForm(youssef as never, p1)).toBe('design');
    expect((await sql<{ phase: string }[]>`select phase from projects where id = ${p1}`)[0].phase).toBe('design');
    const info = await pr.getInfo(p1);
    expect(info).toMatchObject({ completed_by: 'Youssef Eng', missing: [] });
    expect(info.completed_at).toBeTruthy();
    expect((await pr.phaseLog(p1)).map(h => [h.label, h.who])).toEqual([['Design', 'Youssef Eng']]);
    // completing again changes nothing
    expect(await pr.completeForm(youssef as never, p1)).toBeNull();
    expect((await pr.getInfo(p1)).completed_at).toBe(info.completed_at);

    await pr.saveInfo(fin as never, p2, { data: { ...full, design_status: 'Ready', unit_type: 'Roof' }, notes: {} });
    expect(await pr.completeForm(fin as never, p2)).toBe('qs');
    expect((await pr.phaseLog(p2))[0]).toMatchObject({ label: 'QS and pricing', note: expect.stringMatching(/design is ready/) });
  });
  it('Finance or an engineer moves a project by hand, with a note; the office is not a project', async () => {
    await expect(pr.setPhase(sara as never, p1, 'planning')).rejects.toThrow(/Only Engineering or Finance/);
    await expect(pr.setPhase(youssef as never, p1, 'later')).rejects.toThrow(/Choose the phase/);
    await expect(pr.setPhase(youssef as never, p1, 'design')).rejects.toThrow(/already at Design/);
    await expect(pr.setPhase(youssef as never, 'office', 'design')).rejects.toThrow(/not found/);
    await pr.setPhase(youssef as never, p1, 'execution', 'client signed, design done outside');
    expect((await sql<{ phase: string }[]>`select phase from projects where id = ${p1}`)[0].phase).toBe('execution');
    expect((await pr.phaseLog(p1))[0]).toMatchObject({ label: 'Execution', note: 'client signed, design done outside', who: 'Youssef Eng' });
    expect(pr.phaseLabel('qs')).toBe('QS and pricing');
    const counts = await pr.phaseCounts();
    expect(counts.find(c => c.phase === 'execution')!.n).toBeGreaterThanOrEqual(1);
  });
});

describe('org-chart positions', () => {
  it('Management assigns the positions; a single position takes one person; inactive logins drop out', async () => {
    await expect(org.savePositions(youssef as never, { eng_director: [youssef.id] })).rejects.toThrow(/Only Management/);
    await expect(org.savePositions(mgmt as never, { to_head: [mohamed.id, youssef.id] })).rejects.toThrow(/one person only/);
    await org.savePositions(mgmt as never, { eng_director: [youssef.id], to_head: [mohamed.id], designer: [sara.id, mohamed.id, mohamed.id], site_eng: [sara.id], nonsense: [sara.id] });
    const h = await org.positionHolders();
    expect(h.eng_director).toEqual([{ id: youssef.id, name: 'Youssef Eng' }]);
    expect(h.designer.map(x => x.name)).toEqual(['Mohamed TO', 'Sara Site']);
    expect(h.board).toEqual([]);
    expect(await org.holdersOf('designer')).toEqual([mohamed.id, sara.id]);
    expect(await org.hasPosition(mohamed.id, 'to_head')).toBe(true);
    expect(await org.hasPosition(youssef.id, 'to_head')).toBe(false);
    expect((await org.positionsOf(mohamed.id)).sort()).toEqual(['designer', 'to_head']);
    await sql`update users set active = false where id = ${sara.id}`;
    expect(await org.holdersOf('site_eng')).toEqual([]);
    await sql`update users set active = true where id = ${sara.id}`;
    await org.savePositions(mgmt as never, { eng_director: [youssef.id] });
    expect(await org.holdersOf('designer')).toEqual([]);
  });
});

describe('project files', () => {
  it('engineers and Finance add photos and drawings by tag; everyone signed in sees them', async () => {
    await expect(files.addAttachment(sara as never, 'project', p1, 'unit.jpg', jpeg, 'photos')).rejects.toThrow(/Only Engineering or Finance/);
    const a = await files.addAttachment(mohamed as never, 'project', p1, 'unit.jpg', jpeg, 'photos');
    await files.addAttachment(fin as never, 'project', p1, 'layout.jpg', jpeg, 'layout');
    expect((await files.listAttachments('project', p1)).map(f => [f.tag, f.who])).toEqual([['photos', 'Mohamed TO'], ['layout', 'Fatma Finance']]);
    expect((await files.readAttachment(a, sara as never))?.body.equals(jpeg)).toBe(true);
    await expect(files.removeAttachment(sara as never, a)).rejects.toThrow(/Only the person who attached it/);
    await files.removeAttachment(youssef as never, a);
    expect(await files.listAttachments('project', p1)).toHaveLength(1);
  });
});
