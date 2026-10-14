// Expense capture from the phone (improvement 6) against the test database: the receipt, the payment request approvals,
// the entry on the last approval (petty cash, card or own money) and the reimbursement.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

vi.mock('web-push', () => ({ default: { generateVAPIDKeys: () => ({ publicKey: 'P', privateKey: 'Q' }), sendNotification: async () => {} } }));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-exp-'));
const { sql } = await import('@/lib/db');
const ex = await import('@/lib/expenses');
const docs = await import('@/lib/documents');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[] };
const site: U = { id: '', email: 'site@x.test', name: 'Sara Site', roles: [] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Youssef', roles: ['engineering'] };
const adel: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'] };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
const base = { date: '2026-10-13', amount: 350, account: '25001-1', project: 'ph-b1302', description: 'Screws and silicone', paidFrom: 'A115' };

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, expense_claims cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [site, eng, adel]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${eng.id} where id = 'eng'`;
  await sql`delete from approval_steps`;
  await sql`insert into approval_steps (position, name, user_ids) values (1, 'Department head', '{}'), (2, 'Management', ${[adel.id]})`;
  await sql`insert into accounts (code, name, type, parent, postable, is_bank, is_system) values ('A115', 'Petty cash – accountant', 'asset', 'A100', true, true, true) on conflict do nothing`;
  await sql`insert into bank_accounts (account, kind, ref_prefix, holder) values ('A115', 'cash', 'PT-', 'Accountant'), ('A120', 'bank', 'CIB-34-', null) on conflict do nothing`;
  await sql`update settings set lock_date = null, require_cc = true where id = 1`;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('expenses from the phone', () => {
  let id = '';
  it('needs the receipt photo, a project or department, and a GL code that fits', async () => {
    await expect(ex.recordExpense(site as never, base, null)).rejects.toThrow(/photo of the receipt/);
    await expect(ex.recordExpense(site as never, base, { name: 'r.txt', body: Buffer.from('hello') })).rejects.toThrow(/must be a photo/);
    await expect(ex.recordExpense(site as never, { ...base, project: null }, { name: 'r.jpg', body: JPEG })).rejects.toThrow(/project or the department/);
    await expect(ex.recordExpense(site as never, { ...base, paidFrom: 'A120' }, { name: 'r.jpg', body: JPEG })).rejects.toThrow(/paid from/);
    expect((await sql`select count(*)::int n from expense_claims`)[0].n).toBe(0);
    id = await ex.recordExpense(site as never, base, { name: 'r.jpg', body: JPEG });
    expect(await ex.getExpense(id)).toMatchObject({ no: 'EX-00001', status: 'pending', receipts: 1, approver_label: 'Engineering head', approver_id: eng.id });
  });
  it('waits on the Approvals page of the head, then Management; the last approval posts it against petty cash', async () => {
    expect((await docs.waitingForUser(eng as never)).map(w => w.type)).toContain('Expense · Engineering head');
    await expect(ex.approveExpense(adel as never, id)).resolves.toBeUndefined(); // Management may sign the head's step
    expect((await docs.waitingForUser(adel as never)).some(w => w.href === `/expenses/${id}`)).toBe(true);
    await expect(ex.approveExpense(eng as never, id)).rejects.toThrow(/waiting for Management/);
    await ex.approveExpense(adel as never, id);
    const x = (await ex.getExpense(id))!;
    expect(x.status).toBe('posted');
    const lines = await sql`select account, dr::float dr, cr::float cr, project_id from journal_lines where entry_id = ${x.entry_id} order by line_no`;
    expect(lines).toEqual([{ account: '25001-1', dr: 350, cr: 0, project_id: 'ph-b1302' }, { account: 'A115', dr: 0, cr: 350, project_id: null }]);
    expect((await sql`select payment_ref from journal_entries where id = ${x.entry_id}`)[0].payment_ref).toMatch(/^PT-/);
  });
  it('own money is owed to the person on employee advances until Finance reimburses it', async () => {
    const own = await ex.recordExpense(site as never, { ...base, paidFrom: 'own', amount: 120 }, { name: 'r.jpg', body: JPEG });
    await ex.returnExpense(eng as never, own, 'Wrong amount');
    expect((await ex.getExpense(own))!.status).toBe('rejected');
    await ex.saveExpense(site as never, { ...base, paidFrom: 'own', amount: 125, id: own });
    await ex.approveExpense(eng as never, own);
    await ex.approveExpense(adel as never, own);
    const x = (await ex.getExpense(own))!;
    const emp = (await sql`select account_map->>'empAdv' a from settings`)[0].a;
    expect((await sql`select account, cr::float cr from journal_lines where entry_id = ${x.entry_id} and cr > 0`)[0]).toEqual({ account: emp, cr: 125 });
    expect((await ex.toReimburse()).map(r => r.id)).toEqual([own]);
    await expect(ex.reimburseExpense(site as never, own, 'A120', '2026-10-14')).rejects.toThrow(/Only Finance/);
    await ex.reimburseExpense(adel as never, own, 'A120', '2026-10-14');
    expect(await ex.toReimburse()).toEqual([]);
    await expect(ex.reimburseExpense(adel as never, own, 'A120', '2026-10-14')).rejects.toThrow(/Already reimbursed/);
  });
  it('you do not approve your own expense', async () => {
    const mine = await ex.recordExpense(eng as never, base, { name: 'r.jpg', body: JPEG });
    await expect(ex.approveExpense(eng as never, mine)).rejects.toThrow(/Someone else approves/);
  });
});
