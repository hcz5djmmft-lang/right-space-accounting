// Bank reconciliation against the test database (see books.test.ts for setup notes).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const banks = await import('@/lib/banks');
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
});
afterAll(async () => { await sql.end(); });

describe('banks & cash', () => {
  it('lists bank accounts with the imported balances', async () => {
    const list = await banks.bankAccounts();
    expect(list.map(a => a.code)).toEqual(['A110', 'A120']);
    expect(list.find(a => a.code === 'A120')).toMatchObject({ balance: -175000, cleared: 0, stmt_balance: null });
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
