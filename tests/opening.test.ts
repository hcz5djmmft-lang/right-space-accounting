// Opening balances (improvement 8) against the test database: typed figures, the difference to retained earnings,
// one opening entry in force, void and post again, Finance only.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const ob = await import('@/lib/opening');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const eng = { id: '', email: 'eng@x.test', name: 'Youssef', roles: ['engineering'] };
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, opening_balances cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null, opening_date = '2026-01-01', account_map = account_map || '{"retained":"Q120"}' where id = 1`;
  await sql`insert into accounts (code, name, type, parent, postable, is_system) values ('Q111', 'Current account – Adel', 'equity', 'Q100', true, true), ('A115', 'Petty cash', 'asset', 'A100', true, false) on conflict do nothing`;
  await sql`insert into partners (id, name, share, account, sort) values ('adel', 'Adel', 25, 'Q111', 0) on conflict do nothing`;
});
afterAll(async () => { await sql.end(); });

const balance = async (code: string) => (await sql`select coalesce(sum(l.dr - l.cr), 0)::float b from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = ${code} and e.source_type = 'opening'`)[0].b;

describe('opening balances', () => {
  it('only Finance enters them', async () => {
    await expect(ob.saveOpening(eng as never, [{ account: 'A120', dr: 100, cr: 0 }])).rejects.toThrow(/Only Finance/);
    await expect(ob.postOpening(eng as never)).rejects.toThrow(/Only Finance/);
  });
  it('saves the figures and puts the difference on retained earnings', async () => {
    await ob.saveOpening(fin as never, [{ account: 'A120', dr: 500000, cr: 0 }, { account: 'A115', dr: 5000, cr: 0 }, { account: 'Q111', dr: 0, cr: 300000 }, { account: 'A110', dr: 50, cr: 50 }]);
    expect((await sql`select count(*)::int n from opening_balances`)[0].n).toBe(3);
    const t = await ob.openingLines();
    expect(t).toMatchObject({ dr: 505000, cr: 300000, difference: 205000, retained: 'Q120' });
    expect(t.lines.at(-1)).toMatchObject({ account: 'Q120', cr: 205000, dr: 0 });
    const rows = await ob.openingRows();
    expect(rows[0].partner).toBeTruthy(); // partners' current accounts first
    expect(rows.find(r => r.code === 'Q111')).toMatchObject({ cr: 300000, dr: 0 });
  });
  it('posts one opening entry, refuses a second, and posts again after a void', async () => {
    const id = await ob.postOpening(fin as never);
    const [e] = await sql`select to_char(date,'YYYY-MM-DD') date, kind, status from journal_entries where id = ${id}`;
    expect(e).toEqual({ date: '2026-01-01', kind: 'adjustment', status: 'posted' });
    expect(await balance('A120')).toBe(500000);
    expect(await balance('Q120')).toBe(-205000);
    await expect(ob.postOpening(fin as never)).rejects.toThrow(/already posted/);
    await ob.voidOpening(fin as never, 'typo');
    expect(await ob.openingEntry()).toBeNull();
    await ob.saveOpening(fin as never, [{ account: 'A120', dr: 400000, cr: 0 }]);
    await ob.postOpening(fin as never);
    const net = (await sql`select coalesce(sum(l.dr - l.cr), 0)::float b from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = 'A120' and e.date = '2026-01-01'`)[0].b;
    expect(net).toBe(400000);
    expect((await ob.openingEntry())!.date).toBe('2026-01-01');
  });
});
