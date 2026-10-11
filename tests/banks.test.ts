// Banks, the credit card and petty cash against the test database (see books.test.ts for setup notes):
// reference numbers, bank charges and interest, the grouped reconciliation summary and the statement reconciliation.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const banks = await import('@/lib/banks');
const books = await import('@/lib/books');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, bank_statements cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  // what migration 011 adds to the live books; the snapshot import wipes it, so it is put back here
  await sql`insert into accounts (code, name, type, parent, postable, is_bank, is_system) values
    ('L115', 'CIB credit card ···0012', 'liability', 'L100', true, true, true), ('A115', 'Petty cash – accountant', 'asset', 'A100', true, true, true), ('R130', 'Bank interest', 'revenue', 'R100', true, false, true)`;
  await sql`insert into accounts (code, name, type, parent, postable, cost_type, project_id) values ('14005', 'رسوم بنكية', 'expense', '10000', true, 'Opex', 'office')`;
  await sql`insert into bank_accounts (account, kind, ref_prefix, credit_limit, holder, bank_name) values
    ('A120', 'bank', 'CIB-34-', null, null, 'CIB'), ('A110', 'cash', 'PT-', null, 'Office', null), ('A115', 'cash', 'PT-', null, 'Accountant', null), ('L115', 'card', 'CC-12-', 90000, null, 'CIB')`;
  await sql`update settings set account_map = account_map || '{"bankCharges": "14005", "interest": "R130"}'::jsonb where id = 1`;
});
afterAll(async () => { await sql.end(); });

const refOf = async (id: string) => (await sql<{ payment_ref: string | null }[]>`select payment_ref from journal_entries where id = ${id}`)[0].payment_ref;
const post = (form: Parameters<typeof books.saveEntry>[1]['form'], date = '2026-10-11') => books.saveEntry(fin as never, { date, ref: '', form }, 'post');

