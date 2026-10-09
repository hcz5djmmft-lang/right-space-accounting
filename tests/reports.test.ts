// Cost centers, budget vs actual, aging and tax reports against the test database (see books.test.ts for setup notes).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const rep = await import('@/lib/reports');
const { trialBalance, getSettings } = await import('@/lib/books');
const { natural } = await import('@/lib/ledger');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const r2 = (n: number) => Math.round(n * 100) / 100;
let customer = '', vendor = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  customer = (await sql`insert into parties (type, name, code) values ('customer', 'Test Customer', 'CU9999') returning id`)[0].id;
  vendor = (await sql`select id from parties where type = 'vendor' order by name limit 1`)[0].id;
  // open documents: a sales invoice 69 days past due with 300 received, a payment request without a due date, a pending request (committed)
  await sql`insert into invoices (id, kind, no, date, due_date, party_id, subtotal, total, net, status) values
    ('t-inv1', 'sales', 'INV-T1', '2026-07-01', '2026-08-01', ${customer}, 1000, 1000, 1000, 'posted'),
    ('t-pr1', 'purchase', 'C-T1', '2026-09-15', null, ${vendor}, 500, 500, 480, 'posted'),
    ('t-pr2', 'purchase', 'C-T2', '2026-10-01', '2026-10-30', ${vendor}, 200, 200, 200, 'pending')`;
  await sql`insert into invoice_lines (invoice_id, line_no, account, qty, price) values ('t-pr2', 1, '11001', 2, 100)`;
  await sql`insert into payments (id, kind, no, date, party_id, bank, amount, status) values ('t-rct1', 'receipt', 'RCT-T1', '2026-10-01', ${customer}, 'A120', 300, 'posted')`;
  await sql`insert into payment_allocations (payment_id, invoice_id, amount) values ('t-rct1', 't-inv1', 300)`;
  await sql`update accounts set budget = 100000 where code = '11001'`;
});
afterAll(async () => { await sql.end(); });

describe('reports', () => {
  it('fiscal year start follows the settings', () => {
    expect(rep.fiscalYearStart({ fy_start_month: 1 }, '2026-10-09')).toBe('2026-01-01');
    expect(rep.fiscalYearStart({ fy_start_month: 7 }, '2026-10-09')).toBe('2026-07-01');
    expect(rep.fiscalYearStart({ fy_start_month: 7 }, '2026-03-09')).toBe('2025-07-01');
  });

  it('cost centers add up to the income statement for the same period', async () => {
    const from = '2026-01-01', to = '2026-12-31';
    const [rows, tb] = await Promise.all([rep.costCenters({ from, to }), trialBalance({ from, to })]);
    const rev = r2(tb.filter(r => r.type === 'revenue').reduce((s, r) => s + natural(r.type, r.dr, r.cr), 0));
    const cost = r2(tb.filter(r => r.type === 'expense').reduce((s, r) => s + natural(r.type, r.dr, r.cr), 0));
    expect(r2(rows.reduce((s, r) => s + r.rev, 0))).toBe(rev);
    expect(r2(rows.reduce((s, r) => s + r.cost, 0))).toBe(cost);
    expect(rows.every(r => r2(r.opex + r.capex) === r.cost && r.net === r2(r.rev - r.cost))).toBe(true);
    expect(rows.some(r => r.is_office)).toBe(true);
  });

  it('budget vs actual: actual from the ledger, committed from pending requests, remaining = budget − actual − committed', async () => {
    const from = '2026-01-01', to = '2026-12-31';
    const rows = await rep.budgetVsActual({ from, to });
    const sal = rows.find(r => r.code === '11001')!;
    const tb = (await trialBalance({ from, to })).find(r => r.code === '11001');
    expect(sal.budget).toBe(100000);
    expect(sal.actual).toBe(tb ? natural('expense', tb.dr, tb.cr) : 0);
    expect(sal.committed).toBe(200);
    expect(sal.remaining).toBe(r2(100000 - sal.actual - 200));
    expect(sal.pct).toBe(Math.round((sal.actual + 200) / 100000 * 100));
    expect(rows.every(r => r.type === 'expense' || r.budget !== null)).toBe(true);
  });

  it('aging buckets open balances by days past due as of a date', async () => {
    const ar = await rep.aging({ side: 'sales', asOf: '2026-10-09' });
    const inv = ar.docs.find(d => d.no === 'INV-T1')!;
    expect(inv).toMatchObject({ balance: 700, days: 69, bucket: 3 });
    expect(ar.parties.find(p => p.party === 'Test Customer')).toMatchObject({ buckets: [0, 0, 0, 700, 0], total: 700 });
    // before the receipt was posted the whole invoice was open, and only 30 days past due
    const earlier = await rep.aging({ side: 'sales', asOf: '2026-08-31' });
    expect(earlier.docs.find(d => d.no === 'INV-T1')).toMatchObject({ balance: 1000, days: 30, bucket: 1 });
    const ap = await rep.aging({ side: 'purchase', asOf: '2026-10-09' });
    expect(ap.docs.find(d => d.no === 'C-T1')).toMatchObject({ balance: 480, days: 0, bucket: 0 });
    expect(ap.docs.some(d => d.no === 'C-T2')).toBe(false); // pending, not posted
    expect(ap.totals[0]).toBeGreaterThanOrEqual(480);
  });

  it('tax report: closing = opening + debits − credits for every mapped account', async () => {
    const s = await getSettings();
    const t = await rep.taxReport({ from: '2026-06-01', to: '2026-12-31' }, s.account_map);
    expect(t.accounts.map(a => a.key)).toEqual(rep.TAX_KEYS.map(([k]) => k));
    for (const a of t.accounts) expect(a.closing).toBe(r2(a.opening + a.dr - a.cr));
    const vatOut = t.accounts.find(a => a.key === 'vatOut')!, vatIn = t.accounts.find(a => a.key === 'vatIn')!;
    expect(t.outputVat).toBe(r2(vatOut.cr - vatOut.dr));
    expect(t.inputVat).toBe(r2(vatIn.dr - vatIn.cr));
    expect(t.netVat).toBe(r2(t.outputVat - t.inputVat));
    // opening of the period equals the closing of everything before it
    const before = await rep.taxReport({ from: '2000-01-01', to: '2026-05-31' }, s.account_map);
    for (const a of t.accounts) expect(a.opening).toBe(before.accounts.find(b => b.key === a.key)!.closing);
  });

  it('CSV export carries the same numbers, with a BOM for Excel', async () => {
    const s = await getSettings();
    const csv = await rep.reportCsv('aging', { side: 'sales', to: '2026-10-09' }, s);
    expect(csv!.rows[0]).toEqual(['Party', 'Current', '1–30', '31–60', '61–90', '90+', 'Total']);
    expect(csv!.rows.find(r => r[0] === 'Test Customer')).toEqual(['Test Customer', 0, 0, 0, 700, 0, 700]);
    const text = rep.toCsv([['a', 'b,c', 'say "hi"'], [1, null, 2.5]]);
    expect(text).toBe('﻿a,"b,c","say ""hi"""\r\n1,,2.5');
    expect(await rep.reportCsv('nope', {}, s)).toBeNull();
    expect((await rep.reportCsv('tb', { to: '2026-12-31' }, s))!.rows[0]).toEqual(['GL code', 'Name', 'Debit', 'Credit']);
  });
});
