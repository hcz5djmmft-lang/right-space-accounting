import 'server-only';
import { sql, type Tx } from './db';
import { getSettings } from './books';
import type { BankKind } from './bank-groups';
import { r2 } from './money';

// Collections: what the company collects from clients (design, fit-out, furniture), by project and by how the money
// came in. Receipts (RCT) settle sales invoices or sit as advances; direct collection entries record money that never had an invoice.

export type CollectionType = { id: string; name: string; name_ar: string | null; account: string; sort: number; active: boolean };
export const collectionTypes = (tx: Tx = sql) => tx<CollectionType[]>`select id, name, name_ar, account, sort, active from collection_types where active order by sort, id`;

export type BankDetails = { account: string; bank_name: string | null; branch: string | null; account_no: string | null; iban: string | null; swift: string | null; holder: string | null };
/** The company's account clients are asked to pay into (printed on invoices and bank transfer receipts). */
export async function invoiceBankDetails() {
  const [b] = await sql<BankDetails[]>`select account, bank_name, branch, account_no, iban, swift, holder from bank_accounts where show_on_invoices order by account limit 1`;
  return b ?? null;
}

export type ReceivedRow = {
  id: string; kind: 'receipt' | 'entry'; no: string; date: string; customer: string | null; project_id: string | null; project_code: string | null;
  types: string | null; invoices: string | null; method: BankKind; account: string | null; amount: number; wht: number; ref: string; entry_id: string | null; entry_no: string | null; status: string;
};
/** Money received, newest first: receipts (against invoices, or advances) and direct collection entries, with the type and how it came in. */
export async function moneyReceived(f: { project?: string; from?: string; to?: string } = {}) {
  const s = await getSettings();
  const project = f.project ?? '', from = f.from ?? '', to = f.to ?? '';
  return sql<ReceivedRow[]>`
    select x.id, x.kind, x.no, to_char(x.d,'YYYY-MM-DD') date, x.customer, x.project_id, x.project_code, x.types, x.invoices, x.method, x.account, x.amount, x.wht, x.ref, x.entry_id, x.entry_no, x.status from (
      select p.id, 'receipt' kind, p.no, p.date d, c.name customer, p.project_id, pr.code project_code,
        (select string_agg(distinct t.name, ', ') from payment_allocations a join invoices i on i.id = a.invoice_id join collection_types t on t.id = i.category where a.payment_id = p.id) types,
        (select string_agg(i.no, ', ' order by i.no) from payment_allocations a join invoices i on i.id = a.invoice_id where a.payment_id = p.id) invoices,
        coalesce(b.kind, 'bank') method, p.bank account, p.amount, p.wht, p.ref, p.entry_id, e.no entry_no, p.status
      from payments p join parties c on c.id = p.party_id left join projects pr on pr.id = p.project_id
      left join bank_accounts b on b.account = p.bank left join journal_entries e on e.id = p.entry_id
      where p.kind = 'receipt' and p.status in ('posted', 'void')
      union all
      select e.id, 'entry', e.no, e.date, c.name, l.project_id, pr.code, t.name, null, coalesce(b.kind, 'bank'), bk.account, l.cr - l.dr, 0, e.ref, e.id, e.no, e.status
      from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.code = l.account and a.type = 'revenue'
      left join collection_types t on t.account = l.account left join projects pr on pr.id = l.project_id
      left join parties c on c.id = e.form->>'party'
      left join lateral (select bl.account from journal_lines bl join accounts ba on ba.code = bl.account and ba.is_bank where bl.entry_id = e.id and bl.dr > 0 order by bl.line_no limit 1) bk on true
      left join bank_accounts b on b.account = bk.account
      where e.kind = 'collection' and e.status = 'posted' and l.account <> ${s.account_map.interest ?? ''}
    ) x
    where (${project} = '' or x.project_id = ${project}) and (${from} = '' or x.d >= ${from || null}::date) and (${to} = '' or x.d <= ${to || null}::date)
    order by x.d desc, x.no desc limit 500`;
}

