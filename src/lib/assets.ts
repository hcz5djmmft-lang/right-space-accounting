import 'server-only';
import crypto from 'node:crypto';
import { sql } from './db';
import { r2 } from './money';
import { type Line, RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit, checkLock, getSettings, nextNo, postEntry, reverseEntry, validateLines, writeLines } from './books';
import { lastDay as monthEnd } from './dates';

// Fixed assets (improvement 14). The register: each asset's cost, salvage value, useful life in months and cost center.
// Straight-line depreciation from the month it is put in service: (cost − salvage) ÷ life each month, the last month
// taking what is left. Finance posts each month's depreciation as one entry, by the button here or from the month-end
// close: Dr the depreciation expense code (per asset's project or department), Cr accumulated depreciation.

export type Asset = {
  id: string; no: string; name: string; category: string; dept_id: string | null; project_id: string | null; cc: string | null;
  in_service: string; cost: number; salvage: number; life_months: number; asset_account: string; stopped_on: string | null; stop_note: string; notes: string;
  purchase_entry_id: string | null; purchase_no: string | null; depreciated: number; monthly: number; book_value: number; last_period: string | null;
};

const checkPeriod = (p: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new RuleError('Pick a month.'); };
export const monthly = (a: Pick<Asset, 'cost' | 'salvage' | 'life_months'>) => r2((a.cost - a.salvage) / a.life_months);

export async function listAssets(id?: string): Promise<Asset[]> {
  const rows = await sql<Omit<Asset, 'monthly' | 'book_value'>[]>`
    select f.id, f.no, f.name, f.category, f.dept_id, f.project_id, coalesce(p.code, d.name) cc, to_char(f.in_service,'YYYY-MM-DD') in_service,
      f.cost::float cost, f.salvage::float salvage, f.life_months, f.asset_account, to_char(f.stopped_on,'YYYY-MM-DD') stopped_on, f.stop_note, f.notes,
      f.purchase_entry_id, e.no purchase_no,
      coalesce((select sum(l.amount) from depreciation_lines l where l.asset_id = f.id), 0)::float depreciated,
      (select max(l.period) from depreciation_lines l where l.asset_id = f.id) last_period
    from fixed_assets f left join projects p on p.id = f.project_id left join departments d on d.id = f.dept_id left join journal_entries e on e.id = f.purchase_entry_id
    where (${id ?? null}::text is null or f.id = ${id ?? null}) order by f.no`;
  return rows.map(r => ({ ...r, depreciated: r2(r.depreciated), monthly: monthly(r), book_value: r2(r.cost - r.depreciated) }));
}

export type AssetInput = { name: string; category: string; cc: string; in_service: string; cost: number; salvage: number; life_months: number; paid_from?: string; notes?: string };

