// Procurement against the test database: vendor profiles, the buyer a request is assigned to, quotations compared and
// chosen (procurement head then Management), deliveries with late ones as tasks, site stock, the material plan raised
// into a request, work orders through their approvals, committed cost against the budget, and the reports.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-pro-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const { today } = await import('@/lib/dates');
const { addDays } = await import('@/lib/planning-calc');
const pur = await import('@/lib/purchasing');
const pro = await import('@/lib/procurement');
const org = await import('@/lib/org');
const tasks = await import('@/lib/tasks');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[]; dept_id: string | null };
const ziad: U = { id: '', email: 'ziad@x.test', name: 'Ziad', roles: [], dept_id: 'fin' };
const marwan: U = { id: '', email: 'marwan@x.test', name: 'Marwan', roles: [], dept_id: 'pur' };
const omar: U = { id: '', email: 'omar@x.test', name: 'Omar Buyer', roles: [], dept_id: 'pur' };
const youssef: U = { id: '', email: 'youssef@x.test', name: 'Youssef', roles: ['engineering'], dept_id: 'eng' };
const adel: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'], dept_id: 'fin' };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'], dept_id: 'fin' };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara', roles: [], dept_id: null };
const project = 'cs-ch2505'; // GL suffix 2
const T = today();
let vendorA = '', vendorB = '', cement = '', cable = '', prq = '', quoteA = '', quoteB = '', quoteC = '', wo = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, materials, quotations, deliveries, stock_issues, work_orders, estimates, material_plan, user_positions, tasks cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`insert into departments (id, code, name) values ('pur', 'PUR', 'Purchasing') on conflict do nothing`;
  for (const u of [ziad, marwan, omar, youssef, adel, fin, sara]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${marwan.id} where id = 'pur'`;
  await sql`update departments set head_user_id = ${youssef.id} where id = 'eng'`;
  await org.savePositions(adel as never, { procurement_head: [marwan.id], procurement: [omar.id] });
  await sql`delete from approval_steps`;
  await sql`insert into approval_steps (position, name, user_ids) values (1, 'Department head', '{}'), (2, 'Management', ${[adel.id]})`;
  await sql`update settings set lock_date = null, require_approval = true where id = 1`;
  [vendorA, vendorB] = (await sql<{ id: string }[]>`insert into parties (code, type, name) values ('VC0101', 'vendor', 'Alpha Supplies'), ('VC0102', 'vendor', 'Beta Trading') returning id`).map(r => r.id);
  [cement, cable] = (await sql<{ id: string }[]>`insert into materials (code, name, unit, account_base) values ('MAT-001', 'Cement, 50 kg bag', 'bag', '28004'), ('MAT-003', 'Electrical cable 3 mm', 'roll', '24001') returning id`).map(r => r.id);
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('vendors', () => {
  it('carry categories and a rating given by Procurement, Finance or the engineers', async () => {
    await expect(pro.saveVendorProfile(sara as never, vendorA, { categories: ['Plumbing'], rating: 4 })).rejects.toThrow(/Only Procurement/);
    await expect(pro.saveVendorProfile(marwan as never, vendorA, { categories: ['Plumbing'], rating: 6 })).rejects.toThrow(/1 to 5/);
    await pro.saveVendorProfile(marwan as never, vendorA, { categories: ['Plumbing', 'Electrical', 'nonsense'], rating: 4, rating_note: 'Delivers on time' });
    await pro.saveVendorProfile(youssef as never, vendorB, { categories: ['Subcontractor'], rating: null });
    expect(await pro.getVendor(vendorA)).toMatchObject({ categories: ['Plumbing', 'Electrical'], rating: 4, rating_note: 'Delivers on time', rated_by: 'Marwan', open_pos: 0, spend: 0 });
    expect((await pro.listVendors('Electrical')).map(v => v.name)).toEqual(['Alpha Supplies']);
    expect((await pro.listVendors()).map(v => v.name)).toContain('Beta Trading');
    expect(pro.stars(4)).toBe('★★★★☆');
  });
});

describe('a purchase request with Procurement', () => {
  it('is assigned to a buyer by Procurement', async () => {
    prq = await pur.savePurchaseRequest(ziad as never, { date: T, project, neededBy: addDays(T, 10), lines: [{ material: cement, qty: 10 }, { material: cable, qty: 2 }] }, true);
    expect((await pro.procurementPeople()).map(p => p.name).sort()).toEqual(['Marwan', 'Omar Buyer']);
    await expect(pro.assignBuyer(ziad as never, prq, omar.id)).rejects.toThrow(/Only Procurement/);
    await expect(pro.assignBuyer(marwan as never, prq, sara.id)).rejects.toThrow(/Pick a person/);
    await pro.assignBuyer(marwan as never, prq, omar.id);
    expect(await pur.getPurchaseRequest(prq)).toMatchObject({ buyer_id: omar.id, buyer: 'Omar Buyer', status: 'procurement' });
  });
  it('collects quotations and compares them line by line', async () => {
    const [l1, l2] = await pur.getPurchaseLines(prq);
    await expect(pro.addQuotation(ziad as never, prq, { vendor: vendorA, date: T, prices: {} })).rejects.toThrow(/Only Procurement/);
    await expect(pro.addQuotation(omar as never, prq, { vendor: vendorA, date: T, prices: {} })).rejects.toThrow(/at least one line/);
    await expect(pro.addQuotation(omar as never, prq, { vendor: vendorA, date: 'soon', prices: { [l1.id]: 1 } })).rejects.toThrow(/quotation date/);
    quoteA = await pro.addQuotation(omar as never, prq, { vendor: vendorA, date: T, ref: 'Q-77', delivery_days: 5, vat_rate: 14, prices: { [l1.id]: 100, [l2.id]: 800 } });
    quoteB = await pro.addQuotation(omar as never, prq, { vendor: vendorB, date: T, delivery_days: 2, prices: { [l1.id]: 90, [l2.id]: 900 } });
    quoteC = await pro.addQuotation(marwan as never, prq, { vendor: vendorB, date: T, notes: 'cement only', prices: { [l1.id]: 80 } });
    const c = await pro.compareQuotations(prq);
    expect(c.quotes.map(q => [q.vendor, q.total, q.complete])).toEqual([['Alpha Supplies', 2600, true], ['Beta Trading', 2700, true], ['Beta Trading', 800, false]]);
    expect(c.lowest).toEqual({ [l1.id]: quoteC, [l2.id]: quoteA });
    expect(c.best).toBe(quoteA);
    expect((await pur.getPurchaseRequest(prq)).quotes).toBe(3);
    await pro.removeQuotation(omar as never, quoteC);
    expect((await pro.listQuotations(prq)).length).toBe(2);
  });
  it('the chosen offer sets the vendor and prices and goes to the procurement head, then Management, then it is a PO', async () => {
    await expect(pro.chooseQuotation(ziad as never, quoteA)).rejects.toThrow(/Only Procurement/);
    await pro.chooseQuotation(omar as never, quoteA);
    let r = await pur.getPurchaseRequest(prq);
    expect(r).toMatchObject({ status: 'head', approver_id: marwan.id, approver_label: 'Procurement head', vendor: 'Alpha Supplies', vat_rate: 14, subtotal: 2600, buyer_id: omar.id, delivery_date: addDays(T, 5) });
    expect((await pur.getPurchaseLines(prq)).map(l => Number(l.price))).toEqual([100, 800]);
    expect((await pro.listQuotations(prq)).find(q => q.id === quoteA)!.chosen).toBe(true);
    await expect(pro.addQuotation(omar as never, prq, { vendor: vendorB, date: T, prices: { x: 1 } })).rejects.toThrow(/while the request is with Procurement/);
    await expect(pur.approvePurchaseRequest(youssef as never, prq)).rejects.toThrow(/Procurement head/);
    expect(await pur.approvePurchaseRequest(marwan as never, prq)).toBeNull();
    expect(await pur.approvePurchaseRequest(adel as never, prq)).toBe('PO-00001');
    r = await pur.getPurchaseRequest(prq);
    expect(r).toMatchObject({ status: 'approved', po_no: 'PO-00001', delivery_date: addDays(T, 5) });
    expect((await pur.getPurchaseApprovals(prq)).map(a => a.step_name)).toEqual(['Procurement', 'Procurement head', 'Management']);
    expect((await pro.priceHistory({ material: cement })).map(p => [p.vendor, p.price, p.source])).toEqual([['Alpha Supplies', 100, 'Quotation · chosen'], ['Beta Trading', 90, 'Quotation']]);
  });
  it('when the procurement head chooses the offer, the request goes straight to Management', async () => {
    const id = await pur.savePurchaseRequest(ziad as never, { date: T, project, lines: [{ material: cable, qty: 1 }] }, true);
    const [l] = await pur.getPurchaseLines(id);
    const q = await pro.addQuotation(marwan as never, id, { vendor: vendorB, date: T, prices: { [l.id]: 850 } });
    await pro.chooseQuotation(marwan as never, q);
    expect(await pur.getPurchaseRequest(id)).toMatchObject({ status: 'management', approver_label: 'Procurement head', buyer_id: marwan.id, delivery_date: null });
    await pur.cancelPurchaseRequest(marwan as never, id);
  });
});

describe('deliveries and site stock', () => {
  it('are recorded per line, never more than ordered, and a late PO raises a task for its buyer once', async () => {
    const [l1, l2] = await pur.getPurchaseLines(prq);
    await expect(pro.recordDelivery(sara as never, prq, { date: T, lines: [{ lineId: l1.id, qty: 6 }] })).rejects.toThrow(/Only Procurement, Finance or the engineers/);
    await expect(pro.recordDelivery(youssef as never, prq, { date: T, lines: [{ lineId: l1.id, qty: 11 }] })).rejects.toThrow(/only 10 bag/);
    await pro.recordDelivery(youssef as never, prq, { date: T, ref: 'DN-1', lines: [{ lineId: l1.id, qty: 6 }] });
    let lines = await pur.getPurchaseLines(prq);
    expect(pro.deliveryState(lines)).toBe('part');
    expect(await pur.getPurchaseRequest(prq)).toMatchObject({ delivered: 600, received: 0 });
    expect((await pro.listDeliveries(prq))[0]).toMatchObject({ ref: 'DN-1', who: 'Youssef', lines: [{ qty: 6, name: 'Cement, 50 kg bag' }] });
    // the vendor promised yesterday: late
    await expect(pro.setDeliveryDate(ziad as never, prq, addDays(T, -1))).rejects.toThrow(/Only Procurement/);
    await pro.setDeliveryDate(marwan as never, prq, addDays(T, -1));
    expect(pro.lateDays({ ...(await pur.getPurchaseRequest(prq)) }, 'part')).toBe(1);
    expect(await pro.raiseLateDeliveryTasks()).toBe(1);
    expect(await pro.raiseLateDeliveryTasks()).toBe(0);
    const [t] = await tasks.listTasks({ mine: omar.id });
    expect(t).toMatchObject({ title: 'Late delivery: PO-00001 · Alpha Supplies · CS-CH2505', priority: 'high', status: 'todo', link_type: 'purchase', link_id: prq });
    expect((await pro.deliveriesDue()).map(p => [p.po_no, p.state, p.late])).toEqual([['PO-00001', 'part', 1]]);
    await pro.recordDelivery(marwan as never, prq, { date: T, lines: [{ lineId: l1.id, qty: 4 }, { lineId: l2.id, qty: 2 }] });
    lines = await pur.getPurchaseLines(prq);
    expect(pro.deliveryState(lines)).toBe('full');
    expect((await tasks.getTask(t.id)).status).toBe('done');
    expect((await pro.openPOs()).map(p => [p.po_no, p.state, p.late])).toEqual([['PO-00001', 'full', 0]]);
    expect(await pro.deliveriesDue()).toEqual([]);
    await expect(pro.recordDelivery(marwan as never, prq, { date: T, lines: [{ lineId: l1.id, qty: 1 }] })).rejects.toThrow(/only 0 bag/);
  });
  it('site stock is what was delivered less what the site used', async () => {
    expect((await pro.siteStock(project)).map(r => [r.name, r.delivered, r.used, r.on_hand])).toEqual([['Cement, 50 kg bag', 10, 0, 10], ['Electrical cable 3 mm', 2, 0, 2]]);
    await expect(pro.recordStockIssue(sara as never, project, { material: cement, qty: 3, date: T })).rejects.toThrow(/Only the site team/);
    await expect(pro.recordStockIssue(youssef as never, project, { material: cement, qty: 11, date: T })).rejects.toThrow(/only 10 bag on hand/);
    await pro.recordStockIssue(youssef as never, project, { material: cement, qty: 3, date: T, note: 'bathroom screed' });
    expect((await pro.siteStock(project)).find(r => r.material_id === cement)).toMatchObject({ used: 3, on_hand: 7 });
    expect((await pro.stockIssues(project))[0]).toMatchObject({ name: 'Cement, 50 kg bag', qty: 3, note: 'bathroom screed', who: 'Youssef' });
    expect((await pro.stockProjects()).map(p => [p.code, p.materials, p.on_hand])).toEqual([['CS-CH2505', 2, 2]]);
  });
});

describe('the material plan', () => {
  it('is raised into a purchase request as it is, creating the materials it needs', async () => {
    const [{ id: est }] = await sql<{ id: string }[]>`insert into estimates (project_id, rev, status, title, inputs) values (${project}, 0, 'accepted', 'Plan test', '{}') returning id`;
    await sql`insert into material_plan (project_id, estimate_id, calculator, key, no, description, size, brand, unit, qty, price, amount, needed_by) values
      (${project}, ${est}, 'bathroom', 'b34', '1.1', 'مواسير PPR 25 مم', '25 mm', 'Egypt Pipes', 'عود (4م)', 12, 264, 3168, ${addDays(T, 3)}),
      (${project}, ${est}, 'electrical', 'e27', '1.4', 'Electrical cable 3 mm', '', '', 'roll', 3, 6200, 18600, ${addDays(T, 9)}),
      (${project}, ${est}, 'kitchen', 'k30', '2.1', 'كوع PPR', '', '', 'pc', 20, 15, 300, null)`;
    const rows = await pro.planRows(project);
    expect(rows.map(r => [r.no, r.needed_by, r.request_id])).toEqual([['1.1', addDays(T, 3), null], ['1.4', addDays(T, 9), null], ['2.1', null, null]]);
    expect((await pro.planProjects()).find(p => p.code === 'CS-CH2505')).toMatchObject({ lines: 3, requested: 0, next_needed: addDays(T, 3), amount: 22068 });
    await expect(pro.planToRequest(sara as never, project, [rows[0].id])).rejects.toThrow(/Only Procurement or the engineers/);
    await expect(pro.planToRequest(marwan as never, project, [])).rejects.toThrow(/Tick the material plan lines/);
    const id = await pro.planToRequest(marwan as never, project, [rows[0].id, rows[1].id]);
    const r = await pur.getPurchaseRequest(id);
    expect(r).toMatchObject({ status: 'procurement', cc: 'CS-CH2505', needed_by: addDays(T, 3), buyer_id: marwan.id, notes: 'From the material plan: 1.1, 1.4' });
    const lines = await pur.getPurchaseLines(id);
    expect(lines.map(l => [l.name, Number(l.qty), l.account, l.description])).toEqual([['مواسير PPR 25 مم', 12, '24002-2', '25 mm · Egypt Pipes'], ['Electrical cable 3 mm', 3, '24001-2', '']]);
    expect(lines[1].material_id).toBe(cable);                                   // the existing material was reused
    expect((await pur.listMaterials()).find(m => m.id === lines[0].material_id)).toMatchObject({ code: 'MAT-004', unit: 'عود (4م)', account_base: '24002' });
    expect((await pro.planRows(project)).map(r => r.request_no)).toEqual([r.no, r.no, null]);
    await expect(pro.planToRequest(marwan as never, project, [rows[0].id])).rejects.toThrow(/already on a request/);
    expect((await pro.planProjects()).find(p => p.code === 'CS-CH2505')).toMatchObject({ requested: 2, next_needed: null });
  });
});

describe('work orders', () => {
  const base = { project, vendor: '', category: '2', title: 'Plumbing rough-in, two bathrooms', date: '', account: '26002-2', lines: [{ item: 'Bathroom rough-in', unit: 'bathroom', qty: 2, rate: 9000 }, { item: 'Kitchen rough-in', unit: 'lot', qty: 1, rate: 4000 }] };
  it('are checked, numbered and sent to the department head by Procurement or the engineers', async () => {
    const i = { ...base, vendor: vendorB, date: T };
    await expect(pro.saveWorkOrder(sara as never, i, false)).rejects.toThrow(/Only Procurement or the engineers/);
    await expect(pro.saveWorkOrder(marwan as never, { ...i, vendor: 'nope' }, false)).rejects.toThrow(/subcontractor/);
    await expect(pro.saveWorkOrder(marwan as never, { ...i, account: '26002-1' }, false)).rejects.toThrow(/not one of CS-CH2505's codes/);
    await expect(pro.saveWorkOrder(marwan as never, { ...i, lines: [] }, false)).rejects.toThrow(/at least one item/);
    await expect(pro.saveWorkOrder(marwan as never, { ...i, retention_pct: 120 }, false)).rejects.toThrow(/Retention is a percentage/);
    await expect(pro.saveWorkOrder(marwan as never, { ...i, start: addDays(T, 5), end: T }, false)).rejects.toThrow(/end comes before the start/);
    wo = await pro.saveWorkOrder(marwan as never, { ...i, retention_pct: '', advance_pct: 10 }, false);
    let w = (await pro.getWorkOrder(wo))!;
    expect(w).toMatchObject({ no: 'WO-00001', status: 'draft', code: 'CS-CH2505', vendor: 'Beta Trading', category: '2', amount: 22000, retention_pct: 5, advance_pct: 10, account: '26002-2' });
    expect(pro.woFigures(w)).toEqual({ amount: 22000, vat: 0, retention: 1100, advance: 2200 });
    expect(pro.woState(w)).toBe('Draft');
    wo = await pro.saveWorkOrder(marwan as never, { ...i, id: wo, vat_rate: 14, lines: [...i.lines, { item: 'Pressure test', unit: 'lot', qty: 1, rate: 500 }] }, true);
    w = (await pro.getWorkOrder(wo))!;
    expect(w).toMatchObject({ status: 'head', approver_id: youssef.id, approver_label: 'Engineering head', amount: 22500, vat_rate: 14 });
    expect((await pro.getWOLines(wo)).map(l => l.item)).toEqual(['Bathroom rough-in', 'Kitchen rough-in', 'Pressure test']);
    expect((await pro.listWorkOrders({ project })).map(x => x.no)).toEqual(['WO-00001']);
  });
  it('the department head then Management approve it, and only Procurement or Finance close it', async () => {
    await expect(pro.approveWorkOrder(marwan as never, wo)).rejects.toThrow(/waiting for Engineering head/);
    await expect(pro.saveWorkOrder(marwan as never, { ...base, id: wo, vendor: vendorB, date: T }, false)).rejects.toThrow(/Only drafts/);
    await pro.returnWorkOrder(youssef as never, wo, 'Add the water heater lines');
    expect((await pro.getWorkOrder(wo))!.status).toBe('rejected');
    await pro.saveWorkOrder(marwan as never, { ...base, id: wo, vendor: vendorB, date: T, vat_rate: 14 }, true);
    expect(await pro.approveWorkOrder(youssef as never, wo)).toBe('management');
    expect(await pro.approveWorkOrder(adel as never, wo)).toBe('approved');
    const w = (await pro.getWorkOrder(wo))!;
    expect(w).toMatchObject({ status: 'approved', approved_at: T, amount: 22000 });
    expect((await pro.getWOApprovals(wo)).map(a => a.step_name)).toEqual(['Procurement', 'Engineering head', 'Management']);
    expect((await pro.vendorOrders(vendorB)).map(o => [o.kind, o.no, o.amount])).toEqual([['WO', 'WO-00001', 22000]]);
    expect((await pro.getVendor(vendorB))!.work_orders).toBe(1);
    await expect(pro.closeWorkOrder(youssef as never, wo)).rejects.toThrow(/Only Procurement or Finance/);
    await pro.closeWorkOrder(fin as never, wo);
    expect((await pro.getWorkOrder(wo))!.status).toBe('closed');
    await pro.closeWorkOrder(marwan as never, wo, false);
    expect((await pro.getWorkOrder(wo))!.status).toBe('approved');
  });
});

describe('committed cost and the reports', () => {
  it('reads POs and work orders against the BOQ budget per GL code and flags what is over', async () => {
    const [{ id: boq }] = await sql<{ id: string }[]>`insert into boqs (project_id, file_name) values (${project}, 'Budget test') returning id`;
    await sql`insert into boq_lines (boq_id, line_no, item_no, description, unit, qty, rate, amount, account) values (${boq}, 1, '2.1', 'Plumbing labour', 'lot', 1, 20000, 20000, '26002-2'), (${boq}, 2, '1', 'Cement', 'bag', 100, 120, 12000, '28004-2'), (${boq}, 3, '3', 'Cables', 'roll', 10, 700, 7000, '24001-2')`;
    const b = await pro.committedVsBudget(project);
    expect(b.rows.map(r => [r.code, r.budget, r.po, r.wo, r.committed, r.remaining, r.over])).toEqual([
      ['24001-2', 7000, 1600, 0, 1600, 5400, false], ['26002-2', 20000, 0, 22000, 22000, -2000, true], ['28004-2', 12000, 1000, 0, 1000, 11000, false]]);
    expect(b.total).toMatchObject({ budget: 39000, po: 2600, wo: 22000, committed: 24600, over: 1 });
    expect((await pro.budgetSummary()).find(p => p.code === 'CS-CH2505')).toMatchObject({ committed: 24600, over: 1 });
  });
  it('spend and price history come from the posted vendor invoices', async () => {
    const [l1] = await pur.getPurchaseLines(prq);
    await pur.receiveInvoice(fin as never, prq, { date: T, ref: 'INV-9', vatRate: 14, whtRate: 0, lines: [{ lineId: l1.id, qty: 10, price: 100 }] });
    expect((await pro.spendByVendor(T, T)).map(r => [r.name, r.invoices, r.amount, r.vat])).toEqual([['Alpha Supplies', 1, 1000, 140]]);
    expect((await pro.spendByProject(T, T)).map(r => [r.name, r.amount])).toEqual([['CS-CH2505', 1000]]);
    expect((await pro.priceHistory({ material: cement })).find(p => p.source === 'Invoice')).toMatchObject({ vendor: 'Alpha Supplies', price: 100, ref: 'VI-00001' });
    expect((await pro.getVendor(vendorA))!.spend).toBe(1000);
    expect((await pro.committedVsBudget(project)).rows.find(r => r.code === '28004-2')).toMatchObject({ actual: 1000, committed: 1000, remaining: 11000 });
  });
});