export type TypeTotal = { id: string; name: string; amount: number };
/** What came in per collection type in a period: receipts by the type of the invoices they settle, direct entries by their code, advances apart. */
export async function receivedByType(from = '', to = '') {
  const [s, types] = await Promise.all([getSettings(), collectionTypes()]);
  const rows = await sql<{ cat: string; amount: number }[]>`
    select x.cat, sum(x.amount) amount from (
      select coalesce(i.category, 'other') cat, a.amount, p.date from payment_allocations a join payments p on p.id = a.payment_id and p.kind = 'receipt' and p.status = 'posted' join invoices i on i.id = a.invoice_id
      union all
      select 'advance', p.amount - (select coalesce(sum(a.amount), 0) from payment_allocations a where a.payment_id = p.id), p.date from payments p where p.kind = 'receipt' and p.status = 'posted'
      union all
      select coalesce(t.id, 'other'), l.cr - l.dr, e.date from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.kind = 'collection'
        join accounts a on a.code = l.account and a.type = 'revenue' left join collection_types t on t.account = l.account where l.account <> ${s.account_map.interest ?? ''}
    ) x where x.amount <> 0 and (${from} = '' or x.date >= ${from || null}::date) and (${to} = '' or x.date <= ${to || null}::date)
    group by x.cat`;
  const by = new Map(rows.map(r => [r.cat, Number(r.amount)]));
  const out: TypeTotal[] = types.map(t => ({ id: t.id, name: t.name, amount: r2(by.get(t.id) ?? 0) }));
  if (by.get('other')) out.push({ id: 'other', name: 'Other revenue', amount: r2(by.get('other')!) });
  if (by.get('advance')) out.push({ id: 'advance', name: 'Advances, no invoice yet', amount: r2(by.get('advance')!) });
  return { types: out, total: r2(out.reduce((t, x) => t + x.amount, 0)) };
}

export type ProjectCollections = {
  id: string; code: string; name: string; status: string; client: string | null; contract: number | null;
  invoiced: number; settled: number; advances: number; direct: number; received: number; open: number;
};
/** Each project's client, what was invoiced, what came in (against invoices, as advances, or directly) and what is still to receive. */
export async function collectionsByProject() {
  const s = await getSettings();
  const rows = await sql<Omit<ProjectCollections, 'received' | 'open'>[]>`
    select pr.id, pr.code, pr.name, pr.status, c.name client, pr.contract,
      coalesce((select sum(i.total) from invoices i where i.kind = 'sales' and i.status = 'posted' and i.project_id = pr.id), 0) invoiced,
      coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' and p.kind = 'receipt'
        join invoices i on i.id = a.invoice_id where i.project_id = pr.id), 0) settled,
      coalesce((select sum(p.amount - (select coalesce(sum(a.amount), 0) from payment_allocations a where a.payment_id = p.id))
        from payments p where p.kind = 'receipt' and p.status = 'posted' and p.project_id = pr.id), 0) advances,
      coalesce((select sum(l.cr - l.dr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.kind = 'collection'
        join accounts a on a.code = l.account and a.type = 'revenue' where l.project_id = pr.id and l.account <> ${s.account_map.interest ?? ''}), 0) direct
    from projects pr left join parties c on c.id = pr.client_id where not pr.is_office order by (pr.status = 'Active') desc, pr.code`;
  return rows.map(r => ({ ...r, received: r2(r.settled + r.advances + r.direct), open: r2(r.invoiced - r.settled) }));
}

export type ReceiptRow = {
  id: string; no: string; date: string; status: string; party_id: string; customer: string; customer_full: string | null;
  project_id: string | null; project_code: string | null; project_name: string | null; bank: string; account_name: string; method: BankKind;
  amount: number; wht: number; memo: string; ref: string; entry_id: string | null; entry_no: string | null; created_by_name: string | null;
  bank_name: string | null; branch: string | null; account_no: string | null; iban: string | null; swift: string | null; holder: string | null;
};
export async function getReceipt(id: string) {
  const [r] = await sql<ReceiptRow[]>`
    select p.id, p.no, to_char(p.date,'YYYY-MM-DD') date, p.status, p.party_id, c.name customer, c.full_name customer_full, p.project_id, pr.code project_code, pr.name project_name,
      p.bank, a.name account_name, coalesce(b.kind, 'bank') method, p.amount, p.wht, p.memo, p.ref, p.entry_id, e.no entry_no, u.name created_by_name,
      b.bank_name, b.branch, b.account_no, b.iban, b.swift, b.holder
    from payments p join parties c on c.id = p.party_id left join projects pr on pr.id = p.project_id join accounts a on a.code = p.bank
    left join bank_accounts b on b.account = p.bank left join journal_entries e on e.id = p.entry_id left join users u on u.id = p.created_by
    where p.id = ${id} and p.kind = 'receipt'`;
  return r;
}
export const getReceiptAllocations = (id: string) => sql<{ invoice_id: string; no: string; date: string; type: string | null; total: number; amount: number; project_code: string | null }[]>`
  select a.invoice_id, i.no, to_char(i.date,'YYYY-MM-DD') date, t.name type, i.total, a.amount, pr.code project_code
  from payment_allocations a join invoices i on i.id = a.invoice_id left join collection_types t on t.id = i.category left join projects pr on pr.id = i.project_id
  where a.payment_id = ${id} order by i.no`;

export const METHOD_LABEL: Record<BankKind, string> = { bank: 'Bank transfer', cash: 'Cash', card: 'Card' };
