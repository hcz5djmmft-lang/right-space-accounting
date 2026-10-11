import 'server-only';
import { sql } from './db';
import { r2 } from './money';
import { RuleError } from './ledger';
import { type User, hasRole } from './roles';
import { audit } from './books';
import { type BoqLine, guessAccount, parseBoq } from './boq-parse';
import { readSpreadsheet } from './xlsx';

// The BOQ of a project against actual spending: the uploaded BOQ is the budget per GL code; actual is what is posted on
// the project's codes; on order is what approved purchase orders still have to deliver plus payment requests waiting
// for approval.

const mayUpload = (u: User) => hasRole(u, 'finance', 'engineering');

/** The project's postable expense codes (its own copies), for matching BOQ lines. */
export const projectAccounts = (projectId: string) => sql<{ code: string; name: string }[]>`
  select code, name from accounts where project_id = ${projectId} and postable and type = 'expense' order by code`;

/** Reads an uploaded BOQ file and makes it the project's BOQ, each line matched to a GL code where one fits (Finance or Engineering). */
export async function uploadBoq(user: User, projectId: string, fileName: string, body: Buffer) {
  if (!mayUpload(user)) throw new RuleError('Only Finance or Engineering can upload a BOQ.');
  const [p] = await sql<{ id: string; is_office: boolean }[]>`select id, is_office from projects where id = ${projectId}`;
  if (!p) throw new RuleError('Project not found.');
  if (p.is_office) throw new RuleError('A BOQ belongs to a project, not the office.');
  let lines: BoqLine[];
  try { lines = parseBoq(readSpreadsheet(body, fileName)).lines; }
  catch (e) { throw new RuleError(e instanceof Error ? e.message : 'The file could not be read.'); }
  if (!lines.length) throw new RuleError('No BOQ lines found: each line needs a description and an amount (or quantity and unit price).');
  const accounts = await projectAccounts(projectId);
  return sql.begin(async tx => {
    await tx`delete from boqs where project_id = ${projectId}`;
    const [{ id }] = await tx<{ id: string }[]>`insert into boqs (project_id, file_name, uploaded_by) values (${projectId}, ${fileName.slice(0, 200)}, ${user.id}) returning id`;
    let matched = 0;
    for (const [i, l] of lines.entries()) {
      const account = guessAccount(l, accounts);
      if (account) matched++;
      await tx`insert into boq_lines (boq_id, line_no, item_no, description, unit, qty, rate, amount, account)
        values (${id}, ${i + 1}, ${l.item_no.slice(0, 40)}, ${l.description}, ${l.unit.slice(0, 40)}, ${r2(l.qty * 1000) / 1000}, ${r2(l.rate)}, ${r2(l.amount)}, ${account})`;
    }
    const total = r2(lines.reduce((t, l) => t + l.amount, 0));
    await audit(tx, user, 'boq', projectId, 'BOQ uploaded', `${fileName} · ${lines.length} lines · ${total.toFixed(2)} · ${matched} matched to a GL code`);
    return { lines: lines.length, matched, total };
  });
}

/** Sets the GL code of BOQ lines by hand (Finance or Engineering). An empty code leaves a line unassigned. */
export async function setBoqAccounts(user: User, projectId: string, codes: Record<string, string>) {
  if (!mayUpload(user)) throw new RuleError('Only Finance or Engineering can change the BOQ.');
  const allowed = new Set((await projectAccounts(projectId)).map(a => a.code));
  await sql.begin(async tx => {
    const [b] = await tx<{ id: string }[]>`select id from boqs where project_id = ${projectId}`;
    if (!b) throw new RuleError('This project has no BOQ yet.');
    for (const [lineId, code] of Object.entries(codes)) {
      if (code && !allowed.has(code)) throw new RuleError(`GL code ${code} is not one of this project's codes.`);
      await tx`update boq_lines set account = ${code || null} where id = ${lineId} and boq_id = ${b.id}`;
    }
    await audit(tx, user, 'boq', projectId, 'GL codes of BOQ lines changed');
  });
}

