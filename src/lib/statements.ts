import 'server-only';
import crypto from 'node:crypto';
import { sql } from './db';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { audit } from './books';
import { TZ } from './dates';
import { readSpreadsheet } from './xlsx';
import { postBankCharge, postInterest } from './banks';

// Bank statement import (improvement 5; the credit card's statement uses the same, improvement 15). Finance uploads the
// statement as Excel or CSV; each line is matched to the posted book line on that account with the same amount within a
// few days, matched lines are ticked as cleared for the reconciliation, and what has no book line yet (bank charges,
// interest) can be recorded from the line. Amounts are from the company's side: money in (a credit on the bank's
// statement) is positive, money out negative; on a card, a purchase is money out.

export type ParsedLine = { date: string; description: string; ref: string; amount: number; balance: number | null };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const AR_DIGITS = /[٠-٩]/g;
const western = (s: string) => s.replace(AR_DIGITS, d => String(d.charCodeAt(0) - 0x660));

/** A statement date: 2026-10-12, 12/10/2026 (day first, as Egyptian banks print), 12-Oct-2026, 12 Oct 26, or an Excel day number. */
export function parseDate(raw: string): string | null {
  const s = western(String(raw ?? '')).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return valid(year(+m[3]), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3})[A-Za-z]*[-\s/.,]+(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(year(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
  }
  return null;
}
const year = (y: number) => (y < 100 ? 2000 + y : y);
function valid(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso ? iso : null;
}

/** An amount as printed: 1,234.50 · (1,234.50) · -1234.5 · 1,234.50 CR / DR. Empty: null. */
export function parseMoney(raw: string): number | null {
  let s = western(String(raw ?? '')).trim().replace(/EGP|LE|ج\.?م/gi, '').trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bDR\b|D$/i.test(s)) sign = -1;
  s = s.replace(/\b(CR|DR)\b|[CD]$/gi, '').replace(/[,\s]/g, '');
  if (s.startsWith('-')) { sign *= -1; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return r2(sign * Number(s));
}

const COL = {
  date: /^(booking|posting|transaction|trans\.?|txn)?\s*date$|^date|تاريخ/i,
  valueDate: /value\s*date|تاريخ\s*القيمة|تاريخ\s*الاستحقاق/i,
  description: /desc|narrat|details|particular|remark|البيان|الوصف|التفاصيل/i,
  ref: /ref|cheque|chq|doc(ument)?\s*no|المرجع|رقم\s*الشيك/i,
  debit: /debit|withdraw|money\s*out|paid\s*out|مدين|سحب|خصم/i,
  credit: /credit|deposit|money\s*in|paid\s*in|دائن|إيداع|ايداع|اضافة|إضافة/i,
  amount: /amount|المبلغ|القيمة/i,
  balance: /balance|الرصيد/i,
};

/** Reads a statement file into lines. The header row is found by its titles (English or Arabic), wherever it is. */
export function parseStatement(buf: Buffer, fileName = ''): ParsedLine[] {
  let rows: string[][];
  try { rows = readSpreadsheet(buf, fileName); } catch (e) { throw new RuleError(e instanceof Error ? e.message : 'The file could not be read.'); }
  let h = -1, cols: Partial<Record<keyof typeof COL, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 40) && h < 0; r++) {
    const found: Partial<Record<keyof typeof COL, number>> = {};
    rows[r].forEach((cell, c) => {
      const t = String(cell ?? '').trim();
      if (!t || t.length > 40) return;
      if (found.valueDate === undefined && COL.valueDate.test(t)) { found.valueDate = c; return; }
      for (const k of ['date', 'balance', 'debit', 'credit', 'description', 'ref', 'amount'] as const) if (found[k] === undefined && COL[k].test(t)) { found[k] = c; return; }
    });
    if ((found.date !== undefined || found.valueDate !== undefined) && (found.amount !== undefined || (found.debit !== undefined && found.credit !== undefined))) { h = r; cols = found; }
  }
  if (h < 0) throw new RuleError('No header row found. The statement needs a Date column and either Debit and Credit columns or an Amount column.');
  const dateCol = cols.date ?? cols.valueDate!;
  const out: ParsedLine[] = [];
  for (const row of rows.slice(h + 1)) {
    const date = parseDate(row[dateCol] ?? '') ?? (cols.valueDate !== undefined ? parseDate(row[cols.valueDate] ?? '') : null);
    if (!date) continue; // totals, page headers and blank rows
    let amount: number | null;
    if (cols.debit !== undefined && cols.credit !== undefined) {
      const dr = parseMoney(row[cols.debit] ?? ''), cr = parseMoney(row[cols.credit] ?? '');
      amount = dr === null && cr === null ? null : r2((cr ?? 0) - Math.abs(dr ?? 0));
    } else amount = parseMoney(row[cols.amount!] ?? '');
    if (amount === null || amount === 0) continue;
    out.push({
      date, amount,
      description: String(cols.description !== undefined ? row[cols.description] ?? '' : '').trim().slice(0, 300),
      ref: String(cols.ref !== undefined ? row[cols.ref] ?? '' : '').trim().slice(0, 80),
      balance: cols.balance !== undefined ? parseMoney(row[cols.balance] ?? '') : null,
    });
  }
  if (!out.length) throw new RuleError('The file has a header row but no lines with a date and an amount.');
  return out;
}

