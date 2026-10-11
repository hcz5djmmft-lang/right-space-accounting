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
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };        // head of Finance
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };   // head of Engineering
const site: U = { id: '', email: 'site@x.test', name: 'Ziad Site', roles: ['engineering'] };     // raises requests
const mgt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'] };

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng, site, mgt]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${eng.id} where id = 'eng'`;
  await sql`update departments set head_user_id = ${fin.id} where id = 'fin'`;
  await sql`update departments set head_user_id = null where id = 'adm'`;
  await sql`update approval_steps set user_ids = '{}'`;
  await sql`insert into bank_accounts (account, kind, ref_prefix) values ('A120', 'bank', 'CIB-34-')`; // what migration 011 adds; the import wipes it
});
afterAll(async () => { await sql.end(); });

const request = {
  date: '2026-10-12', party: 'vc0003', project: 'ph-b1302', ref: 'INV-77', vatRate: 14, whtRate: 3, siRate: 0, retRate: 5, dpAmount: 0,
  lines: [{ acc: '25001-1', desc: 'Kitchen carpentry', qty: 1, price: 100000 }],
};
const status = async (id: string) => (await sql`select status from invoices where id = ${id}`)[0].status;

describe('payment request approval', () => {
  let id = '';
  it('a site engineer raises it for a project; the head of Engineering is emailed', async () => {
    sentInTest.length = 0;
    id = await docs.savePaymentRequest(site as never, request, true);
    const [r] = await sql`select no, net, status, approver_id, approver_label from invoices where id = ${id}`;
    expect(r).toMatchObject({ no: 'C-000002', status: 'pending', net: 106000, approver_id: eng.id, approver_label: 'Engineering head' }); // 100000 + 14000 VAT - 3000 WHT - 5000 retention
    expect(sentInTest.at(-1)).toMatchObject({ to: ['eng@x.test'], subject: 'C-000002 is waiting for your Engineering head approval' });
  });
  it('only the head (or Management) signs the first step: Finance and the requester cannot', async () => {
    await expect(docs.approveRequest(fin as never, id)).rejects.toThrow(/waiting for Engineering head/);
    await expect(docs.approveRequest(site as never, id)).rejects.toThrow(/waiting for Engineering head/);
  });
  it('Engineering head → Management, each emailed in turn, then posted', async () => {
    await docs.approveRequest(eng as never, id);
    expect(sentInTest.at(-1)).toMatchObject({ to: ['adel@x.test'], subject: 'C-000002 is waiting for your Management approval' });
    await expect(docs.approveRequest(eng as never, id)).rejects.toThrow(/waiting for Management/);
    expect(await status(id)).toBe('pending');
    await docs.approveRequest(mgt as never, id);
    expect(await status(id)).toBe('posted');
    expect(sentInTest.at(-1)).toMatchObject({ to: ['site@x.test'], subject: 'C-000002 is fully approved' });
    const lines = await sql`select l.account, l.dr, l.cr from journal_lines l join invoices i on i.entry_id = l.entry_id where i.id = ${id} order by l.line_no`;
    expect(lines.map(l => [l.account, l.dr, l.cr])).toEqual([['25001-1', 100000, 0], ['A140', 14000, 0], ['L150', 0, 3000], ['L120', 0, 5000], ['L110', 0, 106000]]);
    const approvals = await sql`select step_name from invoice_approvals where invoice_id = ${id} order by step`;
    expect(approvals.map(a => a.step_name)).toEqual(['Engineering head', 'Management']);
  });
  it("a department's request goes to that department's head", async () => {
    sentInTest.length = 0;
    const rid = await docs.savePaymentRequest(site as never, { ...request, project: null, dept: 'fin', lines: [{ acc: '11003', desc: 'Taxi', qty: 1, price: 500 }] }, true);
    expect((await sql`select approver_id, approver_label from invoices where id = ${rid}`)[0]).toMatchObject({ approver_id: fin.id, approver_label: 'Finance head' });
    expect(sentInTest.at(-1)?.to).toEqual(['fin@x.test']);
    await expect(docs.approveRequest(eng as never, rid)).rejects.toThrow(/waiting for Finance head/);
    await docs.approveRequest(fin as never, rid);
    await docs.approveRequest(mgt as never, rid);
    expect(await status(rid)).toBe('posted');
  });
  it('a department with no head yet: Management signs the first step too', async () => {
    sentInTest.length = 0;
    const rid = await docs.savePaymentRequest(site as never, { ...request, project: null, dept: 'adm', lines: [{ acc: '11003', desc: 'Taxi', qty: 1, price: 300 }] }, true);
    expect((await sql`select approver_id, approver_label from invoices where id = ${rid}`)[0]).toMatchObject({ approver_id: null, approver_label: 'Admin & HR head' });
    expect(sentInTest.at(-1)?.to).toEqual(['adel@x.test']);
    await expect(docs.approveRequest(fin as never, rid)).rejects.toThrow(/waiting for Admin & HR head/);
    await docs.approveRequest(mgt as never, rid);
    await docs.approveRequest(mgt as never, rid);
    expect(await status(rid)).toBe('posted');
  });
  it('only the people ticked for the final approval can give it', async () => {
    await sql`update approval_steps set user_ids = ${[fin.id]} where position = 2`;
    const rid = await docs.savePaymentRequest(site as never, request, true);
    await docs.approveRequest(eng as never, rid);
    await expect(docs.approveRequest(mgt as never, rid)).rejects.toThrow(/waiting for Management/);
    await docs.approveRequest(fin as never, rid);
    expect(await status(rid)).toBe('posted');
    await sql`update approval_steps set user_ids = '{}'`;
  });
  it('a vendor payment clears it; extra goes to down payments', async () => {
    const pid = await docs.postVendorPayment(fin as never, { date: '2026-10-13', party: 'vc0003', bank: 'A120', amount: 120000, memo: '', ref: '', alloc: [{ invoice: id, amount: 106000 }] });
    const [pay] = await sql`select p.reference, e.payment_ref from payments p join journal_entries e on e.id = p.entry_id where p.id = ${pid}`;
    expect(pay).toEqual({ reference: 'CIB-34-00001', payment_ref: 'CIB-34-00001' }); // the bank transfer's number, from the CIB account's prefix
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
    const id = await docs.savePaymentRequest(site as never, request, true);
    sentInTest.length = 0;
    await expect(docs.returnRequest(fin as never, id, 'Attach the invoice')).rejects.toThrow(/approver of the current step/);
    await docs.returnRequest(eng as never, id, 'Attach the invoice');
    expect(await status(id)).toBe('rejected');
    expect(sentInTest[0]).toMatchObject({ to: ['site@x.test'] });
    await docs.savePaymentRequest(site as never, { ...request, id, ref: 'INV-78' }, true);
    expect(await status(id)).toBe('pending');
    expect((await sql`select approver_id from invoices where id = ${id}`)[0].approver_id).toBe(eng.id);
  });
  it('refuses another project\'s GL code when submitting', async () => {
    await expect(docs.savePaymentRequest(eng as never, { ...request, project: 'cs-ch2505' }, true)).rejects.toThrow(/another project/);
  });
});
