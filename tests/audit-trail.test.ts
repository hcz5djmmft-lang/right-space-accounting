// Audit trail (improvement 16) against the test database: create, edit, post, void and delete are each kept with the
// record before and after and who did it.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const books = await import('@/lib/books');
const at = await import('@/lib/audit-trail');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const form = (amount: number, memo = 'Taxi') => ({ type: 'expense' as const, memo, bank: 'A110', vatRate: 0, items: [{ project: 'ph-b1302', acc: '25001-1', amount }] });
let id = '';
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  fin.id = (await sql`insert into users (email, name, password_hash, roles) values (${fin.email}, ${fin.name}, 'x', ${fin.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null where id = 1`;
  await sql`truncate change_log`;
});
afterAll(async () => { await sql.end(); });

const events = async () => (await at.auditEvents({ tbl: 'journal' })).filter(e => e.row_id === id).reverse();

describe('audit trail', () => {
  it('keeps the draft, the edit with before and after, and the posting, with who did each', async () => {
    id = await books.saveEntry(fin as never, { date: '2026-10-10', ref: '', form: form(100) }, 'draft');
    await books.saveEntry(fin as never, { id, date: '2026-10-11', ref: '', form: form(150, 'Taxi to site') }, 'draft');
    await books.saveEntry(fin as never, { id, date: '2026-10-11', ref: '', form: form(150, 'Taxi to site') }, 'post');
    const e = await events();
    expect(e.map(x => x.op)).toEqual(['create', 'change', 'change']);
    expect(e[0]).toMatchObject({ who: 'Ziad', no: expect.stringMatching(/^JE-/), href: `/entries/${id}` });
    expect(e[1].changes).toEqual(expect.arrayContaining([{ field: 'date', before: '2026-10-10', after: '2026-10-11' }, { field: 'memo', before: 'Taxi', after: 'Taxi to site' }]));
    expect(e[1].lines.map(l => l.kind).sort()).toEqual(['added', 'added', 'removed', 'removed']);
    expect(e[2].changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'status', before: 'draft', after: 'posted' })]));
    expect(e[2].who).toBe('Ziad');
  });
  it('keeps a void (the reversal link) and a deleted draft', async () => {
    await books.reverseEntry(fin as never, id, 'wrong', '2026-10-12');
    const e = await events();
    expect(e.at(-1)!.changes).toEqual([expect.objectContaining({ field: 'reversed_by', before: null })]);
    const d = await books.saveEntry(fin as never, { date: '2026-10-10', ref: '', form: form(5) }, 'draft');
    await sql`delete from journal_entries where id = ${d}`;
    const del = (await at.auditEvents({ tbl: 'journal' })).filter(x => x.row_id === d);
    expect(del.map(x => x.op)).toEqual(['delete', 'create']);
    expect(del[0].href).toBeNull();
  });
  it('finds by number and person, and diffs line by line', async () => {
    const [e] = await sql`select no from journal_entries where id = ${id}`;
    expect((await at.auditEvents({ q: e.no })).filter(x => x.no === e.no)).toHaveLength(4); // the reversal, whose memo names it, comes too
    expect(await at.auditEvents({ who: 'nobody' })).toEqual([]);
    expect(at.diff('payment', { amount: 1, allocations: [{ invoice_id: 'A', amount: 1 }] }, { amount: 2, allocations: [] })).toEqual({ changes: [{ field: 'amount', before: 1, after: 2 }], lines: [{ kind: 'removed', text: 'A: 1.00' }] });
    expect((await at.activity({ who: fin.id })).length).toBeGreaterThan(0);
  });
});
