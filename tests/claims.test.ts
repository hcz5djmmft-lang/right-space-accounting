// Progress claims and cost control against the test database: the figures of his claim form, a subcontractor's claims through
// the site engineer, Procurement and Finance (payment request), client claims against the BOQ and the invoice, variation orders
// into the BOQ and the contract, budget alerts as tasks, samples, and the registers.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-clm-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const { today } = await import('@/lib/dates');
const cl = await import('@/lib/claims');
const pro = await import('@/lib/procurement');
const org = await import('@/lib/org');
const d = await import('@/lib/design');
const { pendingSteps } = await import('@/lib/pending');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[]; dept_id: string | null };
const ziad: U = { id: '', email: 'ziad@x.test', name: 'Ziad', roles: ['finance'], dept_id: 'fin' };
const marwan: U = { id: '', email: 'marwan@x.test', name: 'Marwan', roles: [], dept_id: 'pur' };
const omar: U = { id: '', email: 'omar@x.test', name: 'Omar Buyer', roles: [], dept_id: 'pur' };
const youssef: U = { id: '', email: 'youssef@x.test', name: 'Youssef', roles: ['engineering'], dept_id: 'eng' };
const adel: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'], dept_id: 'fin' };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [], dept_id: null };
const project = 'cs-ch2505'; // GL suffix 2
const T = today();
let vendor = '', wo = '', claim1 = '', claim2 = '', cc1 = '', cc2 = '', vo1 = '', boqLines: { id: string; item_no: string }[] = [];

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, materials, quotations, deliveries, stock_issues, work_orders, estimates, material_plan, user_positions, tasks, sub_claims, client_claims, variation_orders, budget_alerts, finishes, boqs cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`insert into departments (id, code, name) values ('pur', 'PUR', 'Purchasing') on conflict do nothing`;
  await sql`insert into departments (id, code, name, parent_id, roles) values ('site', 'SITE', 'Site execution', 'eng', '{engineering,projects}') on conflict (id) do nothing`;
  for (const u of [ziad, marwan, omar, youssef, adel, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${marwan.id} where id = 'pur'`;
  await sql`update departments set head_user_id = ${youssef.id} where id = 'eng'`;
  await org.savePositions(adel as never, { procurement_head: [marwan.id], procurement: [omar.id], cost_control: [youssef.id], site_eng: [sara.id] });
  const saraEmp = (await sql<{ id: string }[]>`insert into employees (name, user_id, dept_id, basic, job_title) values ('Sara Site', ${sara.id}, 'site', 9000, 'Site engineer') returning id`)[0].id;
  await sql`update projects set site_eng_id = ${saraEmp}, contract = 39000, status = 'Active' where id = ${project}`;
  let [client] = await sql<{ id: string }[]>`select id from parties where type = 'customer' limit 1`;
  if (!client) [client] = await sql<{ id: string }[]>`insert into parties (code, type, name) values ('CU0101', 'customer', 'Mr Hassan') returning id`;
  await sql`update projects set client_id = ${client.id} where id = ${project}`;
  await sql`insert into project_info (project_id, data) values (${project}, ${sql.json({ retention_pct: '10' })}) on conflict (project_id) do update set data = excluded.data`;
  await sql`insert into accounts (code, name, type) values ('R111', 'Design revenue', 'revenue'), ('R112', 'Fit-out revenue', 'revenue'), ('R113', 'Furniture revenue', 'revenue') on conflict (code) do nothing`;
  await sql`insert into collection_types (id, name, name_ar, account, sort) values ('design', 'Design', 'تصميم', 'R111', 1), ('fitout', 'Fit-out', 'تنفيذ', 'R112', 2), ('furniture', 'Furniture', 'أثاث', 'R113', 3) on conflict (id) do nothing`;
  await sql`delete from approval_steps`;
  await sql`insert into approval_steps (position, name, user_ids) values (1, 'Department head', '{}'), (2, 'Management', ${[adel.id]})`;
  await sql`update settings set lock_date = null, require_approval = true where id = 1`;
  [{ id: vendor }] = await sql<{ id: string }[]>`insert into parties (code, type, name) values ('VC0105', 'vendor', 'Nile Plumbing Co') returning id`;
  const [boq] = await sql<{ id: string }[]>`insert into boqs (project_id, file_name) values (${project}, 'Estimate rev 0') returning id`;
  boqLines = await sql<{ id: string; item_no: string }[]>`insert into boq_lines (boq_id, line_no, item_no, description, unit, qty, rate, amount, account) values
    (${boq.id}, 1, '2.1', 'Plumbing labour', 'lot', 1, 20000, 20000, '26002-2'), (${boq.id}, 2, '1', 'Cement', 'bag', 100, 120, 12000, '28004-2'), (${boq.id}, 3, '3', 'Cables', 'roll', 10, 700, 7000, '24001-2') returning id::text id, item_no`;
  // an issued work order to claim against
  wo = await pro.saveWorkOrder(marwan as never, { project, vendor, category: '2', title: 'Plumbing rough-in', date: T, account: '26002-2', retention_pct: 5, advance_pct: 0, vat_rate: 0,
    lines: [{ item: 'Bathroom rough-in', unit: 'bathroom', qty: 2, rate: 9000 }, { item: 'Kitchen rough-in', unit: 'kitchen', qty: 1, rate: 4000 }] }, true);
  await pro.approveWorkOrder(youssef as never, wo);
  await pro.approveWorkOrder(adel as never, wo);
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('the figures of the claim form', () => {
  it('amount = execution % × cumulative × rate; net = gross less previously paid, advance and retention on the cumulative work', () => {
    const l1 = [{ rate: 100, current_qty: 3, previous_qty: 2, pct: 100 }];
    expect(cl.cumQty(l1[0])).toBe(5);
    expect(cl.claimLineAmount({ rate: 100, current_qty: 3, previous_qty: 2, pct: 50 })).toBe(250);
    const f1 = cl.claimFigures(l1, { retention_pct: 5, advance: 0 });
    expect(f1).toMatchObject({ gross: 500, previously_paid: 0, advance_cum: 0, retention: 25, deductions: 25, net: 475, period_work: 500, period_retention: 25 });
    // the second claim: cumulative 7 at 100; the first claim's net was paid
    const f2 = cl.claimFigures([{ rate: 100, current_qty: 2, previous_qty: 5, pct: 100 }], { retention_pct: 5, advance: 30 }, { gross: 500, retention: 25, advance: 0, net: 475, claimId: 'x' });
    expect(f2).toMatchObject({ gross: 700, previously_paid: 475, advance: 30, advance_cum: 30, retention: 35, deductions: 540, net: 160, period_work: 200, period_retention: 10 });
    expect(f2.net).toBe(f2.period_work - f2.period_retention - f2.advance);
  });
});

describe('a subcontractor claim', () => {
  it('starts from the work order items and is certified by the site engineer', async () => {
    const t = await cl.claimTemplate(project, vendor, wo);
    expect(t.claim_no).toBe(1);
    expect(t.retention_pct).toBe(5);
    expect(t.account).toBe('26002-2');
    expect(t.lines.map(l => [l.item, l.rate, l.previous_qty])).toEqual([['Bathroom rough-in', 9000, 0], ['Kitchen rough-in', 4000, 0]]);
    const lines = t.lines.map((l, i) => ({ ...l, current_qty: 1, pct: i === 1 ? 50 : 100 }));
    await expect(cl.saveSubClaim(ziad as never, { project, work_order: wo, date: T, lines })).rejects.toThrow(/Only the engineers or Procurement/);
    await expect(cl.saveSubClaim(sara as never, { project, work_order: wo, date: 'soon', lines })).rejects.toThrow(/Pick the date/);
    claim1 = await cl.saveSubClaim(sara as never, { project, work_order: wo, date: T, trade: 'اعمال السباكة', retention_pct: t.retention_pct, account: t.account, lines });
    const full = (await cl.subClaimFull(claim1))!;
    expect(full.c).toMatchObject({ no: 'SC-00001', status: 'draft', claim_no: 1, vendor: 'Nile Plumbing Co', wo_no: 'WO-00001', gross: 11000 });
    expect(full.fig).toMatchObject({ gross: 11000, retention: 550, previously_paid: 0, net: 10450, period_work: 11000 });
    await expect(cl.submitSubClaim(omar as never, claim1)).rejects.toThrow(/Only the engineers certify/);
    await cl.submitSubClaim(sara as never, claim1);
    expect((await cl.getSubClaim(claim1))!.status).toBe('pricing');
    expect((await cl.claimsWaitingFor(marwan as never)).map(c => c.no)).toEqual(['SC-00001']);
    expect(await cl.claimsWaitingFor(ziad as never)).toEqual([]);
  });
  it('is priced by Procurement and sent to Finance, who raises the payment request with the retention and the period work', async () => {
    await expect(cl.priceSubClaim(ziad as never, claim1, { rates: {}, send: true })).rejects.toThrow(/Only Procurement prices/);
    await expect(cl.raisePaymentRequest(ziad as never, claim1)).rejects.toThrow(/Only a priced claim/);
    const lines = await cl.getSubClaimLines(claim1);
    await cl.priceSubClaim(marwan as never, claim1, { rates: { [lines[0].id]: 9000, [lines[1].id]: 4000 }, account: '26002-2', send: true });
    const c = (await cl.getSubClaim(claim1))!;
    expect(c.status).toBe('finance');
    expect(c.priced_by_name).toBe('Marwan');
    expect((await cl.claimsWaitingFor(ziad as never)).map(x => x.no)).toEqual(['SC-00001']);
    await expect(cl.raisePaymentRequest(youssef as never, claim1)).rejects.toThrow(/Only Finance/);
    const reqId = await cl.raisePaymentRequest(ziad as never, claim1);
    const [req] = await sql<{ no: string; status: string; subtotal: number; retention: number; dp_amount: number; net: number; party_id: string; project_id: string; requester: string }[]>`
      select no, status, subtotal::float subtotal, retention::float retention, dp_amount::float dp_amount, net::float net, party_id, project_id, requester from invoices where id = ${reqId}`;
    expect(req).toMatchObject({ status: 'draft', subtotal: 11000, retention: 550, dp_amount: 0, net: 10450, party_id: vendor, project_id: project, requester: 'Sara Site' });
    const rl = await sql<{ description: string; price: number; account: string }[]>`select description, price::float price, account from invoice_lines where invoice_id = ${reqId} order by line_no`;
    expect(rl.map(l => [l.price, l.account])).toEqual([[9000, '26002-2'], [2000, '26002-2']]);
    expect(rl[0].description).toMatch(/SC-00001 · Bathroom rough-in · 1 bathroom to date/);
    const after = (await cl.getSubClaim(claim1))!;
    expect(after).toMatchObject({ status: 'requested', request_id: reqId });
    expect(cl.claimState(after)).toBe('Payment request raised');
    await expect(cl.cancelSubClaim(sara as never, claim1)).rejects.toThrow(/payment request was raised/);
  });
  it('the next claim carries the previous quantities, deducts what was paid, and can be returned to the engineer', async () => {
    const t = await cl.claimTemplate(project, vendor, wo);
    expect(t.claim_no).toBe(2);
    expect(t.prev).toMatchObject({ gross: 11000, retention: 550, advance: 0, net: 10450, claimId: claim1 });
    expect(t.lines.map(l => [l.item, l.previous_qty, l.pct])).toEqual([['Bathroom rough-in', 1, 100], ['Kitchen rough-in', 1, 50]]);
    const lines = [{ ...t.lines[0], current_qty: 1 }, { ...t.lines[1], current_qty: 0, pct: 100 }];
    claim2 = await cl.saveSubClaim(sara as never, { project, work_order: wo, date: T, lines });
    await cl.submitSubClaim(sara as never, claim2);
    await expect(cl.returnSubClaim(ziad as never, claim2, 'no')).rejects.toThrow(/Only the person the claim is waiting for/);
    await cl.returnSubClaim(marwan as never, claim2, 'Kitchen is not finished');
    expect((await cl.getSubClaim(claim2))!.status).toBe('returned');
    await cl.saveSubClaim(sara as never, { id: claim2, project, work_order: wo, date: T, lines });
    await cl.submitSubClaim(sara as never, claim2);
    const full = (await cl.subClaimFull(claim2))!;
    expect(full.fig).toMatchObject({ gross: 22000, previously_paid: 10450, advance_cum: 0, retention: 1100, deductions: 11550, net: 10450, period_work: 11000, period_retention: 550 });
    await cl.priceSubClaim(marwan as never, claim2, { rates: {}, send: true });
    const reqId = await cl.raisePaymentRequest(ziad as never, claim2);
    const [req] = await sql<{ subtotal: number; retention: number; net: number }[]>`select subtotal::float subtotal, retention::float retention, net::float net from invoices where id = ${reqId}`;
    expect(req).toEqual({ subtotal: 11000, retention: 550, net: 10450 });
    expect((await sql<{ price: number }[]>`select price::float price from invoice_lines where invoice_id = ${reqId} order by line_no`).map(l => l.price)).toEqual([9000, 2000]);
  });
  it('refuses a claim with nothing done and one whose deductions eat the amount', async () => {
    const t = await cl.claimTemplate(project, vendor, wo);
    const id = await cl.saveSubClaim(sara as never, { project, work_order: wo, date: T, lines: t.lines });
    await expect(cl.submitSubClaim(sara as never, id)).rejects.toThrow(/Nothing was done this period/);
    await cl.saveSubClaim(sara as never, { id, project, work_order: wo, date: T, advance: 50000, account: t.account, lines: [{ ...t.lines[0], current_qty: 0.5 }] });
    await cl.submitSubClaim(sara as never, id);
    await expect(cl.priceSubClaim(marwan as never, id, { rates: {}, send: true })).rejects.toThrow(/Nothing is payable/);
    await cl.cancelSubClaim(sara as never, id);
    expect((await cl.getSubClaim(id))!.status).toBe('cancelled');
  });
});

describe('a client claim against the BOQ', () => {
  it('certifies the % done per BOQ line with the project form retention and is invoiced by Finance for the period', async () => {
    const t = await cl.clientClaimTemplate(project);
    expect(t).toMatchObject({ claim_no: 1, retention_pct: 10 });
    expect(t.lines.map(l => [l.item_no, l.amount, l.prev_pct])).toEqual([['2.1', 20000, 0], ['1', 12000, 0], ['3', 7000, 0]]);
    await expect(cl.saveClientClaim(omar as never, { project, date: T, pcts: {} })).rejects.toThrow(/Only the engineers or Finance/);
    await expect(cl.saveClientClaim(sara as never, { project, date: T, pcts: { [boqLines[0].id]: 150 } })).rejects.toThrow(/from 0 to 100/);
    cc1 = await cl.saveClientClaim(sara as never, { project, date: T, retention_pct: t.retention_pct, pcts: { [boqLines[0].id]: 50 } });
    const full = (await cl.clientClaimFull(cc1))!;
    expect(full.c).toMatchObject({ no: 'CC-00001', status: 'draft', claim_no: 1, client: 'Mr Hassan', contract: 39000 });
    expect(full.fig).toMatchObject({ gross: 10000, retention: 1000, previously_paid: 0, net: 9000, period_work: 10000 });
    await expect(cl.invoiceClientClaim(ziad as never, cc1, { category: 'fitout', vatRate: 14 })).rejects.toThrow(/Only a certified claim/);
    await cl.certifyClientClaim(sara as never, cc1);
    expect((await pendingSteps(ziad as never)).some(s => /Invoice the client for claim CC-00001/.test(s.title))).toBe(true);
    await expect(cl.invoiceClientClaim(youssef as never, cc1, { category: 'fitout', vatRate: 14 })).rejects.toThrow(/Only Finance/);
    const inv = await cl.invoiceClientClaim(ziad as never, cc1, { category: 'fitout', vatRate: 14 });
    const [i] = await sql<{ kind: string; status: string; subtotal: number; vat: number; total: number; category: string; project_id: string }[]>`select kind, status, subtotal::float subtotal, vat::float vat, total::float total, category, project_id from invoices where id = ${inv}`;
    expect(i).toEqual({ kind: 'sales', status: 'draft', subtotal: 10000, vat: 1400, total: 11400, category: 'fitout', project_id: project });
    const c = (await cl.getClientClaim(cc1))!;
    expect(c).toMatchObject({ status: 'invoiced', invoice_id: inv });
    expect(cl.clientClaimState(c)).toBe('Invoice drafted');
    await expect(cl.cancelClientClaim(sara as never, cc1)).rejects.toThrow(/void the invoice first/);
  });
});

describe('variation orders', () => {
  it('join the BOQ and the contract when the client approves', async () => {
    await expect(cl.saveVariation(omar as never, { project, title: 'x', date: T, lines: [{ description: 'a', qty: 1, rate: 1 }] })).rejects.toThrow(/Only the engineers or Finance/);
    vo1 = await cl.saveVariation(youssef as never, { project, title: 'Extra kitchen cabinets', date: T, client_ref: 'Email 2026-10-12', lines: [{ description: 'Extra cabinets', unit: 'lot', qty: 1, rate: 5000, account: '28004-2' }] });
    expect(await cl.getVariation(vo1)).toMatchObject({ no: 'VO-00001', status: 'draft', total: 5000 });
    await cl.sendVariation(youssef as never, vo1);
    await cl.decideVariation(ziad as never, vo1, true);
    const v = (await cl.getVariation(vo1))!;
    expect(v).toMatchObject({ status: 'approved', decided_by_name: 'Ziad' });
    const added = await sql<{ item_no: string; amount: number; account: string; vo_id: string }[]>`select item_no, amount::float amount, account, vo_id from boq_lines l join boqs b on b.id = l.boq_id where b.project_id = ${project} and l.vo_id is not null`;
    expect(added).toEqual([{ item_no: 'VO-00001.1', amount: 5000, account: '28004-2', vo_id: vo1 }]);
    expect((await sql<{ contract: number }[]>`select contract::float contract from projects where id = ${project}`)[0].contract).toBe(44000);
    await expect(cl.cancelVariation(youssef as never, vo1)).rejects.toThrow(/part of the contract/);
    const t = await cl.clientClaimTemplate(project);
    expect(t.lines.map(l => l.item_no)).toEqual(['2.1', '1', '3', 'VO-00001.1']);
  });
  it('the next client claim cannot go below the previous % and deducts what was certified', async () => {
    await expect(cl.saveClientClaim(sara as never, { project, date: T, pcts: { [boqLines[0].id]: 40 } })).rejects.toThrow(/less than the 50 % already certified/);
    cc2 = await cl.saveClientClaim(sara as never, { project, date: T, retention_pct: 10, pcts: { [boqLines[0].id]: 100, [boqLines[1].id]: 50 } });
    const full = (await cl.clientClaimFull(cc2))!;
    expect(full.c.claim_no).toBe(2);
    expect(full.fig).toMatchObject({ gross: 26000, previously_paid: 9000, retention: 2600, net: 14400, period_work: 16000, period_retention: 1600 });
    await cl.certifyClientClaim(sara as never, cc2);
    expect((await cl.getClientClaim(cc2))!.status).toBe('certified');
  });
});

describe('budget alerts', () => {
  it('raise one high task for Cost control per code over budget and close it when the code is back within budget', async () => {
    // 26002-2: BOQ 20000, the issued work order commits 22000
    expect((await pro.committedVsBudget(project)).rows.find(r => r.code === '26002-2')).toMatchObject({ budget: 20000, wo: 22000, over: true });
    expect(await cl.raiseBudgetAlerts(adel as never)).toBe(1);
    const alerts = await cl.budgetAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ code: '26002-2', over_by: 2000, assignee: 'Youssef', task_status: 'todo' });
    const [task] = await sql<{ title: string; priority: string; assignee_id: string; link_type: string; link_id: string }[]>`select title, priority, assignee_id, link_type, link_id from tasks where id = ${alerts[0].task_id!}`;
    expect(task).toMatchObject({ priority: 'high', assignee_id: youssef.id, link_type: 'cost-center', link_id: project });
    expect(task.title).toMatch(/Over budget: 26002-2 .* by EGP 2,000\.00/);
    expect(await cl.raiseBudgetAlerts(adel as never)).toBe(0);
    // a variation order on the same code lifts the budget to 23000
    const vo2 = await cl.saveVariation(youssef as never, { project, title: 'Second bathroom', date: T, lines: [{ description: 'Plumbing of the second bathroom', qty: 1, rate: 3000, account: '26002-2' }] });
    await cl.decideVariation(youssef as never, vo2, true);
    expect(await cl.raiseBudgetAlerts(adel as never)).toBe(0);
    expect(await cl.budgetAlerts()).toEqual([]);
    expect((await sql<{ status: string }[]>`select status from tasks where id = ${alerts[0].task_id!}`)[0].status).toBe('done');
  });
});

describe('samples', () => {
  it('go to the client with a photo and are answered before they are bought', async () => {
    const id = await d.addFinish(youssef as never, project, { area: 'Reception', item: 'Floor', material: 'Marble, Carrara' });
    expect(await d.pendingSamples(project)).toBe(1);
    await expect(d.sendSample(omar as never, id)).rejects.toThrow(/Only the engineers/);
    await d.sendSample(youssef as never, id, 'S-01');
    const [s] = await d.listSamples({ project, open: true });
    expect(s).toMatchObject({ status: 'sent', sample_ref: 'S-01', area: 'Reception', photos: 0 });
    expect(s.sent_at).toBe(T);
    expect((await pendingSteps(youssef as never)).some(x => /sample Reception · Floor/.test(x.title))).toBe(true);
    await expect(d.sendSample(youssef as never, id)).rejects.toThrow(/already sent or decided/);
    await d.decideFinish(youssef as never, id, true, 'Client liked it');
    expect(await d.pendingSamples(project)).toBe(0);
    expect(await d.listSamples({ project, open: true })).toEqual([]);
    expect((await d.listSamples({ project }))[0]).toMatchObject({ status: 'approved', note: 'Client liked it' });
  });
});

describe('registers', () => {
  it('sum the client and subcontractor claims, the variations per project and the workload', async () => {
    const [sub] = await cl.subRegister();
    expect(sub).toMatchObject({ vendor: 'Nile Plumbing Co', wo_no: 'WO-00001', claims: 2, claimed: 22000, certified: 22000, paid: 0, retention: 1100 });
    const [client] = await cl.clientRegister();
    expect(client).toMatchObject({ contract: 47000, claims: 2, claimed: 26000, certified: 26000, invoiced: 0, collected: 0, retention: 2600 });
    const [vo] = await cl.variationsByProject();
    expect(vo).toMatchObject({ orders: 2, approved: 2, approved_total: 8000, pending: 0, declined: 0 });
    const work = await cl.toWorkload();
    const y = work.find(w => w.user_id === youssef.id)!;
    expect(y).toMatchObject({ open: 0, done_90: 1, positions: 'cost_control' });
    expect(work.find(w => w.user_id === sara.id)).toMatchObject({ positions: 'site_eng', open: 0 });
  });
});
