// Partners' dashboard (improvement 4) against the test database: project money and the 30-day cash view.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const dash = await import('@/lib/dashboard');
const docs = await import('@/lib/documents');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance', 'management'] };
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  fin.id = (await sql`insert into users (email, name, password_hash, roles) values (${fin.email}, ${fin.name}, 'x', ${fin.roles}) returning id`)[0].id;
  await sql`insert into bank_accounts (account, kind, ref_prefix) values ('A120', 'bank', 'CIB-34-')`;
  await sql`update settings set lock_date = null, require_approval = false where id = 1`;
  await sql`update projects set contract = 500000, budget = 300000 where id = 'ph-b1302'`;
});
afterAll(async () => { await sql.end(); });

describe("partners' dashboard", () => {
  it('per project: contract, cost to date, committed and the margin it is heading for', async () => {
    const before = (await dash.projectMoney()).find(p => p.id === 'ph-b1302')!;
    expect(before.contract).toBe(500000);
    expect(before.expectedCost).toBe(Math.max(300000, before.cost + before.committed));
    expect(before.margin).toBe(500000 - before.expectedCost);
    // an approved payment request posts as cost; it no longer counts as committed
    await docs.savePaymentRequest(fin as never, { date: '2026-10-12', due: '2026-10-20', party: 'vc0003', project: 'ph-b1302', ref: 'X', vatRate: 0, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0,
      lines: [{ acc: '25001-1', desc: 'Kitchen', qty: 1, price: 400000 }] }, true);
    const after = (await dash.projectMoney()).find(p => p.id === 'ph-b1302')!;
    expect(after.cost).toBe(before.cost + 400000);
    expect(after.expectedCost).toBe(after.cost + after.committed);
    expect(after.margin).toBeLessThan(before.margin);
  });
  it('the cash view starts from bank and petty cash and takes out what is approved to pay by its due date', async () => {
    const v = await dash.cashView('2026-10-14');
    expect(v.weeks).toHaveLength(5);
    expect(v.weeks[0]).toMatchObject({ from: '2026-10-14', to: '2026-10-20' });
    expect(v.weeks[4].to).toBe('2026-11-12');
    expect(v.outs.find(o => o.due === '2026-10-20')).toMatchObject({ amount: 400000 });
    expect(v.weeks[0].outflow).toBeGreaterThanOrEqual(400000);
    const net = v.weeks.reduce((t, w) => t + w.inflow - w.outflow, 0);
    expect(Math.round((v.opening + net) * 100) / 100).toBe(v.closing);
  });
});
