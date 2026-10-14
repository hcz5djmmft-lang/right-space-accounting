// VAT return and WHT certificates (improvement 10) against the test database.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const sales = await import('@/lib/sales');
const docs = await import('@/lib/documents');
const books = await import('@/lib/books');
const tax = await import('@/lib/tax-returns');
const { reportCsv } = await import('@/lib/reports');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const mgt = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'] };
let customer = '', pr = '';
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, vat_returns cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, mgt]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null, company_tax_id = '100-200-300' where id = 1`;
  await sql`update approval_steps set user_ids = '{}'`;
  await sql`update parties set tax_id = '555-111-222', full_name = 'Wood Works Co.' where id = 'vc0003'`;
  customer = (await sql`insert into parties (code, type, name, tax_id) values ('CU0009', 'customer', 'Hassan', '999-888-777') returning id`)[0].id;
  await sales.saveSalesInvoice(fin as never, { date: '2026-09-05', due: '2026-09-20', party: customer, project: 'ph-b1302', ref: '', vatRate: 14, lines: [{ acc: 'R110', desc: 'Design', qty: 1, price: 50000 }] }, true);
  pr = await docs.savePaymentRequest(mgt as never, { date: '2026-09-10', party: 'vc0003', project: 'ph-b1302', ref: 'INV-77', vatRate: 14, whtRate: 3, siRate: 0, retRate: 0, dpAmount: 0, lines: [{ acc: '25001-1', desc: 'Carpentry', qty: 1, price: 20000 }] }, true);
  for (let k = 0; k < 4 && (await sql`select status from invoices where id = ${pr}`)[0].status === 'pending'; k++) await docs.approveRequest(mgt as never, pr);
});
afterAll(async () => { await sql.end(); });

describe('VAT return', () => {
  it('adds output VAT on sales and input VAT on purchases, and agrees with the books', async () => {
    const v = await tax.vatReturn('2026-09');
    expect(v.sales).toHaveLength(1);
    expect(v.sales[0]).toMatchObject({ party: 'Hassan', tax_id: '999-888-777', base: 50000, vat: 7000 });
    expect(v.purchases[0]).toMatchObject({ id: pr, party: 'Wood Works Co.', base: 20000, vat: 2800, href: `/payment-requests/${pr}` });
    expect(v).toMatchObject({ outputVat: 7000, inputVat: 2800, netVat: 4200, agrees: true, prepared: null });
    expect((await tax.vatReturn('2026-08')).netVat).toBe(0);
  });
  it('picks up VAT on a typed expense entry as other input VAT', async () => {
    await books.saveEntry(fin as never, { date: '2026-09-12', ref: '', form: { type: 'expense', memo: 'Printer', bank: 'A110', vatRate: 14, items: [{ project: 'ph-b1302', acc: '25001-1', amount: 1000 }] } }, 'post');
    const v = await tax.vatReturn('2026-09');
    expect(v.otherIn).toHaveLength(1);
    expect(v.otherIn[0].vat).toBe(140);
    expect(v).toMatchObject({ inputVat: 2940, netVat: 4060, agrees: true });
  });
  it('Finance marks it prepared; a later change in the month shows', async () => {
    await tax.prepareVatReturn(fin as never, '2026-09');
    expect((await tax.vatReturn('2026-09')).prepared).toMatchObject({ by: 'Ziad', net: 4060, changed: false });
    await sales.saveSalesInvoice(fin as never, { date: '2026-09-25', due: '2026-09-30', party: customer, project: 'ph-b1302', ref: '', vatRate: 14, lines: [{ acc: 'R110', desc: 'Extra', qty: 1, price: 1000 }] }, true);
    expect((await tax.vatReturn('2026-09')).prepared?.changed).toBe(true);
    await tax.unprepareVatReturn(fin as never, '2026-09');
    expect((await tax.vatReturn('2026-09')).prepared).toBeNull();
  });
  it('exports to Excel', async () => {
    const r = await reportCsv('vat-return', { m: '2026-09' }, await books.getSettings());
    expect(r!.name).toBe('VAT return 2026-09');
    expect(r!.rows.at(-1)).toEqual(['Net VAT to pay', '', '', '', '', '', 4200]);
  });
});

describe('WHT certificates', () => {
  it('lists each supplier with the base and tax withheld, and builds the certificate', async () => {
    const rows = await tax.whtSuppliers('2026-07-01', '2026-09-30');
    expect(rows).toEqual([expect.objectContaining({ party_id: 'vc0003', tax_id: '555-111-222', docs: 1, base: 20000, wht: 600 })]);
    const c = await tax.whtCertificate('vc0003', '2026-07-01', '2026-09-30');
    expect(c).toMatchObject({ base: 20000, wht: 600, companyTaxId: '100-200-300', party: { full_name: 'Wood Works Co.' } });
    expect(c!.lines[0]).toMatchObject({ ref: 'INV-77', rate: 3, wht: 600 });
    expect(await tax.whtSuppliers('2026-10-01', '2026-12-31')).toEqual([]);
  });
  it('knows the quarter of a date', () => {
    expect(tax.quarterOf('2026-10-14')).toEqual({ from: '2026-10-01', to: '2026-12-31', label: 'Q4 2026' });
    expect(tax.quarterOf('2026-02-01')).toEqual({ from: '2026-01-01', to: '2026-03-31', label: 'Q1 2026' });
  });
});
