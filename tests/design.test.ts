// The design phase against the test database: drawing sets through the three signers, the chat, the client's answer,
// shop drawings issued for construction moving the project on, the register, the finishes list and the reports.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-design-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const d = await import('@/lib/design');
const org = await import('@/lib/org');
const files = await import('@/lib/attachments');
const docs = await import('@/lib/documents');
const { today } = await import('@/lib/dates');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr' | 'projects')[]; dept_id?: string };
const mgmt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'], dept_id: 'mgt' };
const youssef: U = { id: '', email: 'youssef@x.test', name: 'Youssef Director', roles: ['engineering'], dept_id: 'eng' };
const hana: U = { id: '', email: 'hana@x.test', name: 'Hana Design Head', roles: ['projects'], dept_id: 'to' };
const mohamed: U = { id: '', email: 'mohamed@x.test', name: 'Mohamed TO Head', roles: ['projects'], dept_id: 'to' };
const dina: U = { id: '', email: 'dina@x.test', name: 'Dina Designer', roles: ['projects'], dept_id: 'to' };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [], dept_id: 'site' };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 5)]);
let project = '', concept = '', shop = '';
const phaseOf = async (id: string) => (await sql<{ phase: string }[]>`select phase from projects where id = ${id}`)[0].phase;

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, drawing_sets, set_messages, finishes, user_positions, attachments, project_phases, project_info, design_sessions cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null`;
  await sql`insert into departments (id, code, name, parent_id, roles) values ('to', 'TO', 'Technical Office', 'eng', '{engineering,projects}'), ('site', 'SITE', 'Site execution', 'eng', '{engineering,projects}') on conflict (id) do nothing`;
  await sql`update departments set head_user_id = null, parent_id = case when id in ('to','site') then 'eng' end`;
  for (const u of [mgmt, youssef, hana, mohamed, dina, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id ?? null}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${youssef.id} where id = 'eng'`;
  await org.savePositions(mgmt as never, { design_head: [hana.id], to_head: [mohamed.id], eng_director: [youssef.id], designer: [dina.id] });
  project = (await sql<{ id: string }[]>`insert into projects (code, name, phase, created_by) values ('PH-D1', 'Design test unit', 'design', ${youssef.id}) returning id`)[0].id;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('a concept set', () => {
  it('is started by a designer with the default drawings; one moving set per kind', async () => {
    await expect(d.createSet(sara as never, project, 'concept_2d')).rejects.toThrow(/Only the engineers/);
    await expect(d.createSet(dina as never, 'office', 'concept_2d')).rejects.toThrow(/Project not found/);
    concept = await d.createSet(dina as never, project, 'concept_2d');
    const s = await d.getSet(concept);
    expect(s).toMatchObject({ project_code: 'PH-D1', kind: 'concept_2d', kind_label: 'Main Concept 2D', version: 1, status: 'draft', status_label: 'Being prepared', designer: 'Dina Designer', drawings: 6, files: 0 });
    await expect(d.createSet(dina as never, project, 'concept_2d')).rejects.toThrow(/Main Concept 2D set \(v1\) is already in progress/);
    expect((await d.listSets({ project, open: true })).map(x => x.kind)).toEqual(['concept_2d']);
  });
  it('drawings are added, removed and revised while the set is being prepared; a file is needed before submitting', async () => {
    await expect(d.addDrawing(dina as never, concept, { no: 'c-01', title: 'Again' })).rejects.toThrow(/C-01 is already on this set/);
    const extra = await d.addDrawing(dina as never, concept, { no: 'c-07', title: 'Lighting concept' });
    expect((await d.listDrawings(concept)).map(w => w.no)).toContain('C-07');
    await d.removeDrawing(dina as never, extra);
    const [first] = await d.listDrawings(concept);
    const rev2 = await d.newRevision(dina as never, first.id, 'client moved the kitchen');
    expect(await d.listDrawings(concept)).toHaveLength(6);
    expect((await d.listDrawings(concept, true)).filter(w => w.no === 'C-01').map(w => [w.rev, w.superseded])).toEqual([[1, true], [2, false]]);
    await expect(d.newRevision(dina as never, first.id)).rejects.toThrow(/already superseded/);
    await expect(d.submitSet(dina as never, concept)).rejects.toThrow(/Upload at least one drawing/);
    await expect(files.addAttachment(sara as never, 'drawing', rev2, 'c01.jpg', jpeg)).rejects.toThrow(/Only Engineering or Finance/);
    await files.addAttachment(dina as never, 'drawing', rev2, 'c01.jpg', jpeg);
    await expect(d.removeDrawing(dina as never, rev2)).rejects.toThrow(/Remove its files first/);
    await d.submitSet(dina as never, concept);
    expect(await d.getSet(concept)).toMatchObject({ status: 'design_head', files: 1 });
    await expect(d.addDrawing(dina as never, concept, { no: 'C-08', title: 'x' })).rejects.toThrow(/reopen it for revision/);
  });
  it('the head of design, the technical office head and the director sign in turn; a send-back needs a note and reopens a new version', async () => {
    const s = await d.getSet(concept);
    expect(await d.canSign(hana as never, s)).toBe(true);
    expect(await d.canSign(mohamed as never, s)).toBe(false);
    expect(await d.canSign(mgmt as never, s)).toBe(true);
    await expect(d.decideSet(mohamed as never, concept, true)).rejects.toThrow(/waits for the head of design/);
    expect((await d.designWaitingFor(hana as never)).map(x => x.id)).toEqual([concept]);
    expect((await d.designWaitingFor(mohamed as never))).toHaveLength(0);
    expect((await docs.waitingForUser(hana as never)).find(w => w.href === `/design/${concept}`)).toMatchObject({ type: 'Drawing set · head of design', memo: 'Main Concept 2D v1 · 6 drawings', who: 'Dina Designer' });
    await d.decideSet(hana as never, concept, true, 'nice');
    expect(await d.getSet(concept)).toMatchObject({ status: 'to_head', design_head_signer: 'Hana Design Head' });
    await expect(d.decideSet(mohamed as never, concept, false, '')).rejects.toThrow(/Say what must change/);
    await d.decideSet(mohamed as never, concept, false, 'ceiling heights wrong');
    expect(await d.getSet(concept)).toMatchObject({ status: 'rejected', status_label: 'Sent back', decision_note: 'ceiling heights wrong', to_head_signer: 'Mohamed TO Head' });
    await expect(d.decideSet(youssef as never, concept, true)).rejects.toThrow(/not waiting for a signature/);
    await d.addDrawing(dina as never, concept, { no: 'C-07', title: 'Ceiling heights' });   // editable again while sent back
    await d.reopenSet(dina as never, concept, 'fixing the ceilings');
    expect(await d.getSet(concept)).toMatchObject({ status: 'draft', version: 2, decision_note: '', design_head_signer: null, to_head_signer: null, drawings: 7 });
    await expect(d.reopenSet(dina as never, concept)).rejects.toThrow(/already being prepared/);
    await d.submitSet(dina as never, concept);
    await d.decideSet(hana as never, concept, true);
    await d.decideSet(mohamed as never, concept, true);
    expect(await d.getSet(concept)).toMatchObject({ status: 'director' });
    expect((await docs.waitingForUser(youssef as never)).some(w => w.href === `/design/${concept}`)).toBe(true);
    await d.decideSet(youssef as never, concept, true, 'go');
    expect(await d.getSet(concept)).toMatchObject({ status: 'approved', director_signer: 'Youssef Director' });
  });
  it('the group chat is for the designer, the signers and Management; every step is noted in it', async () => {
    await expect(d.postMessage(sara as never, concept, 'hi')).rejects.toThrow(/This chat is for the designer/);
    await d.postMessage(dina as never, concept, 'Sending to the client tomorrow');
    await d.postMessage(hana as never, concept, 'ok');
    await d.postMessage(mgmt as never, concept, '');
    const msgs = await d.listMessages(concept);
    expect(msgs.slice(-2).map(m => [m.who, m.text])).toEqual([['Dina Designer', 'Sending to the client tomorrow'], ['Hana Design Head', 'ok']]);
    expect(msgs.some(m => /Sent back: ceiling heights wrong/.test(m.text))).toBe(true);
    expect(msgs.some(m => /Approved as director of engineering: go/.test(m.text))).toBe(true);
  });
  it('an approved concept goes to the client; changes reopen it, approval closes it and a new set may start', async () => {
    await expect(d.clientDecision(dina as never, concept, true)).rejects.toThrow(/not with the client/);
    await d.sendToClient(dina as never, concept);
    expect(await d.getSet(concept)).toMatchObject({ status: 'client', status_label: 'With the client' });
    await expect(d.clientDecision(dina as never, concept, false, '')).rejects.toThrow(/client's comments/);
    await d.clientDecision(dina as never, concept, false, 'bigger kitchen');
    expect(await d.getSet(concept)).toMatchObject({ status: 'draft', version: 3, client_note: 'bigger kitchen' });
    await d.submitSet(dina as never, concept);
    for (let i = 0; i < 3; i++) await d.decideSet(mgmt as never, concept, true);   // Management may sign every step
    await d.sendToClient(dina as never, concept);
    await d.clientDecision(dina as never, concept, true, 'signed');
    expect(await d.getSet(concept)).toMatchObject({ status: 'client_approved', client_by_name: 'Dina Designer' });
    expect(await phaseOf(project)).toBe('design');
    const again = await d.createSet(dina as never, project, 'concept_2d');   // a fresh set after the client's sign-off
    expect(await d.getSet(again)).toMatchObject({ version: 1, status: 'draft' });
    await sql`delete from drawing_sets where id = ${again}`;
  });
});

describe('shop drawings', () => {
  it('are approved the same way, then issued for construction by the technical office head, which moves the project to QS and pricing', async () => {
    shop = await d.createSet(dina as never, project, 'shop');
    expect(await d.getSet(shop)).toMatchObject({ drawings: 14 });
    const [w] = await d.listDrawings(shop);
    await files.addAttachment(dina as never, 'drawing', w.id, 'sd01.jpg', jpeg);
    await d.submitSet(dina as never, shop);
    await expect(d.sendToClient(dina as never, shop)).rejects.toThrow(/issued for construction, not sent/);
    await expect(d.issueForConstruction(mohamed as never, shop)).rejects.toThrow(/must be approved by the director/);
    await d.decideSet(hana as never, shop, true);
    await d.decideSet(mohamed as never, shop, true);
    await d.decideSet(youssef as never, shop, true);
    await expect(d.issueForConstruction(dina as never, shop)).rejects.toThrow(/technical office head or the director/);
    await d.issueForConstruction(mohamed as never, shop);
    expect(await d.getSet(shop)).toMatchObject({ status: 'ifc', status_label: 'Issued for construction', ifc_by_name: 'Mohamed TO Head' });
    expect((await d.listDrawings(shop)).every(x => x.issued_on === today())).toBe(true);
    expect(await phaseOf(project)).toBe('qs');
    expect((await sql<{ note: string }[]>`select note from project_phases where project_id = ${project} and phase = 'qs'`)[0].note).toMatch(/Shop drawings v1 issued/);
    await expect(d.reopenSet(dina as never, shop)).rejects.toThrow(/Issued drawings stay/);
    await expect(d.issueForConstruction(mohamed as never, concept)).rejects.toThrow(/Only shop drawings/);
  });
  it('the register lists every revision per project and the site sees only the issued ones', async () => {
    const all = await d.register(project);
    expect(all.filter(r => r.kind === 'concept_2d' && r.no === 'C-01').map(r => [r.rev, r.superseded, r.ifc])).toEqual([[2, false, false], [1, true, false]]);
    const site = await d.register(project, true);
    expect(site).toHaveLength(14);
    expect(site.every(r => r.ifc && r.kind === 'shop' && r.set_status_label === 'Issued for construction')).toBe(true);
  });
});

describe('signers without named positions', () => {
  it('fall back to the department heads, and to Management alone for the head of design', async () => {
    await org.savePositions(mgmt as never, {});
    expect(await d.signersFor('design_head')).toEqual([]);
    expect(await d.signersFor('to_head')).toEqual([youssef.id]);       // no Technical Office head: Engineering's
    expect(await d.signersFor('director')).toEqual([youssef.id]);
    await sql`update departments set head_user_id = ${mohamed.id} where id = 'to'`;
    expect(await d.signersFor('to_head')).toEqual([mohamed.id]);
    const s = { status: 'design_head' };
    expect(await d.canSign(hana as never, s)).toBe(false);
    expect(await d.canSign(mgmt as never, s)).toBe(true);
    await org.savePositions(mgmt as never, { design_head: [hana.id], to_head: [mohamed.id], eng_director: [youssef.id] });
  });
});

describe('finishes and reports', () => {
  it('finishes are proposed by the engineers and approved or rejected with the client', async () => {
    await expect(d.addFinish(sara as never, project, { area: 'Reception', item: 'Floor' })).rejects.toThrow(/Only the engineers/);
    await expect(d.addFinish(dina as never, project, { area: '', item: 'Floor' })).rejects.toThrow(/area and the item/);
    const a = await d.addFinish(dina as never, project, { area: 'Reception', item: 'Floor', material: 'Marble, Carrara', ref: 'MAR-01' });
    const b = await d.addFinish(dina as never, project, { area: 'Kitchen', item: 'Counter', material: 'Quartz' });
    const c = await d.addFinish(dina as never, project, { area: 'Kitchen', item: 'Floor', material: 'Porcelain' });
    await d.decideFinish(dina as never, a, true);
    await d.decideFinish(dina as never, b, false, 'too dear');
    await d.removeFinish(dina as never, a);   // only a proposal can be removed
    await d.removeFinish(dina as never, c);
    expect((await d.listFinishes(project)).map(f => [f.area, f.item, f.status, f.note])).toEqual([['Kitchen', 'Counter', 'rejected', 'too dear'], ['Reception', 'Floor', 'approved', '']]);
  });
  it('the status report says where each moving set stands and for how long; hours and cost stand against the design fee', async () => {
    const open = await d.createSet(dina as never, project, 'concept_3d');
    const rows = await d.designStatus();
    expect(rows.map(r => r.id)).toEqual([open]);
    expect(rows[0]).toMatchObject({ project_code: 'PH-D1', kind_label: 'Main Concept 3D', step: 'Being prepared', waiting_days: 0, signers: '' });
    const [w] = await d.listDrawings(open);
    await files.addAttachment(dina as never, 'drawing', w.id, 'v01.jpg', jpeg);
    await d.submitSet(dina as never, open);
    await sql`update drawing_sets set step_at = now() - interval '4 days' where id = ${open}`;
    expect((await d.designStatus())[0]).toMatchObject({ step: 'With the head of design', waiting_days: 4, signers: 'Hana Design Head' });
    await sql`update projects set design_fee = 50000 where id = ${project}`;
    const fee = await d.designHoursVsFee();
    expect(fee.find(r => r.project_id === project)).toMatchObject({ code: 'PH-D1', design_fee: 50000, minutes: 0, cost: 0, people: 0 });
  });
});
