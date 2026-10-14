// Update 18 against the test database: tasks that move by themselves (clock-in on the project, Start, Submit for review,
// the review in Approvals), petty cash paid only from the office cash, the vendor/subcontractor list with Bank or InstaPay
// and a vendor type, and the invoices not yet collected.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, generateVAPIDKeys: () => ({ publicKey: 'p', privateKey: 'k' }), sendNotification: async () => ({}) } }));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-u18-'));
process.env.APP_TZ = 'Africa/Cairo';
const { sql } = await import('@/lib/db');
const tasks = await import('@/lib/tasks');
const att = await import('@/lib/attendance');
const hr = await import('@/lib/hr');
const petty = await import('@/lib/petty-vouchers');
const parties = await import('@/lib/parties');
const { uncollectedInvoices } = await import('@/lib/collections');
const { waitingForUser } = await import('@/lib/documents');
const { bankAccounts, payCard } = await import('@/lib/banks');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const adel: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'] };
const sara: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: [] };
const hrm: U = { id: '', email: 'hr@x.test', name: 'Haitham HR', roles: ['hr'] };
const selfie = { name: 'selfie.jpg', body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 2)]) };
let saraEmp = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, tasks, attendance, work_sessions, attachments cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null, hr = '{}' where id = 1`;
  await sql`delete from employees`;
  for (const u of [fin, adel, sara, hrm]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  saraEmp = await hr.saveEmployeeFile(hrm as never, { name: 'Sara Site', work_location: 'site', project_id: 'ph-b1302' });
  await hr.linkLogin(hrm as never, saraEmp, sara.id);
  await sql`insert into accounts (code, name, type, parent, postable, is_bank) values ('A110', 'Cash – office safe', 'asset', 'A100', true, true), ('A115', 'Petty cash – accountant', 'asset', 'A100', true, true) on conflict (code) do nothing`;
  await sql`insert into bank_accounts (account, kind, ref_prefix, holder, hidden) values ('A110', 'cash', 'PT-', 'Office safe', false), ('A115', 'cash', 'PT-', 'Accountant', true)
    on conflict (account) do update set hidden = excluded.hidden`;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('tasks move by themselves', () => {
  let site = '', office = '';
  it('a new task starts in To do whatever is asked; the clock-in on its project moves it to In progress', async () => {
    site = await tasks.saveTask(fin as never, { title: 'Fix the kitchen tiles', details: '', priority: 'normal', assignee_emp_id: saraEmp, assignee_id: sara.id, project_id: 'ph-b1302' });
    office = await tasks.saveTask(fin as never, { title: 'Sort the site receipts', details: '', priority: 'normal', assignee_emp_id: saraEmp, assignee_id: sara.id });
    expect(await tasks.getTask(site)).toMatchObject({ status: 'todo', project_code: 'PH-B1302' });
    await expect(tasks.startTask(adel as never, office)).resolves.toBeUndefined();   // Management may start it too
    await tasks.setStatus(fin as never, office, 'todo');
    const { message } = await att.clockIn(sara as never, null, selfie, new Date('2026-10-14T06:00:00Z'), { category: 'site', projectId: 'ph-b1302' });
    expect(message).toMatch(/Your task on this project is now In progress\./);
    expect(await tasks.getTask(site)).toMatchObject({ status: 'doing' });
    expect(await tasks.getTask(office)).toMatchObject({ status: 'todo' });   // no project: not moved by the clock-in
  });
  it('a task with no project starts with Start, by its person only', async () => {
    await expect(tasks.startTask(hrm as never, office)).rejects.toThrow(/Only the person/);
    await tasks.startTask(sara as never, office);
    await expect(tasks.startTask(sara as never, office)).rejects.toThrow(/already started/);
    expect(await tasks.getTask(office)).toMatchObject({ status: 'doing' });
  });
  it('Submit for review puts it in Review and in the Approvals of whoever gave it; sent back it is In progress, approved it is Done', async () => {
    await expect(tasks.submitTask(fin as never, site)).rejects.toThrow(/Only the person/);
    await tasks.submitTask(sara as never, site, 'Tiles replaced');
    expect(await tasks.getTask(site)).toMatchObject({ status: 'review', reviewer_id: fin.id, submit_note: 'Tiles replaced' });
    expect((await waitingForUser(fin as never)).find(w => w.href === `/tasks/${site}`)).toMatchObject({ type: 'Task · review', no: 'PH-B1302' });
    expect((await waitingForUser(sara as never)).some(w => w.href === `/tasks/${site}`)).toBe(false);
    await expect(tasks.reviewTask(sara as never, site, true)).rejects.toThrow(/Only the person who gave/);
    await expect(tasks.reviewTask(fin as never, site, false)).rejects.toThrow(/Say what is missing/);
    await tasks.reviewTask(fin as never, site, false, 'Grout missing');
    expect(await tasks.getTask(site)).toMatchObject({ status: 'doing' });
    await tasks.submitTask(sara as never, site);
    await tasks.reviewTask(fin as never, site, true);
    const t = await tasks.getTask(site);
    expect(t.status).toBe('done');
    expect(t.done_at).toBeTruthy();
    expect((await tasks.listComments(site)).map(c => c.text)).toEqual(['Submitted for review: Tiles replaced', 'Sent back: Grout missing', 'Submitted for review.', 'Approved.']);
  });
  it('a task someone gave themselves is reviewed by Management', async () => {
    const own = await tasks.saveTask(sara as never, { title: 'My own', details: '', priority: 'low', assignee_id: sara.id });
    await tasks.startTask(sara as never, own);
    await tasks.submitTask(sara as never, own);
    expect(await tasks.getTask(own)).toMatchObject({ reviewer_id: null });
    expect((await waitingForUser(adel as never)).some(w => w.href === `/tasks/${own}`)).toBe(true);
    await tasks.reviewTask(adel as never, own, true);
    expect(await tasks.getTask(own)).toMatchObject({ status: 'done' });
  });
});

describe('petty cash from the office cash only', () => {
  let id = '';
  it('Banks & cash shows the office cash, not the accountant box', async () => {
    const shown = (await bankAccounts()).filter(a => !a.hidden).map(a => a.code);
    expect(shown).toContain('A110');
    expect(shown).not.toContain('A115');
    expect((await petty.officeCash()).code).toBe('A110');
  });
  it('a voucher posts Dr the expense, Cr the office cash, with the office cash number', async () => {
    await expect(petty.issuePettyCash(sara as never, { date: '2026-10-14', amount: 100, paidTo: saraEmp, purpose: 'Taxi', project: 'ph-b1302', acc: '25001-1' })).rejects.toThrow(/Only Finance/);
    await expect(petty.issuePettyCash(fin as never, { date: '2026-10-14', amount: 100, paidTo: saraEmp, purpose: 'Taxi', acc: '25001-1' })).rejects.toThrow(/project or the department/);
    await expect(petty.issuePettyCash(fin as never, { date: '2026-10-14', amount: 100, paidTo: saraEmp, purpose: '', project: 'ph-b1302', acc: '25001-1' })).rejects.toThrow(/what the money is for/);
    id = await petty.issuePettyCash(fin as never, { date: '2026-10-14', amount: 250, paidTo: saraEmp, purpose: 'Taxi to site', project: 'ph-b1302', acc: '25001-1' });
    const lines = await sql<{ account: string; dr: number; cr: number; project_id: string | null }[]>`select account, dr::float dr, cr::float cr, project_id from journal_lines where entry_id = ${id} order by line_no`;
    expect(lines).toEqual([{ account: '25001-1', dr: 250, cr: 0, project_id: 'ph-b1302' }, { account: 'A110', dr: 0, cr: 250, project_id: null }]);
    const v = await petty.getVoucher(id);
    expect(v).toMatchObject({ amount: 250, paid_to: 'Sara Site', purpose: 'Taxi to site', cc: 'PH-B1302', voided: false });
    expect(v.ref).toMatch(/^PT-\d{5}$/);
    expect((await petty.listVouchers()).map(x => x.id)).toContain(id);
  });
  it('void reverses it and the cash comes back', async () => {
    await expect(petty.voidVoucher(fin as never, id, '', '2026-10-14')).rejects.toThrow(/why/);
    await petty.voidVoucher(fin as never, id, 'Typed twice', '2026-10-14');
    expect(await petty.getVoucher(id)).toMatchObject({ voided: true });
    const [{ n }] = await sql<{ n: number }[]>`select coalesce(sum(l.dr - l.cr), 0)::float n from journal_lines l join journal_entries e on e.id = l.entry_id where l.account = 'A110' and (e.id = ${id} or e.reverses_id = ${id})`;
    expect(n).toBe(0);
  });
});

describe('pay the card', () => {
  it('Finance pays the credit card from the bank: Dr the card, Cr the bank', async () => {
    await sql`insert into accounts (code, name, type, postable, is_bank) values ('L115', 'CIB credit card', 'liability', true, true), ('A120', 'CIB current account', 'asset', true, true) on conflict (code) do nothing`;
    await sql`insert into bank_accounts (account, kind, ref_prefix, credit_limit) values ('L115', 'card', 'CC-12-', 90000), ('A120', 'bank', 'CIB-34-', null) on conflict (account) do nothing`;
    await expect(payCard(sara as never, { card: 'L115', bank: 'A120', date: '2026-10-14', amount: 500 })).rejects.toThrow(/Only Finance/);
    await expect(payCard(fin as never, { card: 'A120', bank: 'A120', date: '2026-10-14', amount: 500 })).rejects.toThrow(/not a credit card/);
    const id = await payCard(fin as never, { card: 'L115', bank: 'A120', date: '2026-10-14', amount: 500 });
    const lines = await sql<{ account: string; dr: number; cr: number }[]>`select account, dr::float dr, cr::float cr from journal_lines where entry_id = ${id} order by dr desc`;
    expect(lines).toEqual([{ account: 'L115', dr: 500, cr: 0 }, { account: 'A120', dr: 0, cr: 500 }]);
  });
});

describe('vendors, subcontractors and customers', () => {
  it('a subcontractor paid by InstaPay to a wallet, with a new vendor type that joins the list', async () => {
    await expect(parties.addParty(fin as never, 'sub', { name: 'Hany Tiles', pay_method: 'instapay', instapay_no: '' })).rejects.toThrow(/InstaPay number/);
    await expect(parties.addParty(fin as never, 'sub', { name: 'Hany Tiles', pay_method: 'instapay', instapay_no: '01001234567' })).rejects.toThrow(/bank account or wallet/);
    const id = await parties.addParty(fin as never, 'sub', { name: 'Hany Tiles', pay_method: 'instapay', instapay_no: '01001234567', instapay_to: 'wallet', bank_name: 'NBE', new_type: 'Marble' });
    const [p] = await sql`select code, type, is_sub, vendor_type, pay_method, instapay_no, instapay_to, bank_name from parties where id = ${id}`;
    expect(p).toMatchObject({ type: 'vendor', is_sub: true, vendor_type: 'Marble', pay_method: 'instapay', instapay_no: '01001234567', instapay_to: 'wallet', bank_name: null });
    expect(p.code).toMatch(/^SC\d{4}$/);
    expect(await parties.vendorTypes()).toEqual(expect.arrayContaining(['Plumbing', 'Electricity', 'Marble']));
    await parties.addParty(fin as never, 'vendor', { name: 'Another', new_type: 'marble' });
    expect((await parties.vendorTypes()).filter(t => t.toLowerCase() === 'marble')).toHaveLength(1);
    expect(parties.payLabel(p as never, true)).toBe('InstaPay · 01001234567 · wallet');
  });
  it('a vendor paid to a bank keeps the bank boxes; it moves to Subcontractors and back', async () => {
    const id = await parties.addParty(fin as never, 'vendor', { name: 'Volt', pay_method: 'bank', bank_name: 'CIB', vendor_type: 'Electricity', instapay_no: '0100' });
    expect((await sql`select bank_name, instapay_no, vendor_type from parties where id = ${id}`)[0]).toMatchObject({ bank_name: 'CIB', instapay_no: null, vendor_type: 'Electricity' });
    await expect(parties.addParty(sara as never, 'vendor', { name: 'x' })).rejects.toThrow(/Only Finance/);
    await parties.setSubcontractor(fin as never, id, true);
    expect((await sql`select is_sub from parties where id = ${id}`)[0].is_sub).toBe(true);
    await parties.updateParty(fin as never, id, { name: 'Volt Electric', pay_method: 'instapay', instapay_no: '0111', instapay_to: 'account', bank_name: 'CIB' });
    expect((await sql`select name, bank_name, instapay_to from parties where id = ${id}`)[0]).toMatchObject({ name: 'Volt Electric', bank_name: null, instapay_to: 'account' });
  });
  it('a customer keeps an ID number', async () => {
    const id = await parties.addParty(fin as never, 'customer', { name: 'Mohamed Salem', tax_id: '29001011234567', bank_name: 'QNB' });
    expect((await sql`select type, tax_id, bank_name, vendor_type from parties where id = ${id}`)[0]).toMatchObject({ type: 'customer', tax_id: '29001011234567', bank_name: 'QNB', vendor_type: null });
  });
});

describe('collections', () => {
  it('lists the posted sales invoices with money still to receive', async () => {
    const rows = await uncollectedInvoices();
    for (const r of rows) { expect(r.open).toBeGreaterThan(0); expect(r.days_overdue).toBeGreaterThanOrEqual(0); }
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from invoices i where i.kind = 'sales' and i.status = 'posted' and i.total - invoice_paid(i.id) > 0.004`;
    expect(rows).toHaveLength(n);
  });
});

