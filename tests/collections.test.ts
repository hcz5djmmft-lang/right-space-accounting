// Collections against the test database (see books.test.ts for setup notes): typed sales invoices on their own revenue
// codes, cash and bank transfer receipts by project, the summary by type and by project, and voiding a receipt.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const sales = await import('@/lib/sales');
const col = await import('@/lib/collections');
const books = await import('@/lib/books');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
let customer = '';
const project = 'cs-ch2505'; // no imported activity on this one

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  // what migrations 011 and 012 add to the live books; the snapshot import wipes it, so it is put back here
  await sql`insert into accounts (code, name, type, parent, postable, is_system) values
    ('R111', 'Design revenue', 'revenue', 'R100', true, true), ('R112', 'Fit-out revenue', 'revenue', 'R100', true, true), ('R113', 'Furniture revenue', 'revenue', 'R100', true, true), ('R130', 'Bank interest', 'revenue', 'R100', true, true)`;
  await sql`insert into collection_types (id, name, name_ar, account, sort) values ('design', 'Design', 'تصميم', 'R111', 1), ('fitout', 'Fit-out', 'تنفيذ', 'R112', 2), ('furniture', 'Furniture', 'أثاث', 'R113', 3)`;
  await sql`insert into bank_accounts (account, kind, bank_name, branch, account_no, iban, swift, holder, ref_prefix, show_on_invoices) values
    ('A120', 'bank', 'Commercial International Bank (CIB)', 'Green Plaza', '100076016334', 'EG840010004200000100076016334', 'CIBEEGCX042', 'Right Space Developments', 'CIB-34-', true),
    ('A110', 'cash', null, null, null, null, null, 'Office', 'PT-', false)`;
  await sql`update settings set account_map = account_map || '{"interest": "R130"}'::jsonb where id = 1`;
  customer = (await sql`insert into parties (code, type, name, full_name) values ('CU0002', 'customer', 'Chateau Homes', 'Chateau Homes for Development S.A.E.') returning id`)[0].id;
  await sql`update projects set client_id = ${customer} where id = ${project}`;
});
afterAll(async () => { await sql.end(); });

const invoice = { date: '2026-10-12', party: '', project, category: 'design', ref: 'Contract 9', vatRate: 14, lines: [{ acc: '', desc: 'Design stage 1', qty: 1, price: 100000 }] };

