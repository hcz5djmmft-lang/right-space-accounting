import 'server-only';
import { sql } from './db';
import { TZ } from './dates';

// Audit trail (improvement 16): the snapshots the database keeps of entries, invoices, payments and payroll runs
// (migration 041), each set against the one before it, with who made the change (from the audit line written in the
// same transaction) and what the app called it (posted, approved, voided…).

export const KINDS: Record<string, string> = { journal: 'Entry', invoice: 'Invoice or payment request', payment: 'Payment or receipt', payroll: 'Payroll run' };

export type Change = { field: string; before: unknown; after: unknown };
export type LineChange = { kind: 'added' | 'removed'; text: string };
export type Event = {
  id: string; at: string; tbl: string; row_id: string; op: 'create' | 'change' | 'delete'; no: string; href: string | null;
  who: string | null; action: string | null; changes: Change[]; lines: LineChange[];
};

// fields that only follow from others or are noise in a diff
const SKIP = new Set(['id', 'lines', 'allocations', 'form', 'created_at', 'updated_at']);
const LABEL: Record<string, string> = { status: 'Status', date: 'Date', due_date: 'Due date', memo: 'Memo', ref: 'Reference', party_id: 'Party', project_id: 'Project', dept_id: 'Department',
  subtotal: 'Subtotal', vat: 'VAT', wht: 'WHT', total: 'Total', net: 'Net', amount: 'Amount', reversed_by: 'Reversed by', entry_id: 'Journal entry', kind: 'Kind', no: 'Number' };
export const fieldLabel = (f: string) => LABEL[f] ?? f.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const lineText = (tbl: string, l: Record<string, unknown>) => {
  const n = (v: unknown) => (Number(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '');
  if (tbl === 'journal') return `${l.account} ${l.dr && Number(l.dr) ? 'Dr ' + n(l.dr) : 'Cr ' + n(l.cr)}${l.description ? ` · ${l.description}` : ''}${l.project_id ? ` · ${l.project_id}` : ''}`;
  if (tbl === 'invoice') return `${l.account} ${l.qty} × ${n(l.price)}${l.description ? ` · ${l.description}` : ''}`;
  if (tbl === 'payment') return `${l.invoice_id}: ${n(l.amount)}`;
  return `${l.name ?? l.employee_id}: gross ${n(l.gross)}`;
};

/** What changed between two snapshots of a record. */
export function diff(tbl: string, before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const changes: Change[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const a = before?.[k] ?? null, b = after[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b) && (before || b !== null)) changes.push({ field: k, before: before ? a : null, after: b });
  }
  const list = (s: Record<string, unknown> | null) => ((s?.lines ?? s?.allocations ?? []) as Record<string, unknown>[]).map(l => lineText(tbl, l));
  const was = list(before), now = list(after), lines: LineChange[] = [];
  const left = [...was];
  for (const t of now) { const i = left.indexOf(t); if (i >= 0) left.splice(i, 1); else lines.push({ kind: 'added', text: t }); }
  for (const t of left) lines.push({ kind: 'removed', text: t });
  return { changes, lines };
}

const hrefOf = (tbl: string, d: Record<string, unknown>) => tbl === 'journal' ? `/entries/${d.id}`
  : tbl === 'invoice' ? (d.kind === 'sales' ? `/sales-invoices/${d.id}` : d.po_id ? `/purchasing/invoices/${d.id}` : `/payment-requests/${d.id}`)
  : tbl === 'payment' ? (d.kind === 'receipt' ? `/receipts/${d.id}` : null) : `/payroll/runs/${d.period}`;

export type Filter = { tbl?: string; who?: string; from?: string; to?: string; q?: string; limit?: number };

/** The changes, newest first, each with what it changed. */
export async function auditEvents(f: Filter = {}): Promise<Event[]> {
  const q = (f.q ?? '').trim();
  const rows = await sql<{ id: string; at: string; tbl: string; row_id: string; op: Event['op']; data: Record<string, unknown>; prev: Record<string, unknown> | null; who: string | null; who_id: string | null; action: string | null }[]>`
    select c.id::text id, to_char(c.at at time zone ${TZ},'YYYY-MM-DD HH24:MI:SS') at, c.tbl, c.row_id, c.op, c.data,
      (select p.data from change_log p where p.tbl = c.tbl and p.row_id = c.row_id and p.id < c.id order by p.id desc limit 1) prev,
      a.who, a.user_id who_id, a.action
    from change_log c
    left join lateral (select u.name who, l.user_id, l.action from audit_log l left join users u on u.id = l.user_id where l.txid = c.txid order by l.user_id is null, l.id limit 1) a on true
    where (${f.tbl ?? ''} = '' or c.tbl = ${f.tbl ?? ''})
      and (${f.from ?? ''} = '' or c.at >= (${f.from || null}::date)::timestamp at time zone ${TZ})
      and (${f.to ?? ''} = '' or c.at < (${f.to || null}::date + 1)::timestamp at time zone ${TZ})
      and (${f.who ?? ''} = '' or a.user_id = ${f.who ?? ''} or (a.user_id is null and c.data->>'created_by' = ${f.who ?? ''}))
      and (${q} = '' or c.data->>'no' ilike ${'%' + q + '%'} or c.row_id = ${q} or c.data->>'memo' ilike ${'%' + q + '%'})
    order by c.id desc limit ${Math.min(f.limit ?? 200, 500)}`;
  const names = new Map((await sql<{ id: string; name: string }[]>`select id, name from users`).map(u => [u.id, u.name]));
  return rows.map(r => {
    const { changes, lines } = r.op === 'delete' ? { changes: [], lines: [] } : diff(r.tbl, r.prev, r.data);
    const creator = r.op === 'create' && !r.who && typeof r.data.created_by === 'string' ? names.get(r.data.created_by) ?? null : null;
    return {
      id: r.id, at: r.at, tbl: r.tbl, row_id: r.row_id, op: r.op, no: String(r.data.no ?? r.data.period ?? r.row_id),
      href: r.op === 'delete' ? null : hrefOf(r.tbl, r.data), who: r.who ?? creator, action: r.action, changes, lines,
    };
  });
}

/** Everything the app logged (logins, settings, approvals, …), newest first. */
export const activity = (f: Filter = {}) => sql<{ id: string; at: string; who: string | null; entity: string; entity_id: string; action: string; note: string }[]>`
  select l.id::text id, to_char(l.at at time zone ${TZ},'YYYY-MM-DD HH24:MI:SS') at, u.name who, l.entity, l.entity_id, l.action, l.note
  from audit_log l left join users u on u.id = l.user_id
  where (${f.from ?? ''} = '' or l.at >= (${f.from || null}::date)::timestamp at time zone ${TZ})
    and (${f.to ?? ''} = '' or l.at < (${f.to || null}::date + 1)::timestamp at time zone ${TZ})
    and (${f.who ?? ''} = '' or l.user_id = ${f.who ?? ''})
    and (${(f.q ?? '').trim()} = '' or l.action ilike ${'%' + (f.q ?? '').trim() + '%'} or l.note ilike ${'%' + (f.q ?? '').trim() + '%'} or l.entity_id = ${(f.q ?? '').trim()})
  order by l.id desc limit ${Math.min(f.limit ?? 200, 500)}`;
