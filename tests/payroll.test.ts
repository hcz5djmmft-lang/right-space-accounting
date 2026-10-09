// Payroll runs against the test database (see books.test.ts for setup notes).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const pay = await import('@/lib/payroll');
const { trialBalance } = await import('@/lib/books');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
let dept = '';

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, payroll_runs cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  await sql`update settings set lock_date = null`;
  for (const u of [fin, eng]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  dept = (await sql`select id from departments order by code limit 1`)[0].id;
});
afterAll(async () => { await sql.end(); });

const emp = (name: string, extra: Record<string, unknown>) => ({ code: '', name, job_title: '', basic: 10000, allowances: 2000, insurable: 0, bank_account: '', active: true, ...extra });

describe('payroll', () => {
  let site = '', office = '';
  it('Finance adds employees; codes are numbered E001, E002', async () => {
    await expect(pay.saveEmployee(eng as never, emp('X', {}))).rejects.toThrow(/Only Finance/);
    site = await pay.saveEmployee(fin as never, emp('Sara Site', { project_id: 'ph-b1302', job_title: 'Site engineer' }));
    office = await pay.saveEmployee(fin as never, emp('Omar Office', { dept_id: dept, basic: 5000, allowances: 0 }));
    const list = await pay.listEmployees();
    expect(list.map(e => [e.code, e.name, e.project_code ?? e.dept_name])).toEqual([['E001', 'Sara Site', 'PH-B1302'], ['E002', 'Omar Office', list[1].dept_name]]);
  });
  it('a run pulls in every active employee and recalculates with overtime and deductions', async () => {
    await pay.createRun(fin as never, '2026-10', '');
    await expect(pay.createRun(fin as never, '2026-10', '')).rejects.toThrow(/already exists/);
    let r = (await pay.getRun('2026-10'))!;
    expect(r.run).toMatchObject({ status: 'draft', date: '2026-10-31', employees: 2 });
    expect(r.lines.map(l => [l.name, l.gross, l.net])).toEqual([['Sara Site', 12000, 9731.5], ['Omar Office', 5000, 5000 - 550 - r.lines[1].tax]]);
    await pay.saveRun(fin as never, '2026-10', [{ employee_id: site, overtime: 1000, deductions: 500 }]);
    r = (await pay.getRun('2026-10'))!;
    expect(r.lines[0]).toMatchObject({ overtime: 1000, deductions: 500, gross: 13000 });
    expect(r.totals.net).toBe(r.lines[0].net + r.lines[1].net);
  });
  it('an employee without a cost center blocks posting until fixed and refreshed', async () => {
    await pay.saveEmployee(fin as never, { ...emp('Omar Office', { basic: 5000, allowances: 0 }), id: office, dept_id: null });
    await pay.saveRun(fin as never, '2026-10', [], true);
    await expect(pay.postRun(fin as never, '2026-10')).rejects.toThrow(/Give Omar Office a project or a department/);
    await pay.saveEmployee(fin as never, { ...emp('Omar Office', { basic: 5000, allowances: 0 }), id: office, dept_id: dept });
    await pay.saveRun(fin as never, '2026-10', [], true);
    expect(await pay.deleteEmployee(fin as never, office).catch(e => e.message)).toMatch(/in a payroll run/);
  });
  it('posting charges salaries to the project and the department, then salaries are paid from the bank', async () => {
    const eid = await pay.postRun(fin as never, '2026-10');
    const r = (await pay.getRun('2026-10'))!;
    expect(r.run.status).toBe('posted');
    const t = r.totals;
    const lines = await sql<{ account: string; dr: number; cr: number; project_id: string | null; dept_id: string | null }[]>`select account, dr, cr, project_id, dept_id from journal_lines where entry_id = ${eid} order by line_no`;
    expect(lines).toEqual([
      { account: '11001', dr: 13000, cr: 0, project_id: 'ph-b1302', dept_id: null }, { account: '11010', dr: 2250, cr: 0, project_id: 'ph-b1302', dept_id: null },
      { account: '11001', dr: 5000, cr: 0, project_id: null, dept_id: dept }, { account: '11010', dr: 937.5, cr: 0, project_id: null, dept_id: dept },
      { account: 'L160', dr: 0, cr: t.soc_emp + t.soc_co, project_id: null, dept_id: null }, { account: 'L170', dr: 0, cr: t.tax, project_id: null, dept_id: null },
      { account: 'A160', dr: 0, cr: 500, project_id: null, dept_id: null }, { account: 'L180', dr: 0, cr: t.net, project_id: null, dept_id: null },
    ]);
    await expect(pay.saveRun(fin as never, '2026-10', [])).rejects.toThrow(/posted/);
    await expect(pay.deleteRun(fin as never, '2026-10')).rejects.toThrow(/posted/);
    const pid = await pay.paySalaries(fin as never, '2026-10', 'A120', '2026-11-01');
    const paid = await sql<{ account: string; dr: number; cr: number }[]>`select account, dr, cr from journal_lines where entry_id = ${pid} order by line_no`;
    expect(paid).toEqual([{ account: 'L180', dr: t.net, cr: 0 }, { account: 'A120', dr: 0, cr: t.net }]);
    await expect(pay.paySalaries(fin as never, '2026-10', 'A120', '2026-11-01')).rejects.toThrow(/already paid/);
    const tb = await trialBalance();
    expect(tb.find(x => x.code === 'L180')).toMatchObject({ dr: t.net, cr: t.net });
    expect(tb.reduce((s, x) => s + x.dr - x.cr, 0)).toBeCloseTo(0, 2);
  });
});