describe('banks & cash', () => {
  it('lists the bank account, petty cash and the credit card with their kinds and imported balances', async () => {
    const list = await banks.bankAccounts();
    expect(list.map(a => [a.code, a.kind, a.ref_prefix])).toEqual([['A110', 'cash', 'PT-'], ['A115', 'cash', 'PT-'], ['A120', 'bank', 'CIB-34-'], ['L115', 'card', 'CC-12-']]);
    expect(list.find(a => a.code === 'A120')).toMatchObject({ balance: -175000, cleared: 0, stmt_balance: null });
    expect(banks.cardFigures(list.find(a => a.code === 'L115')!)).toEqual({ owed: 0, available: 90000 });
  });

  it('numbers every payment out of a bank, card or cash account: CIB-34-, CC-12- and PT- serials; money in gets none', async () => {
    expect(await refOf(await post({ type: 'expense', memo: 'Taxi', bank: 'A115', vatRate: 0, items: [{ dept: 'fin', acc: '11003', amount: 150 }] }))).toBe('PT-00001');
    expect(await refOf(await post({ type: 'expense', memo: 'Stationery', bank: 'L115', vatRate: 0, items: [{ dept: 'fin', acc: '13002', amount: 250 }] }))).toBe('CC-12-00001');
    expect(await refOf(await post({ type: 'transfer', memo: 'Settle the card', bank: 'A120', toBank: 'L115', amount: 250, items: [] }))).toBe('CIB-34-00001');
    expect(await refOf(await post({ type: 'transfer', memo: 'Top up petty cash', bank: 'A120', toBank: 'A115', amount: 2000, items: [] }))).toBe('CIB-34-00002');
    expect(await refOf(await post({ type: 'expense', memo: 'Tips', bank: 'A110', vatRate: 0, items: [{ dept: 'adm', acc: '11004', amount: 100 }] }))).toBe('PT-00002'); // both cash boxes share the PT- serial
    expect(await refOf(await post({ type: 'collection', memo: 'Client paid', bank: 'A120', items: [{ acc: 'R110', project: 'ph-b1302', amount: 30000 }] }))).toBeNull();
    const card = (await banks.bankAccounts()).find(a => a.code === 'L115')!;
    expect(banks.cardFigures(card)).toEqual({ owed: 0, available: 90000 }); // 250 spent, 250 settled
    expect((await banks.bankActivity('A120')).filter(l => l.ref).map(l => l.ref)).toEqual(['CIB-34-00001', 'CIB-34-00002']);
  });

  it('a pending entry is numbered when it posts, not before', async () => {
    const id = await books.saveEntry(eng as never, { date: '2026-10-11', ref: '', form: { type: 'expense', memo: 'Cement', bank: 'A115', items: [{ project: 'ph-b1302', acc: '28004-1', amount: 300 }] } }, 'post');
    expect(await refOf(id)).toBeNull();
    await books.approveEntry(fin as never, id);
    expect(await refOf(id)).toBe('PT-00003');
  });

  it('bank charges go to the bank-charges code under Finance and are numbered; interest comes in against Bank interest', async () => {
    await expect(banks.postBankCharge(eng as never, { bank: 'A120', date: '2026-10-11', amount: 35.5, memo: '' })).rejects.toThrow(/Only Finance/);
    await expect(banks.postBankCharge(fin as never, { bank: 'A115', date: '2026-10-11', amount: 35.5, memo: '' })).rejects.toThrow(/not a bank account/);
    await expect(banks.postBankCharge(fin as never, { bank: 'A120', date: '2026-10-11', amount: 0, memo: '' })).rejects.toThrow(/amount/);
    const c = await banks.postBankCharge(fin as never, { bank: 'A120', date: '2026-10-11', amount: 35.5, memo: '' });
    const lines = await sql`select l.account, l.dr, l.cr, l.dept_id, e.status, e.memo from journal_lines l join journal_entries e on e.id = l.entry_id where e.id = ${c} order by l.line_no`;
    expect(lines.map(l => [l.account, l.dr, l.cr, l.dept_id])).toEqual([['14005', 35.5, 0, 'fin'], ['A120', 0, 35.5, null]]);
    expect(lines[0]).toMatchObject({ status: 'posted', memo: 'Bank charges' });
    expect(await refOf(c)).toBe('CIB-34-00003');
    const i = await banks.postInterest(fin as never, { bank: 'A120', date: '2026-10-11', amount: 120, memo: '' });
    const il = await sql`select l.account, l.dr, l.cr from journal_lines l where l.entry_id = ${i} order by l.line_no`;
    expect(il.map(l => [l.account, l.dr, l.cr])).toEqual([['A120', 120, 0], ['R130', 0, 120]]);
    expect(await refOf(i)).toBeNull();
  });

  it('the reconciliation summary groups money out and in the way the statement is read, for all dates or a period', async () => {
    const all = await banks.bankSummary('A120');
    expect(all.out).toEqual(expect.arrayContaining([
      { group: 'Bank charges', total: 35.5, count: 1 }, { group: 'Credit card settlement', total: 250, count: 1 }, { group: 'Transfers between accounts', total: 2000, count: 1 }]));
    expect(all.in).toEqual(expect.arrayContaining([{ group: 'Interest', total: 120, count: 1 }]));
    expect(all.in.find(g => g.group === 'Collections')!.total).toBeGreaterThanOrEqual(30000);
    expect(all.opening).toBe(0);
    const a120 = (await banks.bankAccounts()).find(a => a.code === 'A120')!;
    expect(all.closing).toBe(a120.balance);
    const oct = await banks.bankSummary('A120', '2026-10-11', '2026-10-11');
    expect(oct.opening).toBe(-175000); // the imported balance, all of it before October 11
    expect(oct.totalOut).toBe(2285.5);
    expect(oct.totalIn).toBe(30120);
    expect(oct.closing).toBe(a120.balance);
  });

  it('only Finance reconciles', async () => {
    await expect(banks.saveStatement(eng as never, 'A120', '2026-09-30', 0)).rejects.toThrow(/Only Finance/);
    await expect(banks.setCleared(eng as never, 'A120', [1], [1])).rejects.toThrow(/Only Finance/);
    await expect(banks.saveStatement(fin as never, 'R110', '2026-09-30', 0)).rejects.toThrow(/not a bank/);
  });
  it('ticking the lines on the statement reconciles the account; untick and the difference comes back', async () => {
    const lines = await banks.bankActivity('A120');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(l => !l.cleared)).toBe(true);
    const ids = lines.map(l => Number(l.line_id));
    const total = lines.reduce((s, l) => s + l.dr - l.cr, 0);
    await banks.saveStatement(fin as never, 'A120', '2026-10-09', total);
    let a = (await banks.bankAccounts()).find(x => x.code === 'A120')!;
    expect(banks.reconcile(a)).toMatchObject({ uncleared: total, difference: total, reconciled: false });
    await banks.setCleared(fin as never, 'A120', ids, ids);
    a = (await banks.bankAccounts()).find(x => x.code === 'A120')!;
    expect(a.cleared).toBe(total);
    expect(banks.reconcile(a)).toMatchObject({ uncleared: 0, difference: 0, reconciled: true });
    await banks.setCleared(fin as never, 'A120', ids, ids.slice(1));
    a = (await banks.bankAccounts()).find(x => x.code === 'A120')!;
    expect(banks.reconcile(a).reconciled).toBe(false);
    expect((await banks.bankActivity('A120'))[0].cleared).toBe(false);
  });
  it('ignores line ids that are not on this bank account', async () => {
    const [other] = await sql<{ id: number }[]>`select l.id from journal_lines l where l.account <> 'A120' limit 1`;
    await banks.setCleared(fin as never, 'A120', [Number(other.id)], [Number(other.id)]);
    expect(await sql`select 1 from bank_cleared where line_id = ${other.id}`).toHaveLength(0);
  });
});
