import 'server-only';
import { sql, type Tx } from './db';
import { r2 } from './money';
import { type AccountMap, type AccountType, type EntryForm, type Line, RuleError, assertBalanced, entryLines, missingCostCenter } from './ledger';
import { type User, hasRole } from './roles';

export type Settings = {
  company_name: string; vat_rate: number; require_approval: boolean; require_cc: boolean;
  lock_date: string | null; pr_prefix: string; cats: Record<string, string[]>; account_map: AccountMap;
  payroll: Record<string, unknown>;
};
export async function getSettings(tx: Tx = sql): Promise<Settings> {
  const [s] = await tx<Settings[]>`select *, to_char(lock_date, 'YYYY-MM-DD') lock_date from settings where id = 1`;
  return s;
}

export async function audit(tx: Tx, user: User | null, entity: string, entityId: string, action: string, note = '', data?: unknown) {
  await tx`insert into audit_log (user_id, entity, entity_id, action, note, data)
    values (${user?.id ?? null}, ${entity}, ${entityId}, ${action}, ${note}, ${data === undefined ? null : tx.json(data as never)})`;
}

/** Next document number, e.g. JE-00004. Safe when two people save at once (row lock). */
export async function nextNo(tx: Tx, prefix: string, width = 5): Promise<string> {
  const [r] = await tx<{ value: number }[]>`
    insert into counters (name, value) values (${prefix}, 1)
    on conflict (name) do update set value = counters.value + 1 returning value`;
  return prefix + String(r.value).padStart(width, '0');
}

async function accountTypes(tx: Tx, codes: string[]) {
  const rows = await tx<{ code: string; type: AccountType; postable: boolean; project_id: string | null }[]>`
    select code, type, postable, project_id from accounts where code = any(${codes})`;
  return new Map(rows.map(r => [r.code, r]));
}

/** Checks the rules every entry must meet before it is saved. */
export async function validateLines(tx: Tx, lines: Line[], settings: Settings) {
  assertBalanced(lines);
  const accs = await accountTypes(tx, lines.map(l => l.account));
  const [office] = await tx<{ id: string }[]>`select id from projects where is_office limit 1`;
  const officeId = office?.id;
  for (const l of lines) {
    const a = accs.get(l.account);
    if (!a) throw new RuleError(`GL code ${l.account} does not exist.`);
    if (!a.postable) throw new RuleError(`GL code ${l.account} is a heading and cannot take entries.`);
    // a project's GL codes are used only for that project; departments use the Office codes
    if (a.type === 'expense' && a.project_id) {
      if (l.project_id && a.project_id !== l.project_id) throw new RuleError(`GL code ${l.account} belongs to another project.`);
      if (l.dept_id && a.project_id !== officeId) throw new RuleError(`GL code ${l.account} is a project code; departments use the Office codes.`);
    }
  }
  if (settings.require_cc) {
    const miss = missingCostCenter(lines, c => accs.get(c)?.type);
    if (miss.length) throw new RuleError(`Assign every expense line to a project or a department (${miss.join(', ')}).`);
  }
}

export const canPostDirect = (u: User, s: Settings) => !s.require_approval || hasRole(u, 'finance');

export async function writeLines(tx: Tx, entryId: string, lines: Line[]) {
  await tx`delete from journal_lines where entry_id = ${entryId}`;
  for (const [i, l] of lines.entries())
    await tx`insert into journal_lines (entry_id, line_no, account, dr, cr, project_id, dept_id, party_id, description)
      values (${entryId}, ${i + 1}, ${l.account}, ${r2(l.dr)}, ${r2(l.cr)}, ${l.project_id ?? null}, ${l.dept_id ?? null}, ${l.party_id ?? null}, ${l.description ?? ''})`;
}

export function checkLock(s: Settings, date: string) {
  if (s.lock_date && date <= s.lock_date) throw new RuleError(`The books are locked up to ${s.lock_date}. Pick a later date or change the lock date in Settings.`);
}

