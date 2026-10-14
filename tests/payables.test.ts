// Payables (improvement 11) against the test database: supplier aging with the 30-day default due date, and the
// payment calendar by week against the cash.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const docs = await import('@/lib/documents');
const pay = await import('@/lib/payables');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const mgt = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management', 'finance'] };
const ids: string[] = [];
const request = (date: string, due: string | null, price: number) => docs.savePaymentRequest(mgt as never,
  { date, due, party: 'vc0003', project: 'ph-b1302', ref: '', vatRate: 0, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0, lines: [{ acc: '25001-1', desc: 'Works', qty: 1, price }] }, true);
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  mgt.id = (await sql`insert into users (email, name, password_hash, roles) values (${mgt.email}, ${mgt.name}, 'x', ${mgt.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null where id = 1`;
  await sql`update approval_steps set user_ids = '{}'`;
  for (const [d, due, p] of [['2026-08-01', null, 10000], ['2026-10-01', '2026-10-20', 4000], ['2026-10-10', '2026-12-31', 1000]] as const) {
    const id = await request(d, due, p);
    for (let k = 0; k < 4 && (await sql`select status from invoices where id = ${id}`)[0].status === 'pending'; k++) await docs.approveRequest(mgt as never, id);
    ids.push(id);
  }
});
afterAll(async () => { await sql.end(); });

describe('payables', () => {
  it('ages each supplier; no due date means 30 days after the date', async () => {
    const a = await pay.supplierAging('2026-10-14');
    const s = a.suppliers.find(x => x.party_id === 'vc0003')!;
    expect(s).toMatchObject({ total: 15000, overdue: 10000, buckets: [5000, 0, 10000, 0, 0] });
    expect(s.docs.find(d => d.id === ids[0])).toMatchObject({ due: '2026-08-31', days: 44, state: 'released', href: `/payment-requests/${ids[0]}` });
  });
  it('lays the next 30 days out by week, overdue first, against the cash', async () => {
    const c = await pay.paymentCalendar('2026-10-14', 30);
    expect(c.end).toBe('2026-11-12');
    expect(c.weeks[0]).toMatchObject({ label: 'Overdue', total: 10000 });
    expect(c.weeks[1]).toMatchObject({ from: '2026-10-14', to: '2026-10-20', total: 4000 });
    expect(c.weeks.at(-1)!.to).toBe('2026-11-12');
    expect(c.weeks).toHaveLength(6);
    expect(c).toMatchObject({ total: 14000, later: 1000 });
    expect(c.weeks[1].cashAfter).toBe(Math.round((c.cash - 14000) * 100) / 100);
  });
});
