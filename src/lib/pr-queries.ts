import 'server-only';
import { sql } from './db';

export type PRRow = {
  id: string; no: string; date: string; due: string | null; status: string; party_id: string; vendor: string; vendor_code: string | null;
  project_id: string | null; dept_id: string | null; cc: string | null; cost_type: string | null; ref: string; requester: string | null;
  vat_rate: number; wht_rate: number; si_rate: number; ret_rate: number; dp_amount: number;
  subtotal: number; vat: number; wht: number; si: number; retention: number; total: number; net: number;
  created_by: string | null; created_by_name: string | null; entry_id: string | null; entry_no: string | null;
};
export async function getPR(id: string) {
  const [r] = await sql<PRRow[]>`
    select i.*, to_char(i.date,'YYYY-MM-DD') date, to_char(i.due_date,'YYYY-MM-DD') due, p.name vendor, p.code vendor_code,
      coalesce(pr.code, d.name || ' (dept.)') cc, u.name created_by_name, e.no entry_no
    from invoices i join parties p on p.id = i.party_id left join projects pr on pr.id = i.project_id left join departments d on d.id = i.dept_id
    left join users u on u.id = i.created_by left join journal_entries e on e.id = i.entry_id
    where i.id = ${id} and i.kind = 'purchase'`;
  return r;
}
export const getPRLines = (id: string) => sql<{ account: string; name: string; description: string; qty: number; price: number; project_id: string | null; dept_id: string | null; cc: string | null }[]>`
  select l.account, a.name, l.description, l.qty, l.price, l.project_id, l.dept_id, coalesce(p.code, d.name) cc
  from invoice_lines l join accounts a on a.code = l.account left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id
  where l.invoice_id = ${id} order by l.line_no`;
export const getPRApprovals = (id: string) => sql<{ step: number; step_name: string; who: string | null; at: string }[]>`
  select a.step, a.step_name, u.name who, to_char(a.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at
  from invoice_approvals a left join users u on u.id = a.user_id where a.invoice_id = ${id} order by a.step`;
