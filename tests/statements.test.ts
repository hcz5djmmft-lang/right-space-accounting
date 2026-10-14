// Bank statement import (improvement 5) against the test database: reading CIB-style files, matching to the books,
// recording charges from a line, and a re-import adding nothing.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const books = await import('@/lib/books');
const st = await import('@/lib/statements');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const eng = { id: '', email: 'eng@x.test', name: 'Omar', roles: ['engineering'] };
let paid = '';
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, bank_statements, statement_imports, statement_lines cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`insert into accounts (code, name, type, parent, postable, is_bank, is_system) values ('R130', 'Bank interest', 'revenue', 'R100', true, false, true)`;
  await sql`insert into accounts (code, name, type, parent, postable, cost_type, project_id) values ('14005', 'رسوم بنكية', 'expense', '10000', true, 'Opex', 'office')`;
  await sql`insert into bank_accounts (account, kind, ref_prefix, bank_name) values ('A120', 'bank', 'CIB-34-', 'CIB')`;
  await sql`update settings set account_map = account_map || '{"bankCharges": "14005", "interest": "R130"}'::jsonb, lock_date = null where id = 1`;
  const dept = (await sql`select id from departments where active order by code limit 1`)[0].id;
  paid = await books.saveEntry(fin as never, { date: '2026-10-05', ref: '', form: { type: 'expense', memo: 'Paint', bank: 'A120', vatRate: 0, items: [{ dept, acc: '14005', amount: 12500 }] } }, 'post');
});
afterAll(async () => { await sql.end(); });

const CSV = `Commercial International Bank
Account statement
Booking Date,Value Date,Reference,Description,Debit,Credit,Balance
06/10/2026,06/10/2026,TRF-889,Transfer to Nile Paints,"12,500.00",,"1,000,000.00"
07/10/2026,07/10/2026,,Account maintenance fee,75.00,,"999,925.00"
08-Oct-2026,08-Oct-2026,,Credit interest,,310.40,"1,000,235.40"
,,,Closing balance,,,"1,000,235.40"
`;

describe('reading a statement', () => {
  it('dates, amounts and the header row as CIB and Excel print them', () => {
    expect(st.parseDate('06/10/2026')).toBe('2026-10-06');
    expect(st.parseDate('2026-10-06')).toBe('2026-10-06');
    expect(st.parseDate('8-Oct-26')).toBe('2026-10-08');
    expect(st.parseDate('46301')).toBe('2026-10-06');
    expect(st.parseDate('٠٦/١٠/٢٠٢٦')).toBe('2026-10-06');
    expect(st.parseDate('31/02/2026')).toBeNull();
    expect(st.parseMoney('(1,234.50)')).toBe(-1234.5);
    expect(st.parseMoney('1,234.50 DR')).toBe(-1234.5);
    expect(st.parseMoney('99 CR')).toBe(99);
    expect(st.parseMoney('')).toBeNull();
    const lines = st.parseStatement(Buffer.from(CSV), 'stmt.csv');
    expect(lines).toEqual([
      { date: '2026-10-06', description: 'Transfer to Nile Paints', ref: 'TRF-889', amount: -12500, balance: 1000000 },
      { date: '2026-10-07', description: 'Account maintenance fee', ref: '', amount: -75, balance: 999925 },
      { date: '2026-10-08', description: 'Credit interest', ref: '', amount: 310.4, balance: 1000235.4 },
    ]);
    const ar = st.parseStatement(Buffer.from('التاريخ,البيان,المبلغ\n2026-10-09,رسوم,-50\n'), 'ar.csv');
    expect(ar).toEqual([{ date: '2026-10-09', description: 'رسوم', ref: '', amount: -50, balance: null }]);
    expect(() => st.parseStatement(Buffer.from('a,b\n1,2\n'))).toThrow(/No header row/);
  });
});

describe('importing and matching', () => {
  it('only Finance imports; lines are matched to the book line of the same amount within days and ticked cleared', async () => {
    await expect(st.importStatement(eng as never, 'A120', 'stmt.csv', Buffer.from(CSV))).rejects.toThrow(/Only Finance/);
    const r = await st.importStatement(fin as never, 'A120', 'stmt.csv', Buffer.from(CSV));
    expect(r).toEqual({ read: 3, added: 3, matched: 1 });
    const lines = await st.statementLines('A120');
    const m = lines.find(l => l.amount === -12500)!;
    expect(m).toMatchObject({ status: 'matched', entry_id: paid, entry_date: '2026-10-05' });
    const [c] = await sql`select count(*)::int n from bank_cleared b join journal_lines l on l.id = b.line_id where l.entry_id = ${paid}`;
    expect(c.n).toBe(1);
    expect((await sql`select to_char(stmt_date,'YYYY-MM-DD') d, stmt_balance::float b from bank_statements where account = 'A120'`)[0]).toEqual({ d: '2026-10-08', b: 1000235.4 });
  });
  it('the same file again adds nothing', async () => {
    expect(await st.importStatement(fin as never, 'A120', 'stmt.csv', Buffer.from(CSV))).toEqual({ read: 3, added: 0, matched: 0 });
  });
  it('charges and interest are recorded from their lines and matched; a line can be set aside and a match undone', async () => {
    const open = (await st.statementLines('A120', { status: 'open' }));
    expect(open.map(l => l.amount).sort()).toEqual([-75, 310.4]);
    for (const l of open) await st.recordFromLine(fin as never, l.id);
    expect(await st.statementCounts('A120')).toEqual({ open: 0, matched: 3, ignored: 0 });
    const fee = (await st.statementLines('A120')).find(l => l.amount === -75)!;
    const [e] = await sql`select e.kind, l.account, l.cr::float cr from journal_entries e join journal_lines l on l.entry_id = e.id and l.account = 'A120' where e.id = ${fee.entry_id}`;
    expect(e).toEqual({ kind: 'expense', account: 'A120', cr: 75 });
    await st.unmatchLine(fin as never, fee.id);
    await st.ignoreLine(fin as never, fee.id);
    expect(await st.statementCounts('A120')).toEqual({ open: 0, matched: 2, ignored: 1 });
    await expect(st.recordFromLine(fin as never, fee.id)).rejects.toThrow(/already matched or set aside/);
  });
});
