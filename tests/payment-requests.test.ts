// Payment request approval chain against the test database (see books.test.ts for setup notes).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const docs = await import('@/lib/documents');
const { sentInTest } = await import('@/lib/mail');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
const mgt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'] };

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng, mgt]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
});
afterAll(async () => { await sql.end(); });

const request = {
  date: '2026-10-12', party: 'vc0003', project: 'ph-b1302', ref: 'INV-77', vatRate: 14, whtRate: 3, siRate: 0, retRate: 5, dpAmount: 0,
  lines: [{ acc: '25001-1', desc: 'Kitchen carpentry', qty: 1, price: 100000 }],
};
const status = async (id: string) => (await sql`select status from invoices where id = ${id}`)[0].status;

describe('payment request approval', () => {
  let id = '';
  it('an engineer raises it; Finance is emailed', async () => {
    sentInTest.length = 0;
    id = await docs.savePaymentRequest(eng as never, request, true);
    const [r] = await sql`select no, net, status from invoices where id = ${id}`;
    expect(r).toMatchObject({ no: 'C-000002', status: 'pending', net: 106000 }); // 100000 + 14000 VAT - 3000 WHT - 5000 retention
    expect(sentInTest.at(-1)).toMatchObject({ to: ['fin@x.test'], subject: 'C-000002 is waiting for your Finance approval' });
  });
  it('steps go in order: the engineer cannot sign the Finance step', async () => {
    await expect(docs.approveRequest(eng as never, id)).rejects.toThrow(/waiting for Finance/);
  });
  it('Finance → Engineering → Management, each emailed in turn, then posted', async () => {
    await docs.approveRequest(fin as never, id);
    expect(sentInTest.at(-1)?.to).toEqual(['eng@x.test']);
    await docs.approveRequest(eng as never, id);
    expect(sentInTest.at(-1)?.to).toEqual(['adel@x.test']);
    expect(await status(id)).toBe('pending');
    await docs.approveRequest(mgt as never, id);
    expect(await status(id)).toBe('posted');
    expect(sentInTest.at(-1)).toMatchObject({ to: ['eng@x.test'], subject: 'C-000002 is fully approved' });
    const lines = await sql`select l.account, l.dr, l.cr from journal_lines l join invoices i on i.entry_id = l.entry_id where i.id = ${id} order by l.line_no`;
    expect(lines.map(l => [l.account, l.dr, l.cr])).toEqual([['25001-1', 100000, 0], ['A140', 14000, 0], ['L150', 0, 3000], ['L120', 0, 5000], ['L110', 0, 106000]]);
    const approvals = await sql`select step_name from invoice_approvals where invoice_id = ${id} order by step`;
    expect(approvals.map(a => a.step_name)).toEqual(['Finance', 'Engineering', 'Management']);
  });
  it('a vendor payment clears it; extra goes to down payments', async () => {
    await docs.postVendorPayment(fin as never, { date: '2026-10-13', party: 'vc0003', bank: 'A120', amount: 120000, memo: '', ref: '', alloc: [{ invoice: id, amount: 106000 }] });
    const open = await docs.openRequests(sql, 'vc0003');
    expect(open.find(o => o.id === id)?.open).toBe(0);
    const [dp] = await sql`select sum(l.dr - l.cr)::float bal from journal_lines l join journal_entries e on e.id = l.entry_id and e.status='posted' where l.account = '90000'`;
    expect(dp.bal).toBe(14000);
    await expect(docs.postVendorPayment(fin as never, { date: '2026-10-13', party: 'vc0003', bank: 'A120', amount: 5, memo: '', ref: '', alloc: [{ invoice: id, amount: 5 }] }))
      .rejects.toThrow(/more than its open balance/);
  });
});

describe('returning a request', () => {
  it('goes back to the requester with the reason, and can be edited and resubmitted', async () => {
    const id = await docs.savePaymentRequest(eng as never, request, true);
    sentInTest.length = 0;
    await docs.returnRequest(fin as never, id, 'Attach the invoice');
    expect(await status(id)).toBe('rejected');
    expect(sentInTest[0]).toMatchObject({ to: ['eng@x.test'] });
    await docs.savePaymentRequest(eng as never, { ...request, id, ref: 'INV-78' }, true);
    expect(await status(id)).toBe('pending');
  });
  it('refuses another project\'s GL code when submitting', async () => {
    await expect(docs.savePaymentRequest(eng as never, { ...request, project: 'cs-ch2505' }, true)).rejects.toThrow(/another project/);
  });
});