// What the review of PR #37 found: linked tasks that no document closes must still be handed in; tasks the system raises
// carry their project so the clock-in moves them; the hidden cash box stays out of Money received; the InstaPay number
// is for Finance and Procurement; a refused form leaves no stray vendor type; the Arabic clock-in keeps the task sentence.
describe('fixes after the review of update 18', () => {
  const eng: U = { id: '', email: 'eng@x.test', name: 'Youssef Engineering', roles: ['engineering'] };
  it('a task linked to a payment request is handed in with Submit and approved like any other', async () => {
    const id = await tasks.saveTask(fin as never, { title: 'Chase the missing invoice', details: '', priority: 'normal', assignee_emp_id: saraEmp, assignee_id: sara.id, link_type: 'payment-request', link_id: 'pr-test', link_label: 'PR-00009' });
    await tasks.startTask(sara as never, id);
    await tasks.submitTask(sara as never, id, 'sent twice');
    expect(await tasks.getTask(id)).toMatchObject({ status: 'review' });
    await tasks.reviewTask(fin as never, id, true, '');
    expect(await tasks.getTask(id)).toMatchObject({ status: 'done' });
  });
  it('a task its document closes is not submitted by hand', async () => {
    const id = await tasks.saveTask(fin as never, { title: 'Collect INV-1', details: '', priority: 'normal', assignee_id: sara.id, assignee_emp_id: saraEmp, link_type: 'sales-invoice', link_id: 'inv-test', link_label: 'INV-1' });
    await expect(tasks.submitTask(sara as never, id)).rejects.toThrow(/closes by itself/);
  });
  it('an inspection the system raises carries its project, so the inspector\'s clock-in moves it', async () => {
    eng.id = (await sql`insert into users (email, name, password_hash, roles) values (${eng.email}, ${eng.name}, 'x', ${eng.roles}) returning id`)[0].id;
    const site = await import('@/lib/site');
    const ir = await site.raiseInspection(eng as never, { project: 'ph-b1302', title: 'Tiles before grouting', requested_for: '2026-10-20', inspector: sara.id });
    const [t] = await sql<{ id: string; project_id: string | null; status: string }[]>`select id, project_id, status from tasks where link_type = 'inspection' and link_id = ${ir}`;
    expect(t).toMatchObject({ project_id: 'ph-b1302', status: 'todo' });
    expect(await tasks.startOnClockIn(sql, saraEmp, sara.id, 'ph-b1302')).toBeGreaterThanOrEqual(1);
    expect((await tasks.getTask(t.id)).status).toBe('doing');
  });
  it('Money received refuses the hidden cash box', async () => {
    const sales = await import('@/lib/sales');
    const customer = await parties.addParty(fin as never, 'customer', { name: 'Test client' } as never);
    await expect(sales.postCustomerReceipt(fin as never, { date: '2026-10-14', party: customer, bank: 'A115', received: 100, wht: 0, memo: '', ref: '', alloc: [] })).rejects.toThrow(/no longer in use/);
  });
  it('the InstaPay number shows only to Finance and Procurement', () => {
    const p = { pay_method: 'instapay', bank_name: null, instapay_no: '01001234567', instapay_to: 'wallet' };
    expect(parties.payLabel(p)).toBe('InstaPay · wallet');
    expect(parties.payLabel(p, true)).toBe('InstaPay · 01001234567 · wallet');
  });
  it('a refused form leaves no stray vendor type', async () => {
    await expect(parties.addParty(fin as never, 'sub', { name: 'Fountain works', pay_method: 'instapay', new_type: 'Fountains', instapay_no: '' } as never)).rejects.toThrow(/InstaPay number/);
    expect(await parties.vendorTypes()).not.toContain('Fountains');
    await parties.addParty(fin as never, 'sub', { name: 'Fountain works', pay_method: 'instapay', new_type: 'Fountains', instapay_no: '01000000000', instapay_to: 'wallet' } as never);
    expect(await parties.vendorTypes()).toContain('Fountains');
  });
  it('the Arabic clock-in keeps the sentence about the task', async () => {
    const { trClockMessage } = await import('@/lib/i18n');
    const ar = trClockMessage('ar', 'Clocked in, 15 m from the project pin (accurate to about 10 m). Your task on this project is now In progress.');
    expect(ar).toMatch(/^تم تسجيل الحضور، على بعد 15 متر/);
    expect(ar).toMatch(/قيد التنفيذ\.$/);
    expect(trClockMessage('ar', 'Clocked in, 15 m from the project pin (accurate to about 10 m). 2 of your tasks on this project are now In progress.')).toMatch(/2 من مهامك/);
  });
});