/** Adds an asset to the register. If it was paid from a bank or cash account and is not in the books yet, posts the purchase too. */
export async function addAsset(user: User, i: AssetInput) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance keeps the fixed assets register.');
  if (!i.name.trim()) throw new RuleError('Name the asset.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.in_service)) throw new RuleError('Enter the date it was put in service.');
  if (!(i.cost > 0)) throw new RuleError('Enter the cost.');
  if (!(i.salvage >= 0 && i.salvage < i.cost)) throw new RuleError('The salvage value must be less than the cost.');
  if (!(Number.isInteger(i.life_months) && i.life_months > 0 && i.life_months <= 600)) throw new RuleError('Enter the useful life in months (for example 36 or 60).');
  const project = i.cc.startsWith('p:') ? i.cc.slice(2) : null, dept = i.cc.startsWith('d:') ? i.cc.slice(2) : null;
  if (!project && !dept) throw new RuleError('Choose the project or department that uses it.');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    const account = s.account_map.fixedAssets;
    if (!account) throw new RuleError('No GL code is set for fixed assets. Pick it under "GL codes" on this page.');
    const id = crypto.randomUUID();
    let entryId: string | null = null;
    if (i.paid_from) {
      const [b] = await tx<{ code: string }[]>`select code from accounts where code = ${i.paid_from} and is_bank and postable`;
      if (!b) throw new RuleError('Choose the bank or cash account it was paid from.');
      checkLock(s, i.in_service);
      const lines: Line[] = [
        { account, dr: r2(i.cost), cr: 0, description: i.name.trim(), project_id: project, dept_id: dept },
        { account: b.code, dr: 0, cr: r2(i.cost), description: i.name.trim() },
      ];
      await validateLines(tx, lines, s);
      const jno = await nextNo(tx, 'JE-');
      [{ id: entryId }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
        values (${jno}, ${i.in_service}, ${'Fixed asset bought: ' + i.name.trim()}, '', 'expense', 'draft', 'asset', ${id}, ${user.id}) returning id`;
      await writeLines(tx, entryId!, lines);
      await postEntry(tx, user, entryId!, 'Fixed asset bought');
    }
    const no = await nextNo(tx, 'FA-');
    await tx`insert into fixed_assets (id, no, name, category, dept_id, project_id, in_service, cost, salvage, life_months, asset_account, purchase_entry_id, notes, created_by)
      values (${id}, ${no}, ${i.name.trim()}, ${i.category.trim()}, ${dept}, ${project}, ${i.in_service}, ${r2(i.cost)}, ${r2(i.salvage)}, ${i.life_months}, ${account}, ${entryId}, ${i.notes?.trim() ?? ''}, ${user.id})`;
    await audit(tx, user, 'asset', id, 'Added to the register', `${no} · ${r2(i.cost).toFixed(2)}`);
    return id;
  });
}

/** Stops depreciation from the month after `date` (sold or written off). The sale or write-off itself is a separate entry. */
export async function stopAsset(user: User, id: string, date: string, note: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance keeps the fixed assets register.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RuleError('Enter the date it was sold or written off.');
  if (!note.trim()) throw new RuleError('Say what happened to it.');
  const r = await sql`update fixed_assets set stopped_on = ${date}, stop_note = ${note.trim()} where id = ${id} and stopped_on is null`;
  if (!r.count) throw new RuleError('This asset is already stopped.');
  await audit(sql, user, 'asset', id, 'Depreciation stopped', `${date} · ${note.trim()}`);
}

/** Each asset's depreciation for the month: from the month it went into service, until fully depreciated or stopped. */
export async function depreciationFor(period: string) {
  checkPeriod(period);
  const start = period + '-01', end = monthEnd(period);
  const assets = await sql<{ id: string; no: string; name: string; cost: number; salvage: number; life_months: number; dept_id: string | null; project_id: string | null; done: number; here: number | null }[]>`
    select f.id, f.no, f.name, f.cost::float cost, f.salvage::float salvage, f.life_months, f.dept_id, f.project_id,
      coalesce((select sum(l.amount) from depreciation_lines l where l.asset_id = f.id and l.period <> ${period}), 0)::float done,
      (select l.amount::float from depreciation_lines l where l.asset_id = f.id and l.period = ${period}) here
    from fixed_assets f where f.in_service <= ${end}::date and (f.stopped_on is null or f.stopped_on >= ${start}::date) order by f.no`;
  return assets.map(a => ({ ...a, amount: a.here ?? r2(Math.max(0, Math.min(monthly(a), a.cost - a.salvage - a.done))) })).filter(a => a.amount > 0);
}

export async function depreciationRun(period: string) {
  const [r] = await sql<{ entry_id: string; no: string; total: number; posted_by: string | null; posted_at: string }[]>`
    select r.entry_id, e.no, r.total::float total, u.name posted_by, to_char(r.posted_at,'YYYY-MM-DD') posted_at
    from depreciation_runs r join journal_entries e on e.id = r.entry_id left join users u on u.id = r.posted_by where r.period = ${period}`;
  return r ?? null;
}
export const depreciationRuns = () => sql<{ period: string; entry_id: string; no: string; total: number }[]>`
  select r.period, r.entry_id, e.no, r.total::float total from depreciation_runs r join journal_entries e on e.id = r.entry_id order by r.period desc limit 24`;

/** Posts the month's depreciation as one entry dated the month end. */
export async function postDepreciation(user: User, period: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance posts depreciation.');
  checkPeriod(period);
  if (await depreciationRun(period)) throw new RuleError('Depreciation for this month is already posted.');
  const rows = await depreciationFor(period);
  if (!rows.length) throw new RuleError('Nothing to depreciate this month.');
  const s = await getSettings();
  const exp = s.account_map.depExp, acc = s.account_map.accDep;
  if (!exp) throw new RuleError('Pick the depreciation expense GL code first (GL codes, on the Fixed assets page).');
  if (!acc) throw new RuleError('Pick the accumulated depreciation GL code first (GL codes, on the Fixed assets page).');
  const end = monthEnd(period), total = r2(rows.reduce((t, r) => t + r.amount, 0));
  const lines: Line[] = [
    ...rows.map(r => ({ account: exp, dr: r.amount, cr: 0, description: `${r.no} ${r.name}`, project_id: r.project_id, dept_id: r.dept_id })),
    { account: acc, dr: 0, cr: total, description: `Depreciation ${period}` },
  ];
  return sql.begin(async tx => {
    const st = await getSettings(tx);
    checkLock(st, end);
    await validateLines(tx, lines, st, { officeOnProject: true }); // an office expense code may carry the project that uses the asset
    const jno = await nextNo(tx, 'JE-');
    const [{ id }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${end}, ${'Depreciation ' + period}, ${'DEP-' + period}, 'adjustment', 'draft', 'depreciation', ${period}, ${user.id}) returning id`;
    await writeLines(tx, id, lines);
    await postEntry(tx, user, id, 'Depreciation posted');
    await tx`insert into depreciation_runs (period, entry_id, total, posted_by) values (${period}, ${id}, ${total}, ${user.id})`;
    for (const r of rows) await tx`insert into depreciation_lines (period, asset_id, amount) values (${period}, ${r.id}, ${r.amount})`;
    await audit(tx, user, 'depreciation', period, 'Depreciation posted', `${jno} · ${total.toFixed(2)}`);
    return id;
  });
}