export async function deleteBoq(user: User, projectId: string) {
  if (!mayUpload(user)) throw new RuleError('Only Finance or Engineering can remove a BOQ.');
  await sql.begin(async tx => {
    await tx`delete from boqs where project_id = ${projectId}`;
    await audit(tx, user, 'boq', projectId, 'BOQ removed');
  });
}

export type BoqHead = { id: string; file_name: string; uploaded_at: string; who: string | null };
export async function getBoq(projectId: string) {
  const [b] = await sql<BoqHead[]>`select b.id, b.file_name, to_char(b.uploaded_at,'YYYY-MM-DD') uploaded_at, u.name who from boqs b left join users u on u.id = b.uploaded_by where b.project_id = ${projectId}`;
  return b ?? null;
}
export const getBoqLines = (boqId: string) => sql<{ id: string; line_no: number; item_no: string; description: string; unit: string; qty: number; rate: number; amount: number; account: string | null }[]>`
  select id::text id, line_no, item_no, description, unit, qty, rate, amount, account from boq_lines where boq_id = ${boqId} order by line_no`;

export type BoqRow = { code: string | null; name: string; boq: number; actual: number; on_order: number; remaining: number; pct: number | null };

/** Per GL code of the project: BOQ amount, actual spent, still on order, remaining and % used; codes with spending but no BOQ too. */
export async function boqVsActual(projectId: string) {
  const b = await getBoq(projectId);
  const rows = await sql<{ code: string | null; name: string | null; boq: number; actual: number; on_order: number }[]>`
    with boq as (
      select l.account code, sum(l.amount) amount from boq_lines l join boqs b on b.id = l.boq_id where b.project_id = ${projectId} group by l.account
    ), actual as (
      select l.account code, sum(l.dr - l.cr) amount from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      join accounts a on a.code = l.account and a.type = 'expense' where l.project_id = ${projectId} group by l.account
    ), po as (
      select pl.account code, sum(greatest(pl.qty - coalesce((select sum(il.qty) from invoice_lines il join invoices i on i.id = il.invoice_id and i.status = 'posted' where il.po_line_id = pl.id), 0), 0) * pl.price) amount
      from purchase_request_lines pl join purchase_requests r on r.id = pl.request_id and r.status = 'approved' and not r.closed
      where r.project_id = ${projectId} group by pl.account
    ), pending as (
      select il.account code, sum(round(il.qty * il.price, 2)) amount from invoice_lines il join invoices i on i.id = il.invoice_id and i.kind = 'purchase' and i.status = 'pending'
      where coalesce(il.project_id, i.project_id) = ${projectId} group by il.account
    ), codes as (select code from boq union select code from actual union select code from po union select code from pending)
    select c.code, a.name, coalesce(boq.amount, 0) boq, coalesce(actual.amount, 0) actual, coalesce(po.amount, 0) + coalesce(pending.amount, 0) on_order
    from codes c left join accounts a on a.code = c.code left join boq on boq.code is not distinct from c.code
    left join actual on actual.code = c.code left join po on po.code = c.code left join pending on pending.code = c.code
    order by c.code nulls last`;
  const out: BoqRow[] = rows.map(r => ({
    code: r.code, name: r.code ? r.name ?? r.code : 'Not matched to a GL code yet',
    boq: r2(r.boq), actual: r2(r.actual), on_order: r2(r.on_order), remaining: r2(r.boq - r.actual - r.on_order),
    pct: r.boq ? Math.round((r.actual / r.boq) * 100) : null,
  })).filter(r => r.boq || r.actual || r.on_order);
  const sum = (k: 'boq' | 'actual' | 'on_order' | 'remaining') => r2(out.reduce((t, r) => t + r[k], 0));
  return { boq: b, rows: out, total: { boq: sum('boq'), actual: sum('actual'), on_order: sum('on_order'), remaining: sum('remaining') } };
}
