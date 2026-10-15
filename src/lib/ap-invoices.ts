import 'server-only';
import { sql } from './db';
import { audit, checkLock, getSettings, nextNo, postEntry, validateLines, writeLines } from './books';
import { docLines, docTotals, RuleError, type DocInput } from './ledger';
import { hasRole, type User } from './roles';
import { r2 } from './money';
import { TZ } from './dates';

// Vendor invoices (update 20, items 19 to 21). Every invoice of a vendor or subcontractor is recorded first: received on
// a purchase order (Receive and invoice), or here by hand for a service with no PO. It posts at once (Dr the GL codes of
// its cost center, Dr input VAT, Cr WHT, Cr the vendor's account) and waits in AP > Invoices until a payment request
// picks it and pays it.

export type ServiceInvoiceInput = {
  date: string; due?: string | null; party: string; ref: string; project?: string | null; dept?: string | null;
  vatRate: number; whtRate: number; lines: { acc: string; desc?: string; amount: number }[];
};

export async function recordServiceInvoice(user: User, i: ServiceInvoiceInput) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance records vendor invoices.');
  return sql.begin(async tx => {
    const s = await getSettings(tx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new RuleError('Pick the date of the invoice.');
    checkLock(s, i.date);
    const [party] = await tx<{ name: string }[]>`select name from parties where id = ${i.party} and type = 'vendor'`;
    if (!party) throw new RuleError('Choose the vendor or subcontractor.');
    if (!i.ref.trim()) throw new RuleError("Enter the vendor's invoice number.");
    if (!i.project === !i.dept) throw new RuleError('Choose the project or department (one cost center per invoice).');
    const lines = i.lines.filter(l => l.acc && r2(l.amount) !== 0);
    if (!lines.length) throw new RuleError('Add at least one line with a GL code and an amount.');
    if (lines.some(l => r2(l.amount) < 0)) throw new RuleError('Amounts cannot be negative.');
    const [dup] = await tx`select 1 from invoices where kind = 'purchase' and is_bill and party_id = ${i.party} and lower(ref) = lower(${i.ref.trim()}) and status <> 'void'`;
    if (dup) throw new RuleError(`Invoice ${i.ref.trim()} of ${party.name} is already recorded.`);
    const no = await nextNo(tx, 'VI-');
    const doc: DocInput = {
      kind: 'purchase', no, party: i.party, project: i.project || null, dept: i.dept || null,
      vatRate: i.vatRate || 0, whtRate: i.whtRate || 0, siRate: 0, retRate: 0, dpAmount: 0,
      lines: lines.map(l => ({ acc: l.acc, desc: l.desc ?? '', qty: 1, price: r2(l.amount) })),
    };
    const t = docTotals(doc);
    const jl = docLines(doc, s.account_map);
    await validateLines(tx, jl, s);
    const [{ id }] = await tx<{ id: string }[]>`insert into invoices ${tx({
      kind: 'purchase', no, date: i.date, due_date: i.due || null, party_id: i.party, project_id: i.project || null, dept_id: i.dept || null, ref: i.ref.trim(), is_bill: true,
      vat_rate: doc.vatRate, wht_rate: doc.whtRate, subtotal: t.subtotal, vat: t.vat, wht: t.wht, total: t.total, net: t.net, status: 'draft', created_by: user.id,
    })} returning id`;
    for (const [k, l] of lines.entries())
      await tx`insert into invoice_lines (invoice_id, line_no, account, description, qty, price, project_id, dept_id)
        values (${id}, ${k + 1}, ${l.acc}, ${l.desc ?? ''}, 1, ${r2(l.amount)}, ${i.project || null}, ${i.dept || null})`;
    const jno = await nextNo(tx, 'JE-');
    const [{ id: eid }] = await tx<{ id: string }[]>`insert into journal_entries (no, date, memo, ref, kind, status, source_type, source_id, created_by)
      values (${jno}, ${i.date}, ${`${no} · ${party.name} · service invoice`}, ${i.ref.trim()}, 'payment_request', 'draft', 'invoice', ${id}, ${user.id}) returning id`;
    await writeLines(tx, eid, jl);
    await postEntry(tx, user, eid, 'Posted from ' + no);
    await tx`update invoices set status = 'posted', entry_id = ${eid} where id = ${id}`;
    await audit(tx, user, 'invoice', id, 'Service invoice recorded', `${no} · vendor invoice ${i.ref.trim()} · journal entry ${jno}`);
    return id;
  });
}

export type VendorInvoiceRow = {
  id: string; no: string; date: string; due: string | null; ref: string; vendor: string; party_id: string; is_sub: boolean; code: string | null; cc: string | null;
  po_no: string | null; status: string; net: number; paid: number; open: number; request_no: string | null; request_id: string | null; request_status: string | null; at: string;
};
/** Every vendor invoice, newest first, with what is paid and the payment request that covers it. */
export const listVendorInvoices = () => sql<VendorInvoiceRow[]>`
  select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, to_char(i.due_date,'YYYY-MM-DD') due, i.ref, v.name vendor, i.party_id, coalesce(v.is_sub, false) is_sub, v.code,
    coalesce(p.code, d.name) cc, r.po_no, i.status, i.net::float net, invoice_paid(i.id)::float paid, (i.net - invoice_paid(i.id))::float open,
    rq.no request_no, rq.id request_id, rq.status request_status, to_char(i.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at
  from invoices i join parties v on v.id = i.party_id left join purchase_requests r on r.id = i.po_id
    left join projects p on p.id = i.project_id left join departments d on d.id = i.dept_id
    left join lateral (select q.id, q.no, q.status from payment_request_bills b join invoices q on q.id = b.request_id and q.status in ('draft', 'pending', 'posted') where b.bill_id = i.id limit 1) rq on true
  where i.kind = 'purchase' and i.is_bill order by i.date desc, i.no desc limit 1000`;
