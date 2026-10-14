// Monthly budgets (improvement 12) against the test database: typed and uploaded budgets, budget against actual, and
// the alert tasks at 80% and 100%.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const books = await import('@/lib/books');
const bud = await import('@/lib/budgets');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const eng = { id: '', email: 'eng@x.test', name: 'Youssef', roles: ['engineering'] };
const P = '2026-10';
const spend = (item: Record<string, string | number>, date = '2026-10-05') => books.saveEntry(fin as never, { date, ref: '', form: { type: 'expense', memo: 'Spend', bank: 'A110', vatRate: 0, items: [item as never] } }, 'post');
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, tasks, monthly_budgets cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null where id = 1`;
  await sql`update departments set head_user_id = ${fin.id} where code = 'FIN'`;
  const [e] = await sql`insert into employees (code, name, user_id) values ('E-99', 'Youssef', ${eng.id}) returning id`;
  await sql`update projects set manager_id = ${e.id} where id = 'ph-b1302'`;
});
afterAll(async () => { await sql.end(); });

describe('budgets', () => {
  it('only Finance sets them; unknown cost centers and GL codes are refused', async () => {
    await expect(bud.saveBudgets(eng as never, [{ period: P, cc: 'PH-B1302', amount: 1 }])).rejects.toThrow(/Only Finance/);
    await expect(bud.saveBudgets(fin as never, [{ period: P, cc: 'Nowhere', amount: 1 }])).rejects.toThrow(/No project or department called "Nowhere"/);
    await expect(bud.saveBudgets(fin as never, [{ period: P, cc: 'PH-B1302', account: 'A120', amount: 1 }])).rejects.toThrow(/not an expense code/);
  });
  it('sets each budget against what was spent, a GL code counting the codes under it', async () => {
    await bud.saveBudgets(fin as never, [{ period: P, cc: 'ph-b1302', amount: 10000 }, { period: P, cc: 'p:ph-b1302', account: '20000-1', amount: 2000 }, { period: P, cc: 'Finance', amount: 0 }]);
    await spend({ project: 'ph-b1302', acc: '25001-1', amount: 1500 });
    await spend({ project: 'ph-b1302', acc: '25001-1', amount: 999 }, '2026-09-30'); // last month
    const rows = await bud.budgetRows(P);
    expect(rows.map(r => [r.account, r.amount, r.actual, r.pct])).toEqual([[null, 10000, 1500, 15], ['20000-1', 2000, 1500, 75]]);
    expect((await bud.unbudgeted(P))).toEqual([]);
    expect((await bud.unbudgeted('2026-09'))[0]).toMatchObject({ cc: 'PH-B1302', actual: 999 });
  });
  it('raises a task at 80% and again at 100%, once each, to the project manager', async () => {
    expect(await bud.raiseBudgetAlerts('2026-10-06')).toBe(0);
    await spend({ project: 'ph-b1302', acc: '25001-1', amount: 200 });
    expect(await bud.raiseBudgetAlerts('2026-10-07')).toBe(1);
    expect(await bud.raiseBudgetAlerts('2026-10-07')).toBe(0);
    const [t] = await sql`select title, assignee_id, link_type, link_id, priority from tasks`;
    expect(t).toMatchObject({ title: 'Budget 85% used: PH-B1302 20000-1 Oct 2026, 1,700.00 of 2,000.00', assignee_id: eng.id, link_type: 'budget', link_id: P, priority: 'normal' });
    await spend({ project: 'ph-b1302', acc: '25001-1', amount: 400 });
    expect(await bud.raiseBudgetAlerts('2026-10-08')).toBe(1);
    expect((await sql`select title, priority from tasks order by created_at desc limit 1`)[0]).toMatchObject({ title: expect.stringMatching(/^Budget used up: PH-B1302 20000-1 Oct 2026, 2,100.00 of 2,000.00 \(105%\)$/), priority: 'high' });
    // raising the budget lets the alerts ring again later
    await bud.saveBudgets(fin as never, [{ period: P, cc: 'PH-B1302', account: '20000-1', amount: 5000 }]);
    expect((await sql`select count(*)::int n from monthly_budget_alerts`)[0].n).toBe(0);
  });
  it('copies last month and reads an uploaded file in either layout', async () => {
    await expect(bud.copyBudgets(fin as never, P)).rejects.toThrow(/already has budgets/);
    expect(await bud.copyBudgets(fin as never, '2026-11')).toBe(2);
    const long = Buffer.from('Month,Cost center,GL code,Amount\n2026-12,PH-B1302,,"12,000"\nDec 2026,FIN,,3000\n');
    expect(bud.parseBudgetFile(long, 'b.csv')).toEqual([{ period: '2026-12', cc: 'PH-B1302', account: null, amount: 12000 }, { period: '2026-12', cc: 'FIN', account: null, amount: 3000 }]);
    const wide = Buffer.from('Cost center,GL code,Jan 2027,Feb 2027,Total\nPH-B1302,25001,100,200,300\n');
    expect(bud.parseBudgetFile(wide, 'b.csv')).toEqual([{ period: '2027-01', cc: 'PH-B1302', account: '25001', amount: 100 }, { period: '2027-02', cc: 'PH-B1302', account: '25001', amount: 200 }]);
    expect(await bud.importBudgets(fin as never, long, 'b.csv')).toBe(2);
    expect((await bud.budgetRows('2026-12')).map(r => [r.cc, r.amount])).toEqual([['PH-B1302', 12000], ['FIN', 3000]]);
    expect(() => bud.parseBudgetFile(Buffer.from('a,b\n1,2\n'), 'x.csv')).toThrow(/No budget lines/);
    expect(bud.headerMonth('2026-3', '2026')).toBe('2026-03');
    expect(bud.headerMonth('October', '2026')).toBe('2026-10');
  });
});