export type SaveAction = 'draft' | 'submit' | 'post';

/** Saves an Expense / Collection / Transfer. Returns the entry id. */
export async function saveEntry(user: User, input: { id?: string; date: string; ref: string; form: EntryForm }, action: SaveAction) {
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    const lines = entryLines(input.form, s.account_map);
    await validateLines(tx, lines, s);
    if (action === 'post' && !canPostDirect(user, s)) action = 'submit';
    if (action !== 'draft') checkLock(s, input.date);
    const status = action === 'draft' ? 'draft' : action === 'submit' ? 'pending' : 'draft';

    let id = input.id;
    if (id) {
      const [old] = await tx<{ status: string; created_by: string }[]>`select status, created_by from journal_entries where id = ${id} for update`;
      if (!old) throw new RuleError('Entry not found.');
      if (old.status === 'posted') throw new RuleError('This entry is posted. Reverse it instead of editing.');
      await tx`update journal_entries set date = ${input.date}, memo = ${input.form.memo}, ref = ${input.ref},
        kind = ${input.form.type}, status = ${status}, form = ${tx.json(input.form as never)} where id = ${id}`;
      await audit(tx, user, 'journal', id, action === 'submit' ? 'Submitted for approval' : 'Edited');
    } else {
      const no = await nextNo(tx, 'JE-');
      [{ id }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, form, created_by)
        values (${no}, ${input.date}, ${input.form.memo}, ${input.ref}, ${input.form.type}, ${status}, ${tx.json(input.form as never)}, ${user.id})
        returning id`;
      await audit(tx, user, 'journal', id!, action === 'submit' ? 'Created and submitted for approval' : 'Created');
    }
    await writeLines(tx, id!, lines);
    if (action === 'post') await postEntry(tx, user, id!);
    return id!;
  });
}

/** Marks a draft/pending entry posted. The database re-checks balance and lock date. */
export async function postEntry(tx: Tx, user: User, id: string, note = 'Posted') {
  await tx`update journal_entries set status = 'posted', posted_by = ${user.id}, posted_at = now() where id = ${id}`;
  await audit(tx, user, 'journal', id, note);
}

export async function approveEntry(user: User, id: string) {
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    if (!canPostDirect(user, s)) throw new RuleError('Only Finance or Management can approve entries.');
    const [e] = await tx<{ status: string; date: string }[]>`select status, to_char(date,'YYYY-MM-DD') date from journal_entries where id = ${id} for update`;
    if (!e || e.status !== 'pending') throw new RuleError('This entry is not waiting for approval.');
    checkLock(s, e.date);
    await postEntry(tx, user, id, 'Approved & posted');
  });
}

export async function returnEntry(user: User, id: string, reason: string) {
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    if (!canPostDirect(user, s)) throw new RuleError('Only Finance or Management can return entries.');
    const r = await tx`update journal_entries set status = 'rejected' where id = ${id} and status = 'pending'`;
    if (!r.count) throw new RuleError('This entry is not waiting for approval.');
    await audit(tx, user, 'journal', id, 'Returned for changes', reason);
  });
}

export async function deleteDraft(user: User, id: string) {
  return sql.begin(async tx => {
    const [e] = await tx<{ status: string; created_by: string; source_type: string | null }[]>`select status, created_by, source_type from journal_entries where id = ${id} for update`;
    if (!e) throw new RuleError('Entry not found.');
    if (e.status === 'posted') throw new RuleError('Posted entries cannot be deleted; reverse them instead.');
    if (e.source_type) throw new RuleError('This entry belongs to a document; change the document instead.');
    if (e.created_by !== user.id && !hasRole(user, 'finance')) throw new RuleError('Only the person who created it, or Finance, can delete it.');
    await tx`delete from journal_entries where id = ${id}`;
    await audit(tx, user, 'journal', id, 'Deleted draft');
  });
}

/** Posts a mirror-image entry today and links the two. */
export async function reverseEntry(user: User, id: string, reason: string, date: string) {
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    if (!hasRole(user, 'finance')) throw new RuleError('Only Finance or Management can reverse entries.');
    checkLock(s, date);
    const [o] = await tx<{ no: string; status: string; reversed_by: string | null }[]>`select no, status, reversed_by from journal_entries where id = ${id} for update`;
    if (!o || o.status !== 'posted') throw new RuleError('Only posted entries can be reversed.');
    if (o.reversed_by) throw new RuleError('This entry is already reversed.');
    const lines = await tx<Line[]>`select account, dr, cr, project_id, dept_id, party_id, description from journal_lines where entry_id = ${id} order by line_no`;
    const no = await nextNo(tx, 'JE-');
    const [{ id: rid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, reverses_id, created_by)
      values (${no}, ${date}, ${'Reversal of ' + o.no + (reason ? ' · ' + reason : '')}, ${o.no}, 'reversal', 'draft', ${id}, ${user.id}) returning id`;
    await writeLines(tx, rid, lines.map(l => ({ ...l, dr: l.cr, cr: l.dr })));
    await postEntry(tx, user, rid, 'Posted reversal of ' + o.no);
    await tx`update journal_entries set reversed_by = ${rid} where id = ${id}`;
    await audit(tx, user, 'journal', id, 'Reversed by ' + no, reason);
    return rid;
  });
}