async function statementAccount(code: string) {
  const [a] = await sql<{ code: string; kind: string }[]>`select a.code, coalesce(b.kind, 'bank') kind from accounts a left join bank_accounts b on b.account = a.code where a.code = ${code} and a.is_bank and a.postable`;
  if (!a) throw new RuleError('Choose a bank or card account.');
  return a;
}

/** Imports a statement for one account: new lines are kept (a line already imported is skipped), then matched. */
export async function importStatement(user: User, account: string, fileName: string, buf: Buffer) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance imports bank statements.');
  await statementAccount(account);
  const lines = parseStatement(buf, fileName);
  const res = await sql.begin(async tx => {
    const [{ id: importId }] = await tx<{ id: string }[]>`insert into statement_imports (account, file_name, imported_by) values (${account}, ${fileName.slice(0, 200)}, ${user.id}) returning id`;
    let added = 0;
    const seen = new Map<string, number>();
    for (const l of lines) {
      // the same line twice in one file (two equal charges on a day) is kept twice; a re-import of the same file adds nothing
      const base = [account, l.date, l.amount.toFixed(2), l.description, l.ref, l.balance ?? ''].join('|');
      const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      const key = crypto.createHash('sha256').update(base + '|' + n).digest('hex');
      const r = await tx`insert into statement_lines (account, import_id, line_key, date, description, ref, amount, balance)
        values (${account}, ${importId}, ${key}, ${l.date}, ${l.description}, ${l.ref}, ${l.amount}, ${l.balance}) on conflict (line_key) do nothing`;
      added += r.count;
    }
    await tx`update statement_imports set lines = ${added} where id = ${importId}`;
    // the last line with a running balance gives the statement balance for the reconciliation
    const last = [...lines].sort((a, b) => a.date.localeCompare(b.date)).filter(l => l.balance !== null).at(-1);
    if (last) await tx`insert into bank_statements (account, stmt_date, stmt_balance, updated_by, updated_at) values (${account}, ${last.date}, ${last.balance}, ${user.id}, now())
      on conflict (account) do update set stmt_date = excluded.stmt_date, stmt_balance = excluded.stmt_balance, updated_by = excluded.updated_by, updated_at = now()`;
    await audit(tx, user, 'bank', account, 'Statement imported', `${fileName}: ${lines.length} lines, ${added} new`);
    return { read: lines.length, added };
  });
  const matched = await matchStatement(user, account);
  return { ...res, matched };
}

/** Matches each open statement line to a posted book line on the account with the same amount, the nearest date within `days`. */
export async function matchStatement(user: User, account: string, days = 7) {
  return sql.begin(async tx => {
    const open = await tx<{ id: string; date: string; amount: number }[]>`select id::text id, to_char(date,'YYYY-MM-DD') date, amount::float amount from statement_lines where account = ${account} and status = 'open' order by date, id`;
    let n = 0;
    for (const s of open) {
      const [c] = await tx<{ id: number }[]>`
        select l.id from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        where l.account = ${account} and round(l.dr - l.cr, 2) = ${s.amount} and abs(e.date - ${s.date}::date) <= ${days}
          and not exists (select 1 from statement_lines x where x.matched_line_id = l.id)
        order by abs(e.date - ${s.date}::date), e.date, l.id limit 1`;
      if (!c) continue;
      await tx`update statement_lines set status = 'matched', matched_line_id = ${c.id}, matched_by = ${user.id}, matched_at = now() where id = ${s.id}`;
      await tx`insert into bank_cleared (line_id, cleared_by) values (${c.id}, ${user.id}) on conflict (line_id) do nothing`;
      n++;
    }
    if (n) await audit(tx, user, 'bank', account, 'Statement lines matched', `${n} matched`);
    return n;
  });
}

