// Runs against a throwaway database (TEST_DATABASE_URL, default rsa_test), loaded from the old app's snapshot.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.DATABASE_URL = URL;

const { sql } = await import('@/lib/db');
const books = await import('@/lib/books');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const SNAPSHOT = process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js';
const finance = { id: '', email: 'fin@test', name: 'Finance', roles: ['finance'] as const };
const engineer = { id: '', email: 'eng@test', name: 'Engineer', roles: ['engineering'] as const };

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(SNAPSHOT, 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null`;
  for (const u of [finance, engineer]) {
    const [r] = await sql<{ id: string }[]>`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${[...u.roles]}) returning id`;
    u.id = r.id;
  }
});
afterAll(async () => { await sql.end(); });

const tb = async () => {
  const rows = await books.trialBalance();
  return { dr: rows.reduce((s, r) => s + r.dr, 0), cr: rows.reduce((s, r) => s + r.cr, 0), rows };
};

describe('imported books', () => {
  it('match the old app: trial balance agrees and balances are as before', async () => {
    const t = await tb();
    expect(t.dr).toBeCloseTo(t.cr, 2);
    const bal = Object.fromEntries(t.rows.map(r => [r.code, r.dr - r.cr]));
    expect(bal).toEqual({ '12001': 225000, A120: -175000, L110: 0, R110: -50000 });
  });
});

describe('daily entries', () => {
  it('Finance posts an expense straight away', async () => {
    const id = await books.saveEntry(finance as never, {
      date: '2026-10-10', ref: 'INV-1',
      form: { type: 'expense', memo: 'Electricity', bank: 'A110', vatRate: 0, items: [{ dept: 'fin', acc: '11003', amount: 1200 }] },
    }, 'post');
    const [e] = await sql`select status, no from journal_entries where id = ${id}`;
    expect(e.status).toBe('posted');
    expect(e.no).toBe('JE-00004');
  });

  it('an engineer can only submit; Finance approves', async () => {
    const id = await books.saveEntry(engineer as never, {
      date: '2026-10-10', ref: '',
      form: { type: 'expense', memo: 'Cement', bank: 'A110', items: [{ project: 'ph-b1302', acc: '24004-1', amount: 800 }] },
    }, 'post');
    expect((await sql`select status from journal_entries where id = ${id}`)[0].status).toBe('pending');
    await expect(books.approveEntry(engineer as never, id)).rejects.toThrow(/Finance/);
    await books.approveEntry(finance as never, id);
    expect((await sql`select status from journal_entries where id = ${id}`)[0].status).toBe('posted');
  });

  it('refuses expense lines with no project or department', async () => {
    await expect(books.saveEntry(finance as never, {
      date: '2026-10-10', ref: '', form: { type: 'expense', memo: 'x', bank: 'A110', items: [{ acc: '11003', amount: 5 }] },
    }, 'post')).rejects.toThrow(/Assign every expense line/);
  });

  it("refuses another project's GL code", async () => {
    await expect(books.saveEntry(finance as never, {
      date: '2026-10-10', ref: '', form: { type: 'expense', memo: 'x', bank: 'A110', items: [{ project: 'cs-ch2505', acc: '24004-1', amount: 5 }] },
    }, 'post')).rejects.toThrow(/another project/);
  });

  it('posted entries cannot be edited or deleted, even directly in the database', async () => {
    const [e] = await sql`select id from journal_entries where status = 'posted' limit 1`;
    await expect(sql`update journal_entries set memo = 'changed' where id = ${e.id}`).rejects.toThrow(/cannot be changed/);
    await expect(sql`delete from journal_entries where id = ${e.id}`).rejects.toThrow(/cannot be deleted/);
    await expect(sql`update journal_lines set dr = dr + 1 where entry_id = ${e.id}`).rejects.toThrow(/posted/);
  });

  it('the database refuses an unbalanced entry', async () => {
    const [{ id }] = await sql`insert into journal_entries (no, date, kind) values ('TEST-1', '2026-10-10', 'adjustment') returning id`;
    await sql`insert into journal_lines (entry_id, line_no, account, dr) values (${id}, 1, 'A110', 10)`;
    await sql`insert into journal_lines (entry_id, line_no, account, cr) values (${id}, 2, 'A120', 9)`;
    await expect(sql`update journal_entries set status = 'posted' where id = ${id}`).rejects.toThrow(/not balanced/);
    await sql`delete from journal_entries where id = ${id}`;
  });

  it('reversal posts the mirror entry and links both', async () => {
    const [e] = await sql`select id, no from journal_entries where memo = 'Electricity'`;
    const rid = await books.reverseEntry(finance as never, e.id, 'wrong amount', '2026-10-11');
    const [o] = await sql`select reversed_by from journal_entries where id = ${e.id}`;
    expect(o.reversed_by).toBe(rid);
    const bal = (await books.trialBalance()).find(r => r.code === '11003')!;
    expect(bal.dr - bal.cr).toBe(0);
    await expect(books.reverseEntry(finance as never, e.id, '', '2026-10-11')).rejects.toThrow(/already reversed/);
  });

  it('lock date stops posting on or before it', async () => {
    await sql`update settings set lock_date = '2026-10-31'`;
    await expect(books.saveEntry(finance as never, {
      date: '2026-10-15', ref: '', form: { type: 'transfer', memo: 't', bank: 'A120', toBank: 'A110', amount: 10, items: [] },
    }, 'post')).rejects.toThrow(/locked/);
    await sql`update settings set lock_date = null`;
  });

  it('trial balance still balances', async () => {
    const t = await tb();
    expect(t.dr).toBeCloseTo(t.cr, 2);
  });
});

describe('projects', () => {
  it('a new project gets header 20000-N and its own copy of the project GL codes', async () => {
    await sql.begin(async tx => {
      await tx`insert into projects (id, code, name) values ('p-new', 'NEW-1', 'New project')`;
      const r = await books.createProjectCodes(tx, 'p-new', 'NEW-1');
      expect(r.suffix).toBe(4);
      expect(r.count).toBe(32);
    });
    const codes = await sql`select code from accounts where project_id = 'p-new' order by code`;
    expect(codes[0].code).toBe('20000-4');
    expect(codes.map(c => c.code)).toContain('21001-4');
    expect(codes.length).toBe(33);
  });
});