describe('collections', () => {
  let inv = '', rct = '', direct = '';
  it("an invoice's type decides its revenue code: a design invoice posts to R111", async () => {
    inv = await sales.saveSalesInvoice(fin as never, { ...invoice, party: customer }, true);
    expect(await sql`select category, total, status from invoices where id = ${inv}`).toMatchObject([{ category: 'design', total: 114000, status: 'posted' }]);
    const lines = await sql<{ account: string; cr: number }[]>`select l.account, l.cr from journal_lines l join invoices i on i.entry_id = l.entry_id where i.id = ${inv} and l.cr > 0 order by l.line_no`;
    expect(lines.map(l => [l.account, l.cr])).toEqual([['R111', 100000], ['L140', 14000]]);
    await expect(sales.saveSalesInvoice(fin as never, { ...invoice, party: customer, category: 'cars' }, false)).rejects.toThrow(/type of the invoice/);
  });
  it("a bank transfer against the invoice is a bank transfer receipt for the invoice's project, with the CIB details", async () => {
    rct = await sales.postCustomerReceipt(fin as never, { date: '2026-10-15', party: customer, bank: 'A120', received: 114000, wht: 0, memo: '', ref: 'TRF-1', alloc: [{ invoice: inv, amount: 114000 }] });
    expect(await col.getReceipt(rct)).toMatchObject({ no: 'RCT-00001', method: 'bank', project_id: project, project_code: 'CS-CH2505', amount: 114000, customer_full: 'Chateau Homes for Development S.A.E.',
      bank_name: 'Commercial International Bank (CIB)', holder: 'Right Space Developments', ref: 'TRF-1' });
    expect(await col.getReceiptAllocations(rct)).toMatchObject([{ no: 'INV-00001', type: 'Design', total: 114000, amount: 114000, project_code: 'CS-CH2505' }]);
  });
  it('cash with no invoice is a cash receipt, an advance on the project', async () => {
    const id = await sales.postCustomerReceipt(fin as never, { date: '2026-10-16', party: customer, project, bank: 'A110', received: 5000, wht: 0, memo: 'Deposit', ref: '', alloc: [] });
    expect(await col.getReceipt(id)).toMatchObject({ no: 'RCT-00002', method: 'cash', project_id: project, account_name: 'Cash – office safe' });
    expect(await col.getReceiptAllocations(id)).toEqual([]);
  });
  it('a collection entered straight to a revenue code counts too; bank interest does not', async () => {
    direct = await books.saveEntry(fin as never, { date: '2026-10-17', ref: '', form: { type: 'collection', memo: 'Furniture paid at the showroom', bank: 'A110', party: customer, items: [{ project, acc: 'R113', amount: 2500 }] } }, 'post');
    await books.saveEntry(fin as never, { date: '2026-10-17', ref: '', form: { type: 'collection', memo: 'Bank interest', bank: 'A120', items: [{ acc: 'R130', amount: 20 }] } }, 'post');
    const rows = await col.moneyReceived();
    expect(rows.find(r => r.id === direct)).toMatchObject({ kind: 'entry', customer: 'Chateau Homes', project_code: 'CS-CH2505', types: 'Furniture', method: 'cash', account: 'A110', amount: 2500 });
    expect(rows.some(r => /interest/i.test(r.no) || r.amount === 20)).toBe(false);
  });
  it('the summary counts by type, by project, and lists what came in', async () => {
    const t = await col.receivedByType();
    expect(t.types).toEqual(expect.arrayContaining([{ id: 'design', name: 'Design', amount: 114000 }, { id: 'fitout', name: 'Fit-out', amount: 0 }, { id: 'furniture', name: 'Furniture', amount: 2500 }, { id: 'advance', name: 'Advances, no invoice yet', amount: 5000 }]));
    expect(t.total).toBe(t.types.reduce((s, x) => s + x.amount, 0));
    expect((await col.receivedByType('2026-10-16', '2026-10-16')).types.find(x => x.id === 'advance')!.amount).toBe(5000);
    const p = (await col.collectionsByProject()).find(p => p.id === project)!;
    expect(p).toMatchObject({ client: 'Chateau Homes', invoiced: 114000, settled: 114000, advances: 5000, direct: 2500, received: 121500, open: 0 });
    const rows = await col.moneyReceived({ project });
    expect(rows.map(r => [r.no, r.method, r.types, r.amount])).toEqual([[(await sql`select no from journal_entries where id = ${direct}`)[0].no, 'cash', 'Furniture', 2500], ['RCT-00002', 'cash', null, 5000], ['RCT-00001', 'bank', 'Design', 114000]]);
    expect((await col.moneyReceived({ project, from: '2026-10-16' })).map(r => r.no)).not.toContain('RCT-00001');
  });
  it('voiding a receipt reverses it and reopens the invoice', async () => {
    await expect(sales.voidCustomerReceipt(eng as never, rct, 'x', '2026-10-18')).rejects.toThrow(/Only Finance/);
    await sales.voidCustomerReceipt(fin as never, rct, 'Transfer bounced', '2026-10-18');
    expect((await col.getReceipt(rct)).status).toBe('void');
    expect((await sales.openInvoices(sql, customer)).find(o => o.id === inv)).toMatchObject({ received: 0, open: 114000 });
    expect((await col.receivedByType()).types.find(x => x.id === 'design')!.amount).toBe(0);
    expect((await col.moneyReceived({ project })).find(r => r.no === 'RCT-00001')!.status).toBe('void');
    expect((await col.collectionsByProject()).find(p => p.id === project)).toMatchObject({ settled: 0, open: 114000, received: 7500 });
    await expect(sales.voidCustomerReceipt(fin as never, rct, 'again', '2026-10-18')).rejects.toThrow(/Only posted/);
  });
  it('printed invoices carry the CIB account clients pay into', async () => {
    expect(await col.invoiceBankDetails()).toMatchObject({ account: 'A120', bank_name: 'Commercial International Bank (CIB)', branch: 'Green Plaza', holder: 'Right Space Developments', swift: 'CIBEEGCX042' });
  });
});
