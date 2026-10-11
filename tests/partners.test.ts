// Partners against the test database (see books.test.ts for setup notes): money put in, withdrawals, sharing out the
// profit of a period by share, reversals, and the reconciliation groups for partners' money.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const partners = await import('@/lib/partners');
const books = await import('@/lib/books');
const banks = await import('@/lib/banks');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'management')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const mgt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'] };

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, mgt]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  // what migrations 011 and 013 add to the live books; the snapshot import wipes it, so it is put back here
  await sql`insert into bank_accounts (account, kind, ref_prefix) values ('A120', 'bank', 'CIB-34-'), ('A110', 'cash', 'PT-')`;
  await sql`insert into accounts (code, name, type, parent, postable, is_system) values
    ('Q111', 'Current account – Adel', 'equity', 'Q100', true, true), ('Q112', 'Current account – Haitham', 'equity', 'Q100', true, true),
    ('Q113', 'Current account – Youssef', 'equity', 'Q100', true, true), ('Q114', 'Current account – Marwan', 'equity', 'Q100', true, true)`;
  await sql`insert into partners (id, name, share, account, sort) values ('adel', 'Adel Maksoud', 25, 'Q111', 1), ('haitham', 'Haitham', 25, 'Q112', 2), ('youssef', 'Youssef', 25, 'Q113', 3), ('marwan', 'Marwan', 25, 'Q114', 4)`;
  await sql`update settings set account_map = account_map || '{"retained": "Q120"}'::jsonb, lock_date = null where id = 1`;
});
afterAll(async () => { await sql.end(); });

const find = async (id: string) => (await partners.listPartners()).find(p => p.id === id)!;

