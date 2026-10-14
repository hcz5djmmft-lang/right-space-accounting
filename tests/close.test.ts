// Month-end close (improvement 9) against the test database: the checklist ticks itself from the books, Finance ticks
// the rest, Management locks the books to the month end (which then refuses postings) and can reopen with a reason.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const books = await import('@/lib/books');
const close = await import('@/lib/close');
const tax = await import('@/lib/tax-returns');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const mgmt = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'] };
const P = '2026-09';
const item = async (key: string) => (await close.closeChecklist(P)).items.find(i => i.key === key)!;
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, month_closes, vat_returns, bank_statements, statement_lines cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, mgmt]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null, opening_date = '2026-01-01' where id = 1`;
  await books.saveEntry(fin as never, { date: '2026-09-10', ref: '', form: { type: 'transfer', memo: 'Cash to bank', bank: 'A110', toBank: 'A120', amount: 1000, items: [] } }, 'post');
});
afterAll(async () => { await sql.end(); });

describe('month-end close', () => {
  it('lists the months from the opening date, newest first', async () => {
    const months = await close.closeMonths(new Date('2026-10-14T09:00:00Z'));
    expect(months[0]).toMatchObject({ period: '2026-10', current: true });
    expect(months.at(-1)).toMatchObject({ period: '2026-01', name: 'January 2026', end: '2026-01-31' });
  });
  it('ticks the bank once every statement reaches the month end and agrees', async () => {
    expect(await item('bank')).toMatchObject({ auto: true, done: false });
    await sql`insert into bank_cleared (line_id) select l.id from journal_lines l join accounts a on a.code = l.account and a.is_bank`;
    await sql`insert into bank_statements (account, stmt_date, stmt_balance)
      select a.code, '2026-09-30', coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = a.code), 0)
      from accounts a where a.is_bank and a.postable`;
    expect((await item('bank')).done).toBe(true);
    await sql`insert into statement_lines (account, line_key, date, amount) values ('A120', 'x1', '2026-09-20', -15)`;
    expect(await item('bank')).toMatchObject({ done: false, detail: expect.stringContaining('1 statement lines not matched') });
    await sql`update statement_lines set status = 'ignored'`;
  });
  it('ticks payroll when the run is posted (or there is no staff) and flags drafts left in the month', async () => {
    const staff = (await sql`select count(*)::int n from employees where active`)[0].n;
    expect((await item('payroll')).done).toBe(staff === 0);
    await sql`update employees set active = false`;
    expect((await item('payroll')).done).toBe(true);
    await books.saveEntry(fin as never, { date: '2026-09-12', ref: '', form: { type: 'transfer', memo: 'Draft', bank: 'A110', toBank: 'A120', amount: 5, items: [] } }, 'draft');
    expect(await item('waiting')).toMatchObject({ done: false, detail: '1 entries still draft or waiting' });
    await sql`delete from journal_entries where status = 'draft'`;
    expect((await item('waiting')).done).toBe(true);
  });
  it('Finance ticks petty cash; the system items cannot be ticked by hand', async () => {
    await expect(close.tickItem(fin as never, P, 'bank', true)).rejects.toThrow(/by itself/);
    await expect(close.tickItem(fin as never, P, 'vat', true)).rejects.toThrow(/by itself/);
    await close.tickItem(fin as never, P, 'petty', true);
    await close.tickItem(fin as never, P, 'petty', false);
    expect(await item('petty')).toMatchObject({ done: true, detail: 'No petty cash this month' }); // no petty cash box in this data
    await close.tickItem(fin as never, P, 'petty', true);
    expect((await item('petty')).detail).toMatch(/^Ticked by Ziad/);
  });
  it('only Management locks; open items stop it unless locked anyway; the lock refuses postings in the month', async () => {
    await expect(close.closeMonth(fin as never, P)).rejects.toThrow(/Only Management/);
    await expect(close.closeMonth(mgmt as never, P)).rejects.toThrow(/Still open: vat return prepared/);
    await tax.prepareVatReturn(fin as never, P);
    expect((await item('vat')).detail).toMatch(/^Prepared by Ziad/);
    expect((await close.closeChecklist(P)).ready).toBe(true);
    await close.closeMonth(mgmt as never, P);
    expect((await books.getSettings()).lock_date).toBe('2026-09-30');
    expect((await close.closeChecklist(P)).locked).toBe(true);
    await expect(books.saveEntry(fin as never, { date: '2026-09-29', ref: '', form: { type: 'transfer', memo: 'Late', bank: 'A110', toBank: 'A120', amount: 5, items: [] } }, 'post')).rejects.toThrow(/locked up to 2026-09-30/);
    await expect(close.closeMonth(mgmt as never, P)).rejects.toThrow(/already locked/);
  });
  it('Management reopens with a reason, back to the previous month end', async () => {
    await expect(close.reopenMonth(mgmt as never, P, '')).rejects.toThrow(/Say why/);
    await expect(close.reopenMonth(fin as never, P, 'x')).rejects.toThrow(/Only Management/);
    await close.reopenMonth(mgmt as never, P, 'Late vendor invoice');
    expect((await books.getSettings()).lock_date).toBe('2026-08-31');
    expect((await close.closeChecklist(P)).closedAt).toBeNull();
    await close.reopenMonth(mgmt as never, '2026-01', 'Opening entry');
    expect((await books.getSettings()).lock_date).toBeNull();
  });
});
