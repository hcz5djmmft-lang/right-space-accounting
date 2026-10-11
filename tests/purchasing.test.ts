// Purchasing against the test database (see books.test.ts for setup notes): a purchase request through Procurement,
// the department head and Management to a PO, Receive and invoice against it, and a payment request that pays the
// vendor's unpaid invoices.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const pur = await import('@/lib/purchasing');
const docs = await import('@/lib/documents');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[]; dept_id: string | null };
const ziad: U = { id: '', email: 'ziad@x.test', name: 'Ziad', roles: [], dept_id: 'fin' };
const marwan: U = { id: '', email: 'marwan@x.test', name: 'Marwan', roles: [], dept_id: 'pur' };
const youssef: U = { id: '', email: 'youssef@x.test', name: 'Youssef', roles: ['engineering'], dept_id: 'eng' };
const adel: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'], dept_id: 'fin' };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'], dept_id: 'fin' };
const project = 'cs-ch2505'; // GL suffix 2
let vendor = '', cement = '', cable = '', paper = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, materials cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`insert into departments (id, code, name) values ('pur', 'PUR', 'Purchasing') on conflict do nothing`;
  for (const u of [ziad, marwan, youssef, adel, fin]) u.id = (await sql`insert into users (email, name, password_hash, roles, dept_id) values (${u.email}, ${u.name}, 'x', ${u.roles}, ${u.dept_id}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${marwan.id} where id = 'pur'`;
  await sql`update departments set head_user_id = ${youssef.id} where id = 'eng'`;
  await sql`delete from approval_steps`;
  await sql`insert into approval_steps (position, name, user_ids) values (1, 'Department head', '{}'), (2, 'Management', ${[adel.id]})`;
  await sql`update settings set lock_date = null, require_approval = true where id = 1`;
  vendor = (await sql`insert into parties (code, type, name) values ('VC0099', 'vendor', 'El Nour Building Supplies') returning id`)[0].id;
  [cement, cable, paper] = (await sql<{ id: string }[]>`insert into materials (code, name, unit, account_base) values
    ('MAT-001', 'Cement, 50 kg bag', 'bag', '28004'), ('MAT-003', 'Electrical cable 3 mm', 'roll', '24001'), ('MAT-018', 'Office stationery', 'lot', '13002') returning id`).map(r => r.id);
});
afterAll(async () => { await sql.end(); });