describe('partners', () => {
  it('lists the four partners at 25% each with empty current accounts', async () => {
    const list = await partners.listPartners();
    expect(list.map(p => [p.name, Number(p.share), p.account, p.balance])).toEqual([['Adel Maksoud', 25, 'Q111', 0], ['Haitham', 25, 'Q112', 0], ['Youssef', 25, 'Q113', 0], ['Marwan', 25, 'Q114', 0]]);
  });

  it("money put in goes into the bank and onto the partner's current account", async () => {
    const id = await partners.postDeposit(fin as never, { partner: 'adel', bank: 'A120', date: '2026-10-11', amount: 500000, memo: '' });
    const lines = await sql<{ account: string; dr: number; cr: number }[]>`select account, dr, cr from journal_lines where entry_id = ${id} order by line_no`;
    expect(lines.map(l => [l.account, l.dr, l.cr])).toEqual([['A120', 500000, 0], ['Q111', 0, 500000]]);
    expect(await sql`select kind, payment_ref from journal_entries where id = ${id}`).toEqual([{ kind: 'partner', payment_ref: null }]);
    expect(await find('adel')).toMatchObject({ deposits: 500000, withdrawals: 0, balance: 500000 });
    await expect(partners.postDeposit(mgt as never, { partner: 'nobody', bank: 'A120', date: '2026-10-11', amount: 1, memo: '' })).rejects.toThrow(/partner/);
    await expect(partners.postDeposit(fin as never, { partner: 'adel', bank: 'Q110', date: '2026-10-11', amount: 1, memo: '' })).rejects.toThrow(/bank or cash/);
  });

  it('a withdrawal comes off the current account and gets a payment reference', async () => {
    const id = await partners.postWithdrawal(fin as never, { partner: 'adel', bank: 'A120', date: '2026-10-12', amount: 20000, memo: '' });
    expect((await sql`select payment_ref from journal_entries where id = ${id}`)[0].payment_ref).toMatch(/^CIB-34-\d{5}$/);
    expect(await find('adel')).toMatchObject({ deposits: 500000, withdrawals: 20000, balance: 480000 });
  });

  it("the bank summary shows partners' deposits coming in and withdrawals going out", async () => {
    const sum = await banks.bankSummary('A120', '2026-10-11', '2026-10-12');
    expect(sum.in.find(g => g.group === "Partners' deposits")).toMatchObject({ total: 500000, count: 1 });
    expect(sum.out.find(g => g.group === "Partners' withdrawals")).toMatchObject({ total: 20000, count: 1 });
  });

  it('a reversed deposit nets out of money put in', async () => {
    const id = await partners.postDeposit(fin as never, { partner: 'haitham', bank: 'A110', date: '2026-10-12', amount: 1000, memo: 'typo' });
    await books.reverseEntry(fin as never, id, 'typo', '2026-10-12');
    expect(await find('haitham')).toMatchObject({ deposits: 0, withdrawals: 0, other: 0, balance: 0 });
  });

  it('splits by share to the piastre', () => {
    const parts = partners.splitByShare(100.01, [{ id: 'a', share: 25 }, { id: 'b', share: 25 }, { id: 'c', share: 25 }, { id: 'd', share: 25 }]);
    expect(parts.map(p => p.amount)).toEqual([25, 25, 25, 25.01]);
    expect(partners.splitByShare(90, [{ id: 'a', share: 50 }, { id: 'b', share: 25 }, { id: 'c', share: 25 }]).map(p => p.amount)).toEqual([45, 22.5, 22.5]);
  });

  it("shares out a period's profit from retained earnings by share, once", async () => {
    // a period with only these two entries: 40,000 revenue and 10,000 of expenses = 30,000 profit
    await books.saveEntry(fin as never, { date: '2027-01-05', ref: '', form: { type: 'collection', memo: 'Design fee', bank: 'A120', items: [{ acc: 'R110', amount: 40000, project: 'cs-ch2505' }] } }, 'post');
    await books.saveEntry(fin as never, { date: '2027-01-06', ref: '', form: { type: 'expense', memo: 'Rent', bank: 'A120', items: [{ acc: '12001', amount: 10000, project: 'office' }] } }, 'post');
    expect(await partners.profitFor('2027-01-01', '2027-01-31')).toEqual({ revenue: 40000, expense: 10000, profit: 30000 });
    await expect(partners.shareProfit(fin as never, { from: '2027-01-01', to: '2027-01-31', date: '2027-01-31' })).rejects.toThrow(/Management/);
    const id = await partners.shareProfit(mgt as never, { from: '2027-01-01', to: '2027-01-31', date: '2027-01-31' });
    const lines = await sql<{ account: string; dr: number; cr: number }[]>`select account, dr, cr from journal_lines where entry_id = ${id} order by line_no`;
    expect(lines.map(l => [l.account, l.dr, l.cr])).toEqual([['Q120', 30000, 0], ['Q111', 0, 7500], ['Q112', 0, 7500], ['Q113', 0, 7500], ['Q114', 0, 7500]]);
    expect(await find('marwan')).toMatchObject({ profit: 7500, balance: 7500 });
    await expect(partners.shareProfit(mgt as never, { from: '2027-01-15', to: '2027-02-15', date: '2027-02-15' })).rejects.toThrow(/already shared/);
    // reversing the share frees the period again
    await books.reverseEntry(fin as never, id, 'redo', '2027-01-31');
    expect(await find('marwan')).toMatchObject({ profit: 0, balance: 0 });
    await partners.shareProfit(mgt as never, { from: '2027-01-01', to: '2027-01-31', date: '2027-01-31' });
    expect((await partners.profitShares()).map(s => [s.date_from, s.profit, s.reversed])).toEqual([['2027-01-01', 30000, false], ['2027-01-01', 30000, true]]);
  });

  it('a loss is charged to the partners', async () => {
    await books.saveEntry(fin as never, { date: '2027-02-03', ref: '', form: { type: 'expense', memo: 'Rent', bank: 'A120', items: [{ acc: '12001', amount: 8000, project: 'office' }] } }, 'post');
    const id = await partners.shareProfit(mgt as never, { from: '2027-02-01', to: '2027-02-28', date: '2027-02-28' });
    const lines = await sql<{ account: string; dr: number; cr: number }[]>`select account, dr, cr from journal_lines where entry_id = ${id} order by line_no`;
    expect(lines.map(l => [l.account, l.dr, l.cr])).toEqual([['Q111', 2000, 0], ['Q112', 2000, 0], ['Q113', 2000, 0], ['Q114', 2000, 0], ['Q120', 0, 8000]]);
    expect(await find('youssef')).toMatchObject({ profit: 5500, balance: 5500 });
    expect((await partners.partnerStatement('Q113')).map(l => [l.action, l.dr, l.cr])).toEqual([['profit', 0, 7500], ['profit', 7500, 0], ['profit', 0, 7500], ['profit', 2000, 0]]);
  });
});
