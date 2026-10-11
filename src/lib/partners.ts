import 'server-only';
import { sql, type Tx } from './db';
import { r2 } from './money';
import { type Line, RuleError } from './ledger';
import { type User, hasRole } from './roles';
import { audit, checkLock, getSettings, nextNo, postEntry, validateLines, writeLines } from './books';

// Partners: the owners, their share of the company and their current accounts. Money put in is credited to the partner's
// account, withdrawals are debited, and Management shares out the profit of a period from retained earnings by share.
// Each partner entry carries {partner, action} in its form, so the page can tell deposits, withdrawals and profit apart.

export type PartnerAction = 'deposit' | 'withdrawal' | 'profit';
export type Partner = {
  id: string; name: string; share: number; account: string; account_name: string;
  deposits: number; withdrawals: number; profit: number; other: number; balance: number;
};

/** Every active partner with what they put in, took out, were given as profit and the balance of their current account. */
export async function listPartners(to = '', tx: Tx = sql) {
  const rows = await tx<{ id: string; name: string; share: number; account: string; account_name: string; deposits: number; withdrawals: number; profit: number; balance: number }[]>`
    select p.id, p.name, p.share, p.account, a.name account_name,
      coalesce(sum(case when x.action = 'deposit' then x.cr - x.dr end), 0) deposits,
      coalesce(sum(case when x.action = 'withdrawal' then x.dr - x.cr end), 0) withdrawals,
      coalesce(sum(case when x.action = 'profit' then x.cr - x.dr end), 0) profit,
      coalesce(sum(x.cr - x.dr), 0) balance
    from partners p join accounts a on a.code = p.account
    left join lateral (
      -- a reversal counts against the action of the entry it reverses
      select l.dr, l.cr, coalesce(e.form->>'action', o.form->>'action') action
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      left join journal_entries o on o.id = e.reverses_id
      where l.account = p.account and (${to} = '' or e.date <= ${to || null}::date)
    ) x on true
    where p.active group by p.id, a.name order by p.sort, p.name`;
  return rows.map(r => ({ ...r, other: r2(r.balance - r.deposits + r.withdrawals - r.profit) })) as Partner[];
}

/** Revenue less expenses on posted entries in a period: the profit there is to share. */
export async function profitFor(from: string, to: string, tx: Tx = sql) {
  const [r] = await tx<{ revenue: number; expense: number }[]>`
    select coalesce(sum(case when a.type = 'revenue' then l.cr - l.dr end), 0) revenue, coalesce(sum(case when a.type = 'expense' then l.dr - l.cr end), 0) expense
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.code = l.account
    where a.type in ('revenue', 'expense') and e.date >= ${from}::date and e.date <= ${to}::date`;
  return { revenue: r2(r.revenue), expense: r2(r.expense), profit: r2(r.revenue - r.expense) };
}

/** Splits an amount by share, to the piastre; the last partner takes the rounding so the parts add up exactly. */
export function splitByShare(amount: number, partners: { id: string; share: number }[]) {
  const total = partners.reduce((s, p) => s + Number(p.share), 0);
  if (!total) throw new RuleError('The partners have no shares set.');
  let left = r2(amount);
  return partners.map((p, i) => {
    const part = i === partners.length - 1 ? left : r2(amount * Number(p.share) / total);
    left = r2(left - part);
    return { id: p.id, amount: part };
  });
}

async function partnerOf(tx: Tx, id: string) {
  const [p] = await tx<{ id: string; name: string; account: string }[]>`select id, name, account from partners where id = ${id} and active`;
  if (!p) throw new RuleError('Choose the partner.');
  return p;
}

async function cashAccount(tx: Tx, code: string) {
  const [a] = await tx<{ code: string }[]>`select code from accounts where code = ${code} and is_bank and postable`;
  if (!a) throw new RuleError('Choose the bank or cash account.');
}