describe('purchasing', () => {
  let prq = '', bill1 = '', bill2 = '', payReq = '';

  it("a request for a project posts each material to that project's copy of its GL code", async () => {
    prq = await pur.savePurchaseRequest(ziad as never, { date: '2026-10-11', project, lines: [{ material: cement, qty: 10 }, { material: cable, qty: 2, description: 'red' }] }, true);
    expect(await pur.getPurchaseRequest(prq)).toMatchObject({ no: 'PRQ-00001', status: 'procurement', cc: 'CS-CH2505' });
    expect((await pur.getPurchaseLines(prq)).map(l => [l.name, Number(l.qty), l.account])).toEqual([['Cement, 50 kg bag', 10, '28004-2'], ['Electrical cable 3 mm', 2, '24001-2']]);
    await expect(pur.savePurchaseRequest(ziad as never, { date: '2026-10-11', project, lines: [{ material: paper, qty: 1 }] }, true)).rejects.toThrow(/no GL code for this project/);
    const dept = await pur.savePurchaseRequest(ziad as never, { date: '2026-10-11', dept: 'fin', lines: [{ material: paper, qty: 1 }] }, false);
    expect((await pur.getPurchaseLines(dept))[0].account).toBe('13002');
  });

  it('Procurement prices it, picks the vendor and sends it to the head of Engineering', async () => {
    expect((await docs.waitingForUser(marwan as never)).map(w => w.no)).toContain('PRQ-00001');
    const lines = await pur.getPurchaseLines(prq);
    const prices = { [lines[0].id]: 120, [lines[1].id]: 900 };
    await expect(pur.pricePurchaseRequest(ziad as never, prq, { vendor, vatRate: 14, prices, send: true })).rejects.toThrow(/Only Procurement/);
    await expect(pur.pricePurchaseRequest(marwan as never, prq, { vendor: '', vatRate: 14, prices, send: true })).rejects.toThrow(/vendor/);
    await pur.pricePurchaseRequest(marwan as never, prq, { vendor, vatRate: 14, prices, send: true });
    expect(await pur.getPurchaseRequest(prq)).toMatchObject({ status: 'head', approver_id: youssef.id, approver_label: 'Engineering head', vendor: 'El Nour Building Supplies', subtotal: 3000 });
  });

  it('the department head, then Management approve; Management makes it a PO', async () => {
    await expect(pur.approvePurchaseRequest(ziad as never, prq)).rejects.toThrow(/Engineering head/);
    expect((await docs.waitingForUser(youssef as never)).map(w => w.type)).toContain('Purchase request · Engineering head');
    expect(await pur.approvePurchaseRequest(youssef as never, prq)).toBeNull();
    await expect(pur.approvePurchaseRequest(youssef as never, prq)).rejects.toThrow(/Management/);
    expect(await pur.approvePurchaseRequest(adel as never, prq)).toBe('PO-00001');
    expect(await pur.getPurchaseRequest(prq)).toMatchObject({ status: 'approved', po_no: 'PO-00001' });
    expect((await pur.getPurchaseApprovals(prq)).map(a => a.step_name)).toEqual(['Procurement', 'Engineering head', 'Management']);
  });

  it('Receive and invoice posts what was delivered to the GL codes and the vendor, and shows what remains', async () => {
    const lines = await pur.getPurchaseLines(prq);
    await expect(pur.receiveInvoice(ziad as never, prq, { date: '2026-10-12', ref: 'N-1', vatRate: 14, whtRate: 0, lines: [] })).rejects.toThrow(/Only Finance/);
    bill1 = await pur.receiveInvoice(fin as never, prq, { date: '2026-10-12', ref: 'N-1', vatRate: 14, whtRate: 0, lines: [{ lineId: lines[0].id, qty: 6, price: 120 }, { lineId: lines[1].id, qty: 2, price: 900 }] });
    const jl = await sql<{ account: string; dr: number; cr: number; party_id: string | null; project_id: string | null }[]>`
      select l.account, l.dr, l.cr, l.party_id, l.project_id from journal_lines l join invoices i on i.entry_id = l.entry_id where i.id = ${bill1} order by l.line_no`;
    expect(jl.map(l => [l.account, l.dr, l.cr])).toEqual([['28004-2', 720, 0], ['24001-2', 1800, 0], ['A140', 352.8, 0], ['L110', 0, 2872.8]]);
    expect(jl.find(l => l.account === 'L110')!.party_id).toBe(vendor);
    expect(await sql`select no, status, po_id, net from invoices where id = ${bill1}`).toEqual([{ no: 'VI-00001', status: 'posted', po_id: prq, net: 2872.8 }]);
    expect(pur.poFigures(await pur.getPurchaseLines(prq))).toEqual({ ordered: 3000, received: 2520, remaining: 480, pct: 84 });
    await expect(pur.receiveInvoice(fin as never, prq, { date: '2026-10-13', ref: 'N-2', vatRate: 14, whtRate: 0, lines: [{ lineId: lines[0].id, qty: 5, price: 120 }] })).rejects.toThrow(/only 4 bag remain/);
    bill2 = await pur.receiveInvoice(fin as never, prq, { date: '2026-10-13', ref: 'N-2', vatRate: 0, whtRate: 0, lines: [{ lineId: lines[0].id, qty: 4, price: 125 }] });
    expect((await pur.getPurchaseRequest(prq)).closed).toBe(true); // everything received
    expect((await pur.listMaterials()).find(m => m.id === cement)!.last_price).toBe(125);
  });

  it("the vendor's invoices wait in their account until a payment request pays them", async () => {
    expect((await pur.unpaidBills(vendor)).map(b => [b.no, b.open, b.request_no])).toEqual([['VI-00001', 2872.8, null], ['VI-00002', 500, null]]);
    expect(await docs.openRequests(sql, vendor)).toEqual([]); // not payable until a request releases them
    const base = { date: '2026-10-14', party: vendor, ref: '', vatRate: 0, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0 };
    await expect(docs.savePaymentRequest(ziad as never, { ...base, lines: [{ acc: '11003', qty: 1, price: 5, dept: 'fin' }], bills: [bill1] }, true)).rejects.toThrow(/not both/);
    payReq = await docs.savePaymentRequest(ziad as never, { ...base, lines: [], bills: [bill1, bill2] }, true);
    expect(await sql`select status, net, approver_id, approver_label from invoices where id = ${payReq}`).toEqual([{ status: 'pending', net: 3372.8, approver_id: youssef.id, approver_label: 'Engineering head' }]);
    await expect(docs.savePaymentRequest(ziad as never, { ...base, lines: [], bills: [bill2] }, false)).rejects.toThrow(/already on payment request/);
    expect((await pur.unpaidBills(vendor)).map(b => b.request_id)).toEqual([payReq, payReq]);
  });

  it('approving the request releases the invoices for payment without a second entry; paying them clears both', async () => {
    await docs.approveRequest(youssef as never, payReq);
    await docs.approveRequest(adel as never, payReq);
    expect(await sql`select status, entry_id from invoices where id = ${payReq}`).toEqual([{ status: 'posted', entry_id: null }]);
    const open = await docs.openRequests(sql, vendor);
    expect(open.map(o => [o.no, o.open, o.via])).toEqual([['VI-00001', 2872.8, (await sql`select no from invoices where id = ${payReq}`)[0].no], ['VI-00002', 500, expect.any(String)]]);
    await docs.postVendorPayment(fin as never, { date: '2026-10-15', party: vendor, bank: 'A120', amount: 3372.8, memo: '', ref: '', alloc: open.map(o => ({ invoice: o.id, amount: o.open })) });
    expect((await sql`select invoice_paid(${payReq}) v`)[0].v).toBe(3372.8);
    expect(await pur.unpaidBills(vendor)).toEqual([]);
    expect((await docs.openRequests(sql, vendor)).map(o => o.open)).toEqual([0, 0]);
    const [{ bal }] = await sql<{ bal: number }[]>`select coalesce(sum(l.cr - l.dr), 0) bal from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = 'L110' and l.party_id = ${vendor}`;
    expect(bal).toBe(0);
  });

  it('keeps the material list: a new material is numbered after the last, on an expense code', async () => {
    const id = await pur.saveMaterial(marwan as never, { name: 'Tile spacers', unit: 'bag', account_base: '24004-1' });
    expect((await pur.listMaterials()).find(m => m.id === id)).toMatchObject({ code: 'MAT-019', account_base: '24004' });
    await expect(pur.saveMaterial(marwan as never, { name: 'X', unit: 'pc', account_base: 'A120' })).rejects.toThrow(/not an expense code/);
    await expect(pur.saveMaterial(ziad as never, { name: 'X', unit: 'pc', account_base: '24004' })).rejects.toThrow(/Only Procurement/);
  });
});