/** Voids a month's depreciation (a reversal on the same date) so it can be posted again. */
export async function voidDepreciation(user: User, period: string, reason = '') {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance voids depreciation.');
  const r = await depreciationRun(period);
  if (!r) throw new RuleError('No depreciation is posted for this month.');
  await reverseEntry(user, r.entry_id, reason || `Depreciation ${period} voided`, monthEnd(period));
  await sql.begin(async tx => {
    await tx`delete from depreciation_runs where period = ${period}`;
    await audit(tx, user, 'depreciation', period, 'Depreciation voided', r.no);
  });
}

/** Finance picks the register's GL codes; they must be existing codes of the right type. */
export async function saveAssetCodes(user: User, codes: { fixedAssets: string; accDep: string; depExp: string }) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance sets these GL codes.');
  const want = { fixedAssets: 'asset', accDep: 'asset', depExp: 'expense' } as const;
  const map: Record<string, string> = {};
  for (const k of Object.keys(want) as (keyof typeof want)[]) {
    const code = codes[k]?.trim();
    if (!code) continue;
    const [a] = await sql<{ type: string; postable: boolean }[]>`select type, postable from accounts where code = ${code}`;
    if (!a || !a.postable || a.type !== want[k]) throw new RuleError(`${code} is not a postable ${want[k]} code.`);
    map[k] = code;
  }
  await sql.begin(async tx => {
    await tx`update settings set account_map = account_map || ${tx.json(map)} where id = 1`;
    await audit(tx, user, 'settings', 'account_map', 'Fixed asset GL codes', JSON.stringify(map));
  });
}
