// Fixed assets (improvement 14) against the test database: the register, straight-line depreciation posted per month
// (the last month taking what is left), void and post again, stopping, and the month-end close item.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const fa = await import('@/lib/assets');
const close = await import('@/lib/close');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

const fin = { id: '', email: 'fin@x.test', name: 'Ziad', roles: ['finance'] };
const eng = { id: '', email: 'eng@x.test', name: 'Youssef', roles: ['engineering'] };
let laptop = '', saw = '';
const bal = async (code: string) => (await sql`select coalesce(sum(l.dr - l.cr), 0)::float n from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = ${code}`)[0].n;
beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, fixed_assets, depreciation_runs cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update settings set lock_date = null, account_map = account_map - 'depExp' || '{"fixedAssets":"A210","accDep":"A219"}' where id = 1`;
});
afterAll(async () => { await sql.end(); });

describe('fixed assets', () => {
  it('only Finance adds assets; the figures are checked', async () => {
    const base = { name: 'Laptop', category: 'Computers', cc: 'd:adm', in_service: '2026-09-15', cost: 1000, salvage: 100, life_months: 4 };
    await expect(fa.addAsset(eng as never, base)).rejects.toThrow(/Only Finance/);
    await expect(fa.addAsset(fin as never, { ...base, salvage: 1000 })).rejects.toThrow(/salvage value must be less/);
    await expect(fa.addAsset(fin as never, { ...base, cc: '' })).rejects.toThrow(/Choose the project or department/);
    laptop = await fa.addAsset(fin as never, { ...base, paid_from: 'A120' });
    saw = await fa.addAsset(fin as never, { ...base, name: 'Table saw', cc: 'p:ph-b1302', cost: 600, salvage: 0, life_months: 60, in_service: '2026-10-02' });
    const [a] = await fa.listAssets(laptop);
    expect(a).toMatchObject({ no: 'FA-00001', monthly: 225, book_value: 1000, cc: expect.any(String), purchase_no: expect.stringMatching(/^JE-/) });
    expect(await bal('A210')).toBe(1000); // only the laptop was paid now; the saw is already in the books
  });
  it('the depreciation GL codes must be existing codes of the right type', async () => {
    await expect(fa.saveAssetCodes(fin as never, { fixedAssets: 'A210', accDep: 'A219', depExp: 'A120' })).rejects.toThrow(/not a postable expense code/);
    await expect(fa.postDepreciation(fin as never, '2026-09')).rejects.toThrow(/Pick the depreciation expense GL code/);
    await fa.saveAssetCodes(fin as never, { fixedAssets: 'A210', accDep: 'A219', depExp: '12001' });
  });
  it('posts each month from the month in service, per cost center; the last month takes what is left', async () => {
    expect((await fa.depreciationFor('2026-08'))).toEqual([]);
    expect((await fa.depreciationFor('2026-09')).map(d => d.amount)).toEqual([225]);
    await fa.postDepreciation(fin as never, '2026-09');
    await expect(fa.postDepreciation(fin as never, '2026-09')).rejects.toThrow(/already posted/);
    const lines = await sql`select l.account, l.dr::float dr, l.cr::float cr, l.dept_id, l.project_id from journal_lines l join depreciation_runs r on r.entry_id = l.entry_id where r.period = '2026-10' order by l.line_no`;
    expect(lines).toEqual([]);
    await fa.postDepreciation(fin as never, '2026-10');
    const oct = await sql`select l.account, l.dr::float dr, l.cr::float cr, l.dept_id, l.project_id from journal_lines l join depreciation_runs r on r.entry_id = l.entry_id where r.period = '2026-10' order by l.line_no`;
    expect(oct).toEqual([
      { account: '12001', dr: 225, cr: 0, dept_id: 'adm', project_id: null },
      { account: '12001', dr: 10, cr: 0, dept_id: null, project_id: 'ph-b1302' },
      { account: 'A219', dr: 0, cr: 235, dept_id: null, project_id: null },
    ]);
    await fa.postDepreciation(fin as never, '2026-11');
    await fa.postDepreciation(fin as never, '2026-12');
    expect((await fa.depreciationFor('2027-01')).map(d => d.amount)).toEqual([10]); // the laptop is fully depreciated to its salvage value
    const [a] = await fa.listAssets(laptop);
    expect(a).toMatchObject({ depreciated: 900, book_value: 100 });
    expect(await bal('A219')).toBe(-930);
  });
  it('voids a month and posts it again', async () => {
    await fa.voidDepreciation(fin as never, '2026-12', 'wrong code');
    expect(await fa.depreciationRun('2026-12')).toBeNull();
    expect(await bal('A219')).toBe(-695);
    await fa.postDepreciation(fin as never, '2026-12');
    expect(await bal('A219')).toBe(-930);
  });
  it('stops depreciating a sold asset, and the month-end close knows', async () => {
    await expect(fa.stopAsset(fin as never, saw, '2027-01-10', '')).rejects.toThrow(/Say what happened/);
    await fa.stopAsset(fin as never, saw, '2026-12-31', 'Sold');
    expect(await fa.depreciationFor('2027-01')).toEqual([]);
    const item = async (p: string) => (await close.closeChecklist(p)).items.find(i => i.key === 'depreciation')!;
    expect(await item('2026-10')).toMatchObject({ done: true, detail: expect.stringMatching(/^Posted as JE-/) });
    expect(await item('2027-01')).toMatchObject({ done: true, detail: 'No assets to depreciate this month' });
    await sql`update fixed_assets set stopped_on = null where id = ${saw}`;
    expect(await item('2027-01')).toMatchObject({ done: false });
  });
});
