// Update 20 against the test database: sales invoices approved by Finance, Engineering and Management before they post;
// a new project asks the accountant for its sales invoice; vendor invoices recorded first (a service with no PO) and
// picked by a payment request numbered CIB-34-; petty cash approved by the head, then Management; heads give tasks;
// the logins planned from the staff sheet; and every home dashboard reads without error.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, generateVAPIDKeys: () => ({ publicKey: 'p', privateKey: 'k' }), sendNotification: async () => ({}) } }));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const sales = await import('@/lib/sales');
const ap = await import('@/lib/ap-invoices');
const docs = await import('@/lib/documents');
const petty = await import('@/lib/petty-docs');
const home = await import('@/lib/home');
const { planStaff } = await import('@/lib/staff-plan');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[]; access?: string[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Zeyad Finance', roles: ['finance'], access: ['ap', 'ar', 'closing', 'books', 'payroll'] };
const dir: U = { id: '', email: 'dir@x.test', name: 'Youssef Director', roles: ['engineering'] };
const des: U = { id: '', email: 'des@x.test', name: 'Farah Designer', roles: ['projects'], access: ['design'] };
const adel: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'] };
let customer = '', vendor = '', expense = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, tasks cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null, pr_prefix = 'CIB-34-' where id = 1`;
  for (const u of [fin, dir, des, adel]) u.id = (await sql`insert into users (email, name, password_hash, roles, access) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.access ?? null}) returning id`)[0].id;
  await sql`insert into user_positions (user_id, position) values (${fin.id}, 'accountant'), (${dir.id}, 'eng_director')`;
  customer = (await sql`insert into parties (code, type, name) values ('CU-0901', 'customer', 'Client 20') returning id`)[0].id;
  vendor = (await sql`insert into parties (code, type, name) values ('VC-0901', 'vendor', 'Cleaning Co') returning id`)[0].id;
  expense = (await sql`select code from accounts where project_id = 'ph-b1302' and type = 'expense' and postable order by code limit 1`)[0].code;
  await sql`insert into accounts (code, name, type, parent, postable, is_bank) values ('A110', 'Cash – office safe', 'asset', 'A100', true, true) on conflict (code) do nothing`;
  await sql`insert into bank_accounts (account, kind, ref_prefix, holder, hidden) values ('A110', 'cash', 'PT-', 'Office safe', false) on conflict (account) do update set hidden = false`;
});
afterAll(async () => { await sql.end(); });

describe('sales invoices go through Finance, Engineering and Management', () => {
  it('posts only after Management signs; Engineering is the Director of Engineering; a return makes it a draft again', async () => {
    const id = await sales.saveSalesInvoice(fin as never, { date: '2026-10-15', party: customer, project: 'ph-b1302', ref: 'Stage 1', vatRate: 14, lines: [{ acc: 'R110', desc: 'Design', qty: 1, price: 1000 }] }, false);
    await sales.sendSalesForApproval(fin as never, id);
    expect((await sql`select status, sales_step from invoices where id = ${id}`)[0]).toMatchObject({ status: 'pending', sales_step: 'finance' });
    await expect(sales.approveSales(dir as never, id)).rejects.toThrow(/waits for Finance/);
    await sales.approveSales(fin as never, id);
    expect((await sales.salesWaitingFor(dir as never)).map(r => r.id)).toContain(id);
    await expect(sales.approveSales(fin as never, id)).rejects.toThrow(/waits for Engineering/);
    await expect(sales.returnSales(dir as never, id, '')).rejects.toThrow(/why/);
    await sales.returnSales(dir as never, id, 'Wrong stage');
    expect((await sql`select status from invoices where id = ${id}`)[0].status).toBe('draft');
    await sales.sendSalesForApproval(fin as never, id);
    await sales.approveSales(fin as never, id);
    await sales.approveSales(dir as never, id);
    expect((await sql`select status, sales_step from invoices where id = ${id}`)[0]).toMatchObject({ status: 'pending', sales_step: 'management' });
    expect((await docs.waitingForUser(adel as never)).some(w => w.act === `sales:${id}`)).toBe(true);
    await sales.approveSales(adel as never, id);
    expect((await sql`select status, entry_id from invoices where id = ${id}`)[0]).toMatchObject({ status: 'posted' });
  });
  it("a new project gives the accountant a task for its sales invoice, which closes once an invoice is made", async () => {
    const [p] = await sql<{ id: string; code: string }[]>`select id, code from projects where not is_office order by code limit 1`;
    await sql.begin(tx => sales.askForSalesInvoice(tx, adel as never, { id: p.id, code: p.code }));
    const [t] = await sql`select id, status, assignee_id from tasks where link_type = 'cost-center' and link_id = ${p.id} and title like 'Sales invoice:%'`;
    expect(t).toMatchObject({ status: 'todo', assignee_id: fin.id });
    await sales.saveSalesInvoice(fin as never, { date: '2026-10-15', party: customer, project: p.id, ref: '', vatRate: 0, lines: [{ acc: 'R110', qty: 1, price: 10 }] }, false);
    expect((await sql`select status from tasks where id = ${t.id}`)[0].status).toBe('done');
  });
});

describe('vendor invoices are recorded first, then paid by a payment request', () => {
  it('a service invoice with no PO posts to the vendor and a CIB-34- request picks it', async () => {
    await expect(ap.recordServiceInvoice(fin as never, { date: '2026-10-15', party: vendor, ref: '', project: 'ph-b1302', vatRate: 0, whtRate: 0, lines: [{ acc: expense, amount: 500 }] })).rejects.toThrow(/invoice number/);
    const bill = await ap.recordServiceInvoice(fin as never, { date: '2026-10-15', party: vendor, ref: 'CL-77', project: 'ph-b1302', vatRate: 14, whtRate: 0, lines: [{ acc: expense, desc: 'Site cleaning', amount: 500 }] });
    await expect(ap.recordServiceInvoice(fin as never, { date: '2026-10-15', party: vendor, ref: 'cl-77', project: 'ph-b1302', vatRate: 0, whtRate: 0, lines: [{ acc: expense, amount: 1 }] })).rejects.toThrow(/already recorded/);
    expect((await sql`select status, is_bill, net::float net from invoices where id = ${bill}`)[0]).toMatchObject({ status: 'posted', is_bill: true, net: 570 });
    expect((await ap.listVendorInvoices()).find(r => r.id === bill)).toMatchObject({ open: 570, request_no: null, po_no: null });
    const req = await docs.savePaymentRequest(fin as never, { date: '2026-10-15', party: vendor, project: 'ph-b1302', ref: '', vatRate: 0, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0, lines: [], bills: [bill] }, false);
    const [r] = await sql`select no, net::float net from invoices where id = ${req}`;
    expect(r.no).toMatch(/^CIB-34-\d{5}$/);
    expect(r.net).toBe(570);
    expect((await ap.listVendorInvoices()).find(x => x.id === bill)?.request_no).toBe(r.no);
  });
});

describe('petty cash', () => {
  it('a project petty cash goes to the Director of Engineering, then Management, with several lines', async () => {
    const id = await petty.createPetty(fin as never, { date: '2026-10-15', kind: 'other', paidTo: 'Taxi driver', purpose: 'Transport', project: 'ph-b1302',
      lines: [{ acc: expense, amount: 100, desc: 'Taxi' }, { acc: expense, amount: 50.5, desc: 'Water' }] });
    const d = await petty.getPetty(id);
    expect(d).toMatchObject({ status: 'head', approver_id: dir.id, total: 150.5 });
    expect(d!.no).toMatch(/^PT-/);
    expect(await petty.pettyLines(id)).toHaveLength(2);
    await expect(petty.approvePetty(fin as never, id)).rejects.toThrow();
    await petty.approvePetty(dir as never, id);
    expect((await petty.getPetty(id))!.status).toBe('management');
    expect((await docs.waitingForUser(adel as never)).some(w => w.act === `petty:${id}`)).toBe(true);
    await petty.approvePetty(adel as never, id);
    expect((await petty.getPetty(id))!.status).toBe('approved');
  });
});

describe('the staff sheet', () => {
  it('plans each login from the Emp ID: roles, department and the heads Adel set', () => {
    const plan = planStaff([
      { empId: 'owner', name: 'Haitham Soliman', email: 'h@x.test' }, { empId: 'owner', name: 'youssef ali', email: 'y@x.test' },
      { empId: 'RS-1001', name: 'Zeyad Essam', email: 'z@x.test' }, { empId: 'RS-1008', name: 'Mohamed Ali', email: 'm@x.test' },
      { empId: 'RS-1010', name: 'Ezz', email: 'e@x.test' }, { empId: 'RS-9999', name: 'Nobody', email: 'n@x.test' }, { empId: 'RS-1002', name: 'Twice', email: 'z@x.test' },
    ]);
    expect(plan.people.map(p => [p.name, p.management, p.access.join(','), p.dept])).toEqual([
      ['Haitham Soliman', true, '', 'MGT'], ['Youssef Ali', true, '', 'MGT'], ['Zeyad Essam', false, 'ap,ar,closing,books,payroll', 'FIN'],
      ['Mohamed Ali', false, 'cost_centers,tech_office,design,site,procurement', 'TO'], ['Ezz', false, 'design', 'ENG'],
    ]);
    expect(plan.skipped).toEqual(['Nobody', 'Twice']);
    expect(Object.keys(plan.heads).sort()).toEqual(['ADM', 'ENG', 'S&M', 'TO']);
  });
});

describe('home dashboards', () => {
  it('Management has all seven and each reads; a designer has Engineering only', async () => {
    const keys = await home.dashboardsFor(adel as never);
    expect(keys).toEqual(['management', 'finance', 'engineering', 'procurement', 'hr', 'admin', 'sales']);
    for (const k of keys) {
      const d = await home.dashboard(k, adel as never);
      expect(d.tiles.length).toBeGreaterThan(0);
      expect(d.lists.length).toBeGreaterThan(0);
    }
    expect(await home.dashboardsFor(des as never)).toEqual(['engineering']);
    expect(await home.dashboardsFor(fin as never)).toEqual(['finance']);
  });
});
