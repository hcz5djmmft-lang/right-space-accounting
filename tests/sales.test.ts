// Sales invoices and customer receipts against the test database (see books.test.ts for setup notes).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const sales = await import('@/lib/sales');
const { trialBalance } = await import('@/lib/books');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
let customer = '', bank = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  customer = (await sql`insert into parties (code, type, name, tax_id) values ('CU0001', 'customer', 'Palm Hills Developments', '123-456-789') returning id`)[0].id;
  bank = (await sql`select code from accounts where is_bank and postable order by code limit 1`)[0].code;
});
afterAll(async () => { await sql.end(); });

const bal = async (code: string) => (await trialBalance()).find(r => r.code === code);
const invoice = { date: '2026-10-12', party: '', project: 'ph-b1302', ref: 'Contract 7 · stage 2', vatRate: 14, lines: [{ acc: 'R110', desc: 'Design stage 2', qty: 1, price: 200000 }] };

describe('sales invoice', () => {
  let id = '';
  it('only Finance records invoices, and lines must be revenue codes', async () => {
    await expect(sales.saveSalesInvoice(eng as never, { ...invoice, party: customer }, false)).rejects.toThrow(/Only Finance/);
    await expect(sales.saveSalesInvoice(fin as never, { ...invoice, party: customer, lines: [{ acc: '25001-1', qty: 1, price: 10 }] }, false)).rejects.toThrow(/not a revenue/);
  });
  it('a draft is numbered INV-00001 and posts Dr receivables 228,000, Cr revenue 200,000, Cr output VAT 28,000', async () => {
    const ar0 = await bal('A130'), rev0 = await bal('R110');
    id = await sales.saveSalesInvoice(fin as never, { ...invoice, party: customer }, false);
    expect(await sql`select no, status, total from invoices where id = ${id}`).toMatchObject([{ no: 'INV-00001', status: 'draft', total: 228000 }]);
    await sales.postSalesInvoice(fin as never, id);
    const [r] = await sql<{ status: string; entry_id: string }[]>`select status, entry_id from invoices where id = ${id}`;
    expect(r.status).toBe('posted');
    const lines = await sql<{ account: string; dr: number; cr: number; project_id: string | null }[]>`select account, dr, cr, project_id from journal_lines where entry_id = ${r.entry_id} order by line_no`;
    expect(lines).toEqual([
      { account: 'A130', dr: 228000, cr: 0, project_id: 'ph-b1302' },
      { account: 'R110', dr: 0, cr: 200000, project_id: 'ph-b1302' },
      { account: 'L140', dr: 0, cr: 28000, project_id: 'ph-b1302' },
    ]);
    expect((await bal('A130'))!.dr - (ar0?.dr ?? 0)).toBe(228000);
    expect((await bal('R110'))!.cr - (rev0?.cr ?? 0)).toBe(200000);
    await expect(sales.postSalesInvoice(fin as never, id)).rejects.toThrow(/already posted/);
    await expect(sales.deleteSalesInvoice(fin as never, id)).rejects.toThrow(/Only draft/);
  });
  it('a receipt with WHT settles the invoice: Dr bank 221,160, Dr WHT receivable 6,840, Cr receivables 228,000', async () => {
    const open = await sales.openInvoices(sql, customer);
    expect(open).toMatchObject([{ id, total: 228000, received: 0, open: 228000 }]);
    await expect(sales.postCustomerReceipt(fin as never, { date: '2026-10-20', party: customer, bank, received: 100, wht: 0, memo: '', ref: '', alloc: [{ invoice: id, amount: 228000 }] }))
      .rejects.toThrow(/Allocated 228000.00 but the receipt settles only 100.00/);
    const pid = await sales.postCustomerReceipt(fin as never, { date: '2026-10-20', party: customer, bank, received: 221160, wht: 6840, memo: 'Stage 2', ref: 'TRF-9', alloc: [{ invoice: id, amount: 228000 }] });
    const [p] = await sql<{ no: string; status: string; amount: number; wht: number; entry_id: string }[]>`select no, status, amount, wht, entry_id from payments where id = ${pid}`;
    expect(p).toMatchObject({ no: 'RCT-00001', status: 'posted', amount: 228000, wht: 6840 });
    const lines = await sql<{ account: string; dr: number; cr: number }[]>`select account, dr, cr from journal_lines where entry_id = ${p.entry_id} order by line_no`;
    expect(lines).toEqual([{ account: bank, dr: 221160, cr: 0 }, { account: 'A150', dr: 6840, cr: 0 }, { account: 'A130', dr: 0, cr: 228000 }]);
    expect((await sales.openInvoices(sql, customer))[0]).toMatchObject({ received: 228000, open: 0 });
    await expect(sales.voidSalesInvoice(fin as never, id, 'test', '2026-10-21')).rejects.toThrow(/receipt is allocated/);
  });
  it('an invoice with no receipt can be voided, which reverses its entry', async () => {
    const id2 = await sales.saveSalesInvoice(fin as never, { ...invoice, party: customer, lines: [{ acc: 'R190', qty: 1, price: 500 }] }, true);
    await sales.voidSalesInvoice(fin as never, id2, 'Issued twice', '2026-10-22');
    const [r] = await sql<{ status: string; entry_id: string }[]>`select status, entry_id from invoices where id = ${id2}`;
    expect(r.status).toBe('void');
    const [e] = await sql<{ reversed_by: string | null }[]>`select reversed_by from journal_entries where id = ${r.entry_id}`;
    expect(e.reversed_by).toBeTruthy();
    const tb = await trialBalance();
    expect(tb.reduce((s, r) => s + r.dr - r.cr, 0)).toBeCloseTo(0, 2);
  });
});
