// Statements pack (improvement 13) against the test database: the four statements agree with each other and the
// Excel workbook reads back.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const books = await import('@/lib/books');
const sales = await import('@/lib/sales');
const ob = await import('@/lib/opening');
const { statementsPack, packSheets } = await import('@/lib/pack');
const { writeXlsx, zip } = await import('@/lib/xlsx-write');
const { readXlsx, unzip } = await import('@/lib/xlsx');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const cashAt = async (d: string) => (await sql`select coalesce(sum(l.dr - l.cr), 0)::float n from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.code = l.account and a.is_bank and a.type = 'asset' where e.date <= ${d}`)[0].n;
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, opening_balances cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  fin.id = (await sql`insert into users (email, name, password_hash, roles) values (${fin.email}, ${fin.name}, 'x', ${fin.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null, opening_date = '2026-01-01', account_map = account_map || '{"retained":"Q120"}' where id = 1`;
  await ob.saveOpening(fin as never, [{ account: 'A120', dr: 100000, cr: 0 }, { account: 'Q110', dr: 0, cr: 100000 }]);
  await ob.postOpening(fin as never);
  const party = (await sql`insert into parties (code, type, name) values ('CU0009', 'customer', 'Hassan') returning id`)[0].id;
  await sales.saveSalesInvoice(fin as never, { date: '2026-09-03', due: '2026-09-20', party, project: 'ph-b1302', ref: '', vatRate: 14, lines: [{ acc: 'R110', desc: 'Design', qty: 1, price: 20000 }] }, true);
  await books.saveEntry(fin as never, { date: '2026-09-10', ref: '', form: { type: 'expense', memo: 'Wood', bank: 'A120', vatRate: 0, items: [{ project: 'ph-b1302', acc: '25001-1', amount: 3000 }] } }, 'post');
  await books.saveEntry(fin as never, { date: '2026-08-10', ref: '', form: { type: 'expense', memo: 'Wood', bank: 'A120', vatRate: 0, items: [{ project: 'ph-b1302', acc: '25001-1', amount: 1000 }] } }, 'post');
});
afterAll(async () => { await sql.end(); });

describe('statements pack', () => {
  it('profit and loss for the month and the year to date', async () => {
    const p = await statementsPack('2026-09');
    expect(p).toMatchObject({ from: '2026-09-01', to: '2026-09-30', ytdFrom: '2026-01-01' });
    const pl = (await sql`select coalesce(sum(case when a.type = 'revenue' then l.cr - l.dr else l.cr - l.dr end), 0)::float n from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.code = l.account and a.type in ('revenue','expense') where e.date between '2026-09-01' and '2026-09-30'`)[0].n;
    expect(p.pl.totals.profit[0]).toBeCloseTo(pl, 2);
    expect(p.pl.revenue.find(l => l.code === 'R110')).toMatchObject({ month: 20000 });
    expect(p.pl.expense.find(l => l.code === '25001-1')).toMatchObject({ month: 3000, ytd: 4000 });
  });
  it('the balance sheet balances, and the cash flow ends on the cash in the books', async () => {
    const p = await statementsPack('2026-09');
    expect(p.bs.totals.assets[0]).toBeCloseTo(p.bs.totals.le[0], 2);
    expect(p.bs.totals.assets[1]).toBeCloseTo(p.bs.totals.le[1], 2);
    expect(p.cf.totals.closing[0]).toBeCloseTo(await cashAt('2026-09-30'), 2);
    expect(p.cf.totals.closing[1]).toBeCloseTo(await cashAt('2026-09-30'), 2);
    expect(p.cf.totals.opening[0]).toBeCloseTo(await cashAt('2026-08-31'), 2);
    expect(p.cf.operating[0].label).toBe('Profit for the period');
    expect(p.cf.operating.find(l => /receivable/i.test(l.label) || l.codes.includes('A130'))?.month).toBe(-22800); // invoiced, not yet collected
    expect(p.cf.financing.some(l => l.codes.includes('Q110'))).toBe(false); // the opening entry is the start, not a flow
    const tb = p.tb.reduce((t, r) => [t[0] + r.dr, t[1] + r.cr], [0, 0]);
    expect(tb[0]).toBeCloseTo(tb[1], 2);
  });
  it('writes an Excel workbook with a sheet per statement that reads back', async () => {
    const p = await statementsPack('2026-09');
    const buf = writeXlsx(packSheets(p));
    const files = unzip(buf);
    expect([...files.keys()]).toContain('xl/worksheets/sheet4.xml');
    expect(files.get('xl/workbook.xml')!.toString()).toContain('name="Cash flow"');
    const rows = readXlsx(buf);
    expect(rows[0]).toEqual(['GL code', 'Account', 'September 2026', 'Year to date (from 2026-01-01)']);
    expect(rows.find(r => r[0] === 'Net profit')?.[2]).toBe(String(p.pl.totals.profit[0]));
    expect(unzip(zip([['a.txt', 'héllo']])).get('a.txt')!.toString()).toBe('héllo');
  });
});
