import 'server-only';
import { sql } from './db';
import { r2 } from './money';
import { type Line, RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit, checkLock, getSettings, nextNo, postEntry, reverseEntry, validateLines, writeLines } from './books';

// Opening balances (improvement 8). Finance types the balance of every asset, liability and equity account on the day
// the books start (default 1 January 2026), the partners' funding on their current accounts among them, and posts them
// as one opening entry. Whatever the typed figures leave unbalanced goes to retained earnings. The entry can be voided
// (reversed on the same date) to correct it and post again.

export type OpeningRow = { code: string; name: string; type: string; parent: string | null; partner: string | null; dr: number; cr: number; posted_dr: number; posted_cr: number };

/** The opening entry in force: posted and not reversed. */
export async function openingEntry() {
  const [e] = await sql<{ id: string; no: string; date: string; posted_at: string }[]>`
    select id, no, to_char(date,'YYYY-MM-DD') date, to_char(posted_at,'YYYY-MM-DD') posted_at from journal_entries
    where source_type = 'opening' and status = 'posted' and reversed_by is null order by posted_at desc limit 1`;
  return e ?? null;
}

/** Every postable balance-sheet account with its typed opening figure and what the opening entry in force posted. */
export async function openingRows(): Promise<OpeningRow[]> {
  const e = await openingEntry();
  return sql<OpeningRow[]>`
    select a.code, a.name, a.type, a.parent, p.name partner, coalesce(o.dr, 0)::float dr, coalesce(o.cr, 0)::float cr,
      coalesce((select sum(l.dr) from journal_lines l where l.entry_id = ${e?.id ?? ''} and l.account = a.code), 0)::float posted_dr,
      coalesce((select sum(l.cr) from journal_lines l where l.entry_id = ${e?.id ?? ''} and l.account = a.code), 0)::float posted_cr
    from accounts a left join opening_balances o on o.account = a.code left join partners p on p.account = a.code and p.active
    where a.postable and a.type in ('asset', 'liability', 'equity')
    order by (p.id is null), a.code`;
}

/** Saves the typed figures (a line with both sides keeps the difference on its side). */
export async function saveOpening(user: User, figures: { account: string; dr: number; cr: number }[]) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance enters opening balances.');
  await sql.begin(async tx => {
    for (const f of figures) {
      const net = r2((f.dr || 0) - (f.cr || 0));
      if (!net) { await tx`delete from opening_balances where account = ${f.account}`; continue; }
      await tx`insert into opening_balances (account, dr, cr, updated_by) values (${f.account}, ${net > 0 ? net : 0}, ${net < 0 ? -net : 0}, ${user.id})
        on conflict (account) do update set dr = excluded.dr, cr = excluded.cr, updated_by = excluded.updated_by, updated_at = now()`;
    }
    await audit(tx, user, 'opening', 'books', 'Opening balances saved', `${figures.filter(f => r2(f.dr - f.cr)).length} accounts`);
  });
}

/** The lines the opening entry would post, with the balancing line on retained earnings. */
export async function openingLines(): Promise<{ lines: Line[]; dr: number; cr: number; difference: number; retained: string | null }> {
  const s = await getSettings();
  const rows = await sql<{ account: string; dr: number; cr: number }[]>`select account, dr::float dr, cr::float cr from opening_balances where dr <> 0 or cr <> 0 order by account`;
  const lines: Line[] = rows.map(r => ({ account: r.account, dr: r.dr, cr: r.cr, description: 'Opening balance' }));
  const dr = r2(rows.reduce((t, r) => t + r.dr, 0)), cr = r2(rows.reduce((t, r) => t + r.cr, 0));
  const difference = r2(dr - cr), retained = s.account_map.retained ?? null;
  if (difference && retained) lines.push({ account: retained, dr: difference < 0 ? -difference : 0, cr: difference > 0 ? difference : 0, description: 'Opening balance: difference to retained earnings' });
  return { lines, dr, cr, difference, retained };
}

/** Posts the opening entry on the opening date. Only one can be in force: void the old one first. */
export async function postOpening(user: User, date?: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance posts opening balances.');
  if (await openingEntry()) throw new RuleError('An opening entry is already posted. Void it first, then post the corrected one.');
  const { lines, difference, retained } = await openingLines();
  if (!lines.length) throw new RuleError('Type at least one opening balance.');
  if (difference && !retained) throw new RuleError('The figures do not balance and no retained earnings code is set to take the difference.');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    const d = date || s.opening_date;
    checkLock(s, d);
    await validateLines(tx, lines, s);
    if (date) await tx`update settings set opening_date = ${date} where id = 1`;
    const no = await nextNo(tx, 'JE-');
    const [{ id }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${no}, ${d}, 'Opening balances', 'OPENING', 'adjustment', 'draft', 'opening', 'books', ${user.id}) returning id`;
    await writeLines(tx, id, lines);
    await postEntry(tx, user, id, 'Opening balances posted');
    await audit(tx, user, 'opening', 'books', 'Opening entry posted', no);
    return id;
  });
}

/** Voids the opening entry in force with a reversal on its own date, so the figures can be corrected and posted again. */
export async function voidOpening(user: User, reason = '') {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance voids the opening entry.');
  const e = await openingEntry();
  if (!e) throw new RuleError('No opening entry is posted.');
  const rid = await reverseEntry(user, e.id, reason || 'Opening balances corrected', e.date);
  await audit(sql, user, 'opening', 'books', 'Opening entry voided', e.no);
  return rid;
}
