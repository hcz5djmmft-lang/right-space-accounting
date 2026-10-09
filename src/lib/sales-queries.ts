import 'server-only';
import { sql } from './db';

export type InvoiceRow = {
  id: string; no: string; date: string; due: string | null; status: string; party_id: string; customer: string; customer_code: string | null;
  project_id: string | null; project_code: string | null; project_name: string | null; ref: string; vat_rate: number;
  subtotal: number; vat: number; total: number; created_by: string | null; created_by_name: string | null; entry_id: string | null; entry_no: string | null;
  received: number;
};
export async function getInvoice(id: string) {
  const [r] = await sql<InvoiceRow[]>`
    select i.*, to_char(i.date,'YYYY-MM-DD') date, to_char(i.due_date,'YYYY-MM-DD') due, p.name customer, p.code customer_code,
      pr.code project_code, pr.name project_name, u.name created_by_name, e.no entry_no,
      coalesce((select sum(a.amount) from payment_allocations a join payments py on py.id = a.payment_id and py.status = 'posted' where a.invoice_id = i.id),0) received
    from invoices i join parties p on p.id = i.party_id left join projects pr on pr.id = i.project_id
    left join users u on u.id = i.created_by left join journal_entries e on e.id = i.entry_id
    where i.id = ${id} and i.kind = 'sales'`;
  return r;
}
export const getInvoiceLines = (id: string) => sql<{ account: string; name: string; description: string; qty: number; price: number; project_id: string | null; project_code: string | null }[]>`
  select l.account, a.name, l.description, l.qty, l.price, l.project_id, p.code project_code
  from invoice_lines l join accounts a on a.code = l.account left join projects p on p.id = l.project_id
  where l.invoice_id = ${id} order by l.line_no`;
/** Receipts allocated to an invoice. */
export const getInvoiceReceipts = (id: string) => sql<{ id: string; no: string; date: string; amount: number; entry_id: string | null; entry_no: string | null }[]>`
  select p.id, p.no, to_char(p.date,'YYYY-MM-DD') date, a.amount, p.entry_id, e.no entry_no
  from payment_allocations a join payments p on p.id = a.payment_id and p.status = 'posted' left join journal_entries e on e.id = p.entry_id
  where a.invoice_id = ${id} order by p.date, p.no`;