async function postPartnerEntry(tx: Tx, user: User, date: string, memo: string, lines: Line[], form: Record<string, unknown>) {
  const s = await getSettings(tx);
  checkLock(s, date);
  await validateLines(tx, lines, s);
  const no = await nextNo(tx, 'JE-');
  const [{ id }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, kind, status, form, created_by)
    values (${no}, ${date}, ${memo}, 'partner', 'draft', ${tx.json(form as never)}, ${user.id}) returning id`;
  await writeLines(tx, id, lines);
  await postEntry(tx, user, id);
  return id;
}

/** Money a partner puts into the company (self-financing): into the bank or cash, onto their current account (Finance). */
export async function postDeposit(user: User, p: { partner: string; bank: string; date: string; amount: number; memo: string }) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can record partners\' money.');
  if (!(p.amount > 0)) throw new RuleError('Enter the amount.');
  return sql.begin(async tx => {
    const pt = await partnerOf(tx, p.partner);
    await cashAccount(tx, p.bank);
    const memo = p.memo || `Money put in by ${pt.name}`;
    const id = await postPartnerEntry(tx, user, p.date, memo, [
      { account: p.bank, dr: r2(p.amount), cr: 0, description: memo },
      { account: pt.account, dr: 0, cr: r2(p.amount), description: memo },
    ], { partner: pt.id, action: 'deposit' });
    await audit(tx, user, 'partner', pt.id, 'Money put in', `${r2(p.amount).toFixed(2)} on ${p.date}`);
    return id;
  });
}

/** Money a partner takes out: from the bank or cash, off their current account (Finance). Gets a payment reference. */
export async function postWithdrawal(user: User, p: { partner: string; bank: string; date: string; amount: number; memo: string }) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance can record partners\' money.');
  if (!(p.amount > 0)) throw new RuleError('Enter the amount.');
  return sql.begin(async tx => {
    const pt = await partnerOf(tx, p.partner);
    await cashAccount(tx, p.bank);
    const memo = p.memo || `Withdrawal by ${pt.name}`;
    const id = await postPartnerEntry(tx, user, p.date, memo, [
      { account: pt.account, dr: r2(p.amount), cr: 0, description: memo },
      { account: p.bank, dr: 0, cr: r2(p.amount), description: memo },
    ], { partner: pt.id, action: 'withdrawal' });
    await audit(tx, user, 'partner', pt.id, 'Withdrawal', `${r2(p.amount).toFixed(2)} on ${p.date}`);
    return id;
  });
}

export type ProfitShare = { id: string; date_from: string; date_to: string; profit: number; entry_id: string; entry_no: string; reversed: boolean };
export const profitShares = () => sql<ProfitShare[]>`
  select s.id, to_char(s.date_from,'YYYY-MM-DD') date_from, to_char(s.date_to,'YYYY-MM-DD') date_to, s.profit, s.entry_id, e.no entry_no, e.reversed_by is not null reversed
  from partner_profit_shares s join journal_entries e on e.id = s.entry_id order by s.date_from desc, s.created_at desc`;

/**
 * Shares out the profit of a period (Management): retained earnings to each partner's current account by share; a loss
 * the other way round. A period that overlaps one already shared (and not reversed) is refused.
 */
export async function shareProfit(user: User, p: { from: string; to: string; date: string }) {
  if (!hasRole(user, 'management')) throw new RuleError('Only Management can share out the profit.');
  if (!p.from || !p.to || p.to < p.from) throw new RuleError('Pick the period: from a date to a later date.');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    const retained = s.account_map.retained;
    if (!retained) throw new RuleError('No GL code is set for retained earnings.');
    const [clash] = await tx<{ f: string; t: string }[]>`
      select to_char(s.date_from,'YYYY-MM-DD') f, to_char(s.date_to,'YYYY-MM-DD') t from partner_profit_shares s join journal_entries e on e.id = s.entry_id
      where e.reversed_by is null and s.date_from <= ${p.to}::date and s.date_to >= ${p.from}::date limit 1`;
    if (clash) throw new RuleError(`The profit of ${clash.f} to ${clash.t} is already shared out; pick days after it.`);
    const { profit } = await profitFor(p.from, p.to, tx);
    if (!profit) throw new RuleError('There is no profit or loss in that period.');
    const partners = await tx<{ id: string; name: string; share: number; account: string }[]>`select id, name, share, account from partners where active and share > 0 order by sort, name`;
    const parts = splitByShare(Math.abs(profit), partners);
    const memo = `${profit > 0 ? 'Profit' : 'Loss'} ${p.from} to ${p.to} shared to partners`;
    const lines: Line[] = [];
    if (profit > 0) lines.push({ account: retained, dr: profit, cr: 0, description: memo });
    for (const part of parts) {
      const pt = partners.find(x => x.id === part.id)!;
      if (!part.amount) continue;
      const d = `${pt.name} ${Number(pt.share)}% · ${memo}`;
      lines.push(profit > 0 ? { account: pt.account, dr: 0, cr: part.amount, description: d } : { account: pt.account, dr: part.amount, cr: 0, description: d });
    }
    if (profit < 0) lines.push({ account: retained, dr: 0, cr: -profit, description: memo });
    const id = await postPartnerEntry(tx, user, p.date, memo, lines, { action: 'profit', from: p.from, to: p.to });
    await tx`insert into partner_profit_shares (date_from, date_to, profit, entry_id, created_by) values (${p.from}, ${p.to}, ${profit}, ${id}, ${user.id})`;
    await audit(tx, user, 'partner', 'all', 'Profit shared', `${profit.toFixed(2)} for ${p.from} to ${p.to}`);
    return id;
  });
}

export type PartnerLine = { entry_id: string; no: string; date: string; payment_ref: string | null; memo: string; action: string | null; dr: number; cr: number };
/** A partner's current account, oldest first. */
export const partnerStatement = (account: string) => sql<PartnerLine[]>`
  select e.id entry_id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.payment_ref, coalesce(nullif(l.description, ''), e.memo) memo,
    coalesce(e.form->>'action', o.form->>'action') action, l.dr, l.cr
  from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' left join journal_entries o on o.id = e.reverses_id
  where l.account = ${account} order by e.date, e.no, l.line_no`;
