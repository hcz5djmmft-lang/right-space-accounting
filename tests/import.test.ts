// The cut-over import: old books that carry a lock date come in whole, and the approvers ticked in Settings survive --replace.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const SNAPSHOT = process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js';
const seed = () => {
  const ctx = { window: {} as Record<string, { settings: { company: Record<string, unknown> }; journal: Record<string, { date: string; status: string }> }> };
  vm.runInNewContext(fs.readFileSync(SNAPSHOT, 'utf8'), ctx);
  return ctx.window.__SEED;
};

let adel = '';
beforeAll(async () => {
  adel = (await sql`insert into users (email, name, password_hash, roles) values ('adel@x.test', 'Adel', 'x', '{management}')
    on conflict (email) do update set name = excluded.name returning id`)[0].id;
});
afterAll(async () => { await sql`update approval_steps set user_ids = '{}'`; await sql.end(); });

describe('cut-over import', () => {
  it('loads books that are locked up to a date, and keeps that lock date', async () => {
    const d = seed();
    const posted = Object.values(d.journal).filter(e => e.status === 'posted').map(e => e.date).sort();
    const lockDate = posted[posted.length - 1]; // every posted entry is on or before the lock date
    d.settings.company.lockDate = lockDate;
    await importOld(sql, d, { replace: true });
    const [s] = await sql<{ lock_date: string; n: number }[]>`select to_char(lock_date, 'YYYY-MM-DD') lock_date, (select count(*)::int from journal_entries where status = 'posted') n from settings`;
    expect(s.lock_date).toBe(lockDate);
    expect(s.n).toBe(posted.length);
  });

  it('keeps the approvers ticked in Settings across a --replace', async () => {
    await sql`update approval_steps set user_ids = ${[adel]} where position = 1`;
    const d = seed();
    d.settings.company.lockDate = '';
    await importOld(sql, d, { replace: true });
    const steps = await sql<{ position: number; user_ids: string[] }[]>`select position, user_ids from approval_steps order by position`;
    expect(steps[0].user_ids).toEqual([adel]);
    expect(steps.length).toBe(3);
  });
});