/** Adds a project with its own copy of the project GL codes (header 20000-N + the template codes). */
export async function createProjectCodes(tx: Tx, projectId: string, projectCode: string) {
  const [{ n }] = await tx<{ n: number }[]>`
    select greatest(
      coalesce((select max(substring(code from '^2\\d{4}-(\\d+)$')::int) from accounts), 0),
      coalesce((select max(gl_suffix) from projects), 0)) + 1 as n`;
  // template = the lowest-suffix copy of each 2xxxx code, so names and cost types follow the existing chart
  const tpl = await tx<{ base: string; name: string; cost_type: string | null }[]>`
    select distinct on (base) base, name, cost_type from (
      select substring(code from '^(2\\d{4})-\\d+$') base, substring(code from '-(\\d+)$')::int suffix, name, cost_type
      from accounts where code ~ '^2\\d{4}-\\d+$' and postable) t
    order by base, suffix`;
  if (!tpl.length) throw new RuleError('No project GL template found in the chart of accounts.');
  const hdr = `20000-${n}`;
  await tx`insert into accounts (code, name, type, postable, project_id) values (${hdr}, ${projectCode + ' project costs'}, 'expense', false, ${projectId})`;
  for (const t of tpl)
    await tx`insert into accounts (code, name, type, parent, postable, cost_type, project_id)
      values (${t.base + '-' + n}, ${t.name}, 'expense', ${hdr}, true, ${t.cost_type}, ${projectId})`;
  await tx`update projects set gl_suffix = ${n} where id = ${projectId}`;
  return { suffix: n, count: tpl.length };
}

export type TBRow = { code: string; name: string; type: AccountType; dr: number; cr: number };
export async function trialBalance(opts: { from?: string; to?: string; project?: string; dept?: string } = {}) {
  return sql<TBRow[]>`
    select a.code, a.name, a.type, coalesce(sum(l.dr),0) dr, coalesce(sum(l.cr),0) cr
    from journal_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join accounts a on a.code = l.account
    where (${opts.from ?? null}::date is null or e.date >= ${opts.from ?? null}::date)
      and (${opts.to ?? null}::date is null or e.date <= ${opts.to ?? null}::date)
      and (${opts.project ?? null}::text is null or l.project_id = ${opts.project ?? null})
      and (${opts.dept ?? null}::text is null or l.dept_id = ${opts.dept ?? null})
    group by a.code, a.name, a.type
    order by a.code`;
}
