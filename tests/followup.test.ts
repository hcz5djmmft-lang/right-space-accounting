// Collections follow-up (improvement 7) against the test database: aging per customer, reminder tasks on the due date and
// every 7 days, closed when paid, and the WhatsApp message.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const sales = await import('@/lib/sales');
const fu = await import('@/lib/followup');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
let customer = '', inv = '', bank = '';
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, tasks, collection_reminders cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  fin.id = (await sql`insert into users (email, name, password_hash, roles) values (${fin.email}, ${fin.name}, 'x', ${fin.roles}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${fin.id} where code = 'FIN'`;
  await sql`update settings set lock_date = null where id = 1`;
  customer = (await sql`insert into parties (code, type, name, full_name, phone) values ('CU0009', 'customer', 'Hassan', 'Mr Hassan Ali', '0100 123 4567') returning id`)[0].id;
  bank = (await sql`select code from accounts where is_bank and postable order by code limit 1`)[0].code;
  inv = await sales.saveSalesInvoice(fin as never, { date: '2026-09-01', due: '2026-09-15', party: customer, project: 'ph-b1302', ref: 'Stage 1', vatRate: 0, lines: [{ acc: 'R110', desc: 'Design', qty: 1, price: 50000 }] }, true);
});
afterAll(async () => { await sql.end(); });

describe('collections follow-up', () => {
  it('ages each customer by days past due', async () => {
    const { customers } = await fu.followUps('2026-10-14');
    const c = customers.find(x => x.party_id === customer)!;
    expect(c).toMatchObject({ full_name: 'Mr Hassan Ali', total: 50000, overdue: 50000, buckets: [0, 50000, 0, 0, 0] });
    expect(c.docs[0]).toMatchObject({ id: inv, days: 29 });
  });
  it('raises one reminder task for Finance, renews it every 7 days, and closes it when paid', async () => {
    expect(await fu.raiseCollectionReminders('2026-09-14')).toBe(0); // not yet due
    expect(await fu.raiseCollectionReminders('2026-09-15')).toBe(1);
    const [t] = await sql`select id, title, assignee_id, link_type, link_id, status from tasks`;
    expect(t).toMatchObject({ title: expect.stringMatching(/^Collect INV-\d+ from Hassan: 50,000.00, due today$/), assignee_id: fin.id, link_type: 'sales-invoice', link_id: inv, status: 'todo' });
    expect(await fu.raiseCollectionReminders('2026-09-20')).toBe(0);
    expect(await fu.raiseCollectionReminders('2026-09-22')).toBe(1);
    expect((await sql`select count(*)::int n from tasks`)[0].n).toBe(1);
    expect((await sql`select title from tasks`)[0].title).toMatch(/7 days overdue$/);
    expect((await sql`select count(*)::int n from task_comments where task_id = ${t.id}`)[0].n).toBe(1);
    await sales.postCustomerReceipt(fin as never, { date: '2026-09-25', party: customer, project: 'ph-b1302', bank, received: 50000, wht: 0, memo: '', ref: '', alloc: [{ invoice: inv, amount: 50000 }] });
    await fu.raiseCollectionReminders('2026-09-26');
    expect((await sql`select status from tasks where id = ${t.id}`)[0].status).toBe('done');
  });
  it('the WhatsApp message names the customer, the invoices and the amount, in English and Arabic', () => {
    const m = fu.reminderMessage({ party: 'Hassan', full_name: 'Mr Hassan Ali', docs: [{ id: 'x', no: 'SI-00001', date: '', due: '2026-09-15', party_id: '', party: '', balance: 50000, days: 29, bucket: 1 }] }, { holder: 'Right Space Developments', bank_name: 'CIB', iban: 'EG84' });
    expect(m.en).toContain('Dear Mr Hassan Ali');
    expect(m.en).toContain('EGP 50,000.00 is due on invoice SI-00001 (50,000.00, due 2026-09-15)');
    expect(m.en).toContain('IBAN EG84');
    expect(m.ar).toContain('السيد/ة Mr Hassan Ali');
    expect(m.ar).toContain('50,000.00 جنيه');
    expect(fu.waNumber('0100 123 4567')).toBe('201001234567');
    expect(fu.waNumber('+20 100 123 4567')).toBe('201001234567');
    expect(fu.waNumber(null)).toBeNull();
  });
});
