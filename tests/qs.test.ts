// QS and pricing against the test database: the rate table, an estimate through its calculators, the Master BOQ and
// pricing, the client's answer turning it into the contract, the budget and the material plan, and revisions.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-qs-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const q = await import('@/lib/qs');
const org = await import('@/lib/org');
const boq = await import('@/lib/boq');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management' | 'hr' | 'projects')[]; dept_id?: string };
const mgmt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'], dept_id: 'mgt' };
const mohamed: U = { id: '', email: 'mohamed@x.test', name: 'Mohamed TO', roles: ['projects'], dept_id: 'to' };
const ziad: U = { id: '', email: 'ziad@x.test', name: 'Ziad Finance', roles: ['finance'], dept_id: 'fin' };
const marwan: U = { id: '', email: 'marwan@x.test', name: 'Marwan Procurement', roles: [], dept_id: 'pur' };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [], dept_id: 'site' };
let project = '', est = '';
const form = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);
const phaseOf = async (id: string) => (await sql<{ phase: string }[]>`select phase from projects where id = ${id}`)[0].phase;

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, estimates, material_plan, user_positions, project_phases, project_info, boqs cascade`;
  await sql`delete from qs_rates where updated_by is not null`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null`;
  await sql`insert into departments (id, code, name, parent_id, roles) values ('to', 'TO', 'Technical Office', 'eng', '{engineering,projects}'), ('site', 'SITE', 'Site execution', 'eng', '{engineering,projects}') on conflict (id) do nothing`;
  for (const u of [mgmt, mohamed, ziad, marwan, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id ?? null}) returning id`)[0].id;
  await org.savePositions(mgmt as never, { procurement_head: [marwan.id], to_head: [mohamed.id] });
  project = (await sql<{ id: string }[]>`insert into projects (code, name, phase, area, created_by) values ('PH-Q1', 'QS test unit', 'qs', 120, ${mohamed.id}) returning id`)[0].id;
  await sql`insert into project_info (project_id, data) values (${project}, ${sql.json({ client_name: 'Mr Hassan', gross_area: '120', payment_terms: '40 % advance, 50 % on progress, 10 % at handover' })})`;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('the rate table', () => {
  it('starts with the workbook prices and is changed by procurement, the engineers or finance only', async () => {
    const rates = await q.getRates();
    expect(Object.keys(rates)).toHaveLength(90);
    expect(rates.b34).toBe(264);
    await expect(q.saveRates(sara as never, { b34: 300 })).rejects.toThrow(/Only Procurement/);
    await expect(q.saveRates(marwan as never, { b34: 'abc' })).rejects.toThrow(/must be a number/);
    expect(await q.saveRates(marwan as never, { b34: 300, k30: 264, nothing: 5 })).toBe(1);
    expect((await q.getRates()).b34).toBe(300);
    expect((await q.rateHistory())[0]).toMatchObject({ key: 'b34', price: 300, who: 'Marwan Procurement' });
  });
});

describe('an estimate', () => {
  it('is started by the technical office with today\'s rates and the workbook defaults', async () => {
    await expect(q.createEstimate(sara as never, project)).rejects.toThrow(/Only the engineers/);
    await expect(q.createEstimate(mohamed as never, 'office')).rejects.toThrow(/Project not found/);
    est = await q.createEstimate(mohamed as never, project);
    const e = (await q.getEstimate(est))!;
    expect(e).toMatchObject({ project_code: 'PH-Q1', rev: 0, status: 'draft', status_label: 'Being prepared', title: 'QS test unit', area: 120, editable: true });
    expect(e.inputs.bathroom.p_b34).toBe(300);                      // today's rate, not the workbook's 264
    expect(e.calc.bathroom.lines.find(l => l.key === 'b34')!.total).toBe(3000);
    expect(e.dry_cost).toBe(245091.25 + 720);                       // 10 rods × 36 more, × 2 bathrooms in item 2.1
    await expect(q.createEstimate(mohamed as never, project)).rejects.toThrow(/rev 0 is still open/);
    expect((await q.qsProjects()).map(p => p.code)).toContain('PH-Q1');
  });
  it('recalculates when a calculator is saved; blanks zero a Master BOQ line; a bad markup is refused', async () => {
    await q.saveInputs(mohamed as never, est, 'bathroom', form({ len: '3', wid: '2', basins: '2', shower_conc: '4', p_b34: '264' }));
    let e = (await q.getEstimate(est))!;
    expect(e.inputs.bathroom.len).toBe(3);
    expect(e.calc.bathroom.indicators.find(i => i.key === 'outlets')!.value).toBe(14);   // 2 basins × 2, wall WC, 4 + 2 shower, heater 2, shattaf
    expect(e.calc.bathroom.total).toBeGreaterThan(16781);
    expect(e.calc.rows.find(r => r.no === '2.1')!.rate).toBe(Math.round((e.calc.bathroom.total * 2 + 16000) * 100) / 100);
    await q.saveInputs(mohamed as never, est, 'master', form({ q_i7: '', q_i17: '150', r_i17: '95' }));
    e = (await q.getEstimate(est))!;
    expect(e.calc.rows.find(r => r.no === '1.1')!.total).toBe(0);
    expect(e.calc.rows.find(r => r.no === '4.1')!.total).toBe(14250);
    await expect(q.saveInputs(mohamed as never, est, 'pricing', form({ risk_pct: '60', margin_pct: '40' }))).rejects.toThrow(/under 95/);
    await q.saveInputs(mohamed as never, est, 'pricing', form({ bathrooms: '1', risk_pct: '10', margin_pct: '20', vat_pct: '14' }));
    e = (await q.getEstimate(est))!;
    expect(e.calc.rows.find(r => r.no === '2.1')!.rate).toBe(Math.round((e.calc.bathroom.total + 16000) * 100) / 100);
    expect(Math.abs(e.calc.pricing.client - e.calc.dry / 0.7)).toBeLessThan(1);
    expect(e.client_price).toBe(e.calc.pricing.client);
    await expect(q.saveInputs(ziad as never, est, 'master', form({}))).rejects.toThrow(/Only the engineers/);
  });
  it('goes to the client, is frozen, and the client\'s acceptance makes it the contract, the budget and the material plan', async () => {
    await expect(q.decideEstimate(mohamed as never, est, true)).rejects.toThrow(/Only an estimate that was sent/);
    await q.sendEstimate(mohamed as never, est);
    let e = (await q.getEstimate(est))!;
    expect(e.status).toBe('sent'); expect(e.editable).toBe(false);
    await expect(q.saveInputs(mohamed as never, est, 'master', form({ q_i7: '1' }))).rejects.toThrow(/sent to the client: make a new revision/);
    await expect(q.sendEstimate(mohamed as never, est)).rejects.toThrow(/already sent/);
    await expect(q.decideEstimate(sara as never, est, true)).rejects.toThrow(/Only the engineers or Finance/);
    await q.decideEstimate(ziad as never, est, true, 'Signed contract C-2026-07');
    e = (await q.getEstimate(est))!;
    expect(e).toMatchObject({ status: 'accepted', status_label: 'Accepted · contract', decision_note: 'Signed contract C-2026-07', decided_by_name: 'Ziad Finance' });
    const [p] = await sql<{ contract: number }[]>`select contract::float contract from projects where id = ${project}`;
    expect(p.contract).toBe(e.client_price);
    expect(await phaseOf(project)).toBe('planning');
    const b = await boq.boqVsActual(project);
    expect(b.boq?.file_name).toBe('Estimate rev 0');
    expect(b.total.boq).toBe(e.dry_cost);
    const lines = await boq.getBoqLines(b.boq!.id);
    expect(lines.map(l => l.item_no)).toContain('4.1');
    expect(lines.find(l => l.item_no === '1.1')).toBeUndefined();   // the zeroed item is left out
    const plan = await q.materialPlan(project);
    expect(plan.length).toBe(e.calc.materials.length);
    expect(plan.find(m => m.calculator === 'bathroom' && m.no === '1.1')).toMatchObject({ unit: 'عود (4م)', price: 264, rev: 0 });
    expect((await q.boqSummary()).find(r => r.code === 'PH-Q1')).toMatchObject({ rev: 0, status: 'accepted', revs: 1, accepted: e.client_price });
  });
  it('a new revision copies the inputs and leaves the accepted contract as it is; a declined one is superseded', async () => {
    const r1 = await q.newRevision(mohamed as never, est);
    let e1 = (await q.getEstimate(r1))!;
    expect(e1).toMatchObject({ rev: 1, status: 'draft', editable: true });
    expect(e1.inputs.bathroom.len).toBe(3);
    expect(e1.dry_cost).toBe((await q.getEstimate(est))!.dry_cost);
    expect((await q.getEstimate(est))!.status).toBe('accepted');
    await expect(q.newRevision(mohamed as never, est)).rejects.toThrow(/rev 1 is still open/);
    await q.sendEstimate(mohamed as never, r1);
    await q.decideEstimate(mohamed as never, r1, false, 'Too high');
    e1 = (await q.getEstimate(r1))!;
    expect(e1).toMatchObject({ status: 'rejected', decision_note: 'Too high', editable: true });
    const r2 = await q.newRevision(mohamed as never, r1);
    expect((await q.getEstimate(r1))!.status).toBe('superseded');
    expect((await q.getEstimate(r2))!.rev).toBe(2);
    expect((await q.listEstimates(project)).map(x => [x.rev, x.status])).toEqual([[2, 'draft'], [1, 'superseded'], [0, 'accepted']]);
    expect((await q.boqSummary()).find(r => r.code === 'PH-Q1')).toMatchObject({ rev: 2, status: 'draft', revs: 3, accepted: (await q.getEstimate(est))!.client_price });
  });
});