export type StatementLine = { id: string; date: string; description: string; ref: string; amount: number; balance: number | null; status: string; entry_id: string | null; entry_no: string | null; entry_date: string | null };
export const statementLines = (account: string, opts: { status?: string; from?: string; to?: string } = {}) => sql<StatementLine[]>`
  select s.id::text id, to_char(s.date,'YYYY-MM-DD') date, s.description, s.ref, s.amount::float amount, s.balance::float balance, s.status,
    e.id entry_id, e.no entry_no, to_char(e.date,'YYYY-MM-DD') entry_date
  from statement_lines s left join journal_lines l on l.id = s.matched_line_id left join journal_entries e on e.id = l.entry_id
  where s.account = ${account} and (${opts.status ?? ''} = '' or s.status = ${opts.status ?? ''})
    and (${opts.from ?? ''} = '' or s.date >= ${opts.from || null}::date) and (${opts.to ?? ''} = '' or s.date <= ${opts.to || null}::date)
  order by s.date desc, s.id desc limit 500`;
export const statementCounts = async (account: string) => {
  const rows = await sql<{ status: string; n: number }[]>`select status, count(*)::int n from statement_lines where account = ${account} group by status`;
  const n = (s: string) => rows.find(r => r.status === s)?.n ?? 0;
  return { open: n('open'), matched: n('matched'), ignored: n('ignored') };
};
export const lastImport = async (account: string) => (await sql<{ file_name: string; lines: number; at: string; who: string | null }[]>`
  select i.file_name, i.lines, to_char(i.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who from statement_imports i left join users u on u.id = i.imported_by
  where i.account = ${account} order by i.at desc limit 1`)[0] ?? null;

async function openLine(id: string) {
  const [s] = await sql<{ id: string; account: string; date: string; amount: number; description: string; status: string }[]>`
    select id::text id, account, to_char(date,'YYYY-MM-DD') date, amount::float amount, description, status from statement_lines where id = ${id}`;
  if (!s) throw new RuleError('Statement line not found.');
  if (s.status !== 'open') throw new RuleError('This line is already matched or set aside.');
  return s;
}
async function matchToEntry(user: User, lineId: string, account: string, entryId: string) {
  const [l] = await sql<{ id: number }[]>`select id from journal_lines where entry_id = ${entryId} and account = ${account} order by line_no limit 1`;
  if (!l) return;
  await sql`update statement_lines set status = 'matched', matched_line_id = ${l.id}, matched_by = ${user.id}, matched_at = now() where id = ${lineId}`;
  await sql`insert into bank_cleared (line_id, cleared_by) values (${l.id}, ${user.id}) on conflict (line_id) do nothing`;
}

/** Records a statement line that has no book entry yet: money out as bank charges, money in as interest; then matches it. */
export async function recordFromLine(user: User, lineId: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance records bank charges and interest.');
  const s = await openLine(lineId);
  const memo = s.description || (s.amount < 0 ? 'Bank charges' : 'Bank interest');
  const entryId = s.amount < 0
    ? await postBankCharge(user, { bank: s.account, date: s.date, amount: -s.amount, memo })
    : await postInterest(user, { bank: s.account, date: s.date, amount: s.amount, memo });
  await matchToEntry(user, lineId, s.account, entryId);
  return entryId;
}

/** Sets a line aside (already dealt with another way), or brings it back. */
export async function ignoreLine(user: User, lineId: string, ignore = true) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance reconciles bank accounts.');
  const [s] = await sql<{ status: string; account: string }[]>`select status, account from statement_lines where id = ${lineId}`;
  if (!s) throw new RuleError('Statement line not found.');
  if (ignore && s.status !== 'open') throw new RuleError('Only open lines can be set aside.');
  await sql`update statement_lines set status = ${ignore ? 'ignored' : 'open'} where id = ${lineId} and status = ${ignore ? 'open' : 'ignored'}`;
  await audit(sql, user, 'bank', s.account, ignore ? 'Statement line set aside' : 'Statement line reopened', lineId);
}

/** Undoes a match (the book line stays posted and becomes uncleared). */
export async function unmatchLine(user: User, lineId: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance reconciles bank accounts.');
  await sql.begin(async tx => {
    const [s] = await tx<{ matched_line_id: number | null; account: string }[]>`select matched_line_id, account from statement_lines where id = ${lineId} and status = 'matched' for update`;
    if (!s) throw new RuleError('This line is not matched.');
    await tx`update statement_lines set status = 'open', matched_line_id = null, matched_by = null, matched_at = null where id = ${lineId}`;
    if (s.matched_line_id) await tx`delete from bank_cleared where line_id = ${s.matched_line_id}`;
    await audit(tx, user, 'bank', s.account, 'Statement match undone', lineId);
  });
}
