import 'server-only';
import { sql } from './db';
import { r2 } from './money';
import { today } from './dates';
import { aging, BUCKETS, type AgingDoc } from './reports';

// Payables (improvement 11): what Right Space owes its suppliers, from the vendor invoices and payment requests less the
// payments made. Aged per supplier (current, 1–30, 31–60, 61–90, 90+ days past due; an invoice with no due date is due
// 30 days after its date), and a payment calendar by due date with weekly totals against the cash in bank.

export type PayDoc = AgingDoc & { state: 'released' | 'waiting' | 'open'; href: string; project: string | null };
export type Supplier = { party_id: string; party: string; buckets: number[]; total: number; overdue: number; docs: PayDoc[] };

const plus = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

async function payDocs(asOf: string): Promise<PayDoc[]> {
  const { docs } = await aging({ side: 'purchase', asOf });
  if (!docs.length) return [];
  const info = await sql<{ id: string; po_id: string | null; project: string | null; released: boolean; waiting: boolean }[]>`
    select i.id, case when i.is_bill then coalesce(i.po_id, i.id) end po_id, p.code project,
      exists (select 1 from payment_request_bills b join invoices r on r.id = b.request_id and r.status = 'posted' where b.bill_id = i.id) released,
      exists (select 1 from payment_request_bills b join invoices r on r.id = b.request_id and r.status = 'pending' where b.bill_id = i.id) waiting
    from invoices i left join projects p on p.id = i.project_id where i.id in ${sql(docs.map(d => d.id))}`;
  const by = new Map(info.map(i => [i.id, i]));
  return docs.map(d => {
    const i = by.get(d.id)!;
    // a payment request is approved before it posts; a vendor invoice is released by its approved payment request
    const state = !i.po_id ? 'released' : i.released ? 'released' : i.waiting ? 'waiting' : 'open';
    return { ...d, state, project: i.project, href: i.po_id ? `/purchasing/invoices/${d.id}` : `/payment-requests/${d.id}` };
  });
}

/** Open payables per supplier, most overdue first. */
export async function supplierAging(asOf = today()) {
  const docs = await payDocs(asOf);
  const by = new Map<string, Supplier>();
  for (const d of docs) {
    const s = by.get(d.party_id) ?? { party_id: d.party_id, party: d.party, buckets: [0, 0, 0, 0, 0], total: 0, overdue: 0, docs: [] };
    s.buckets[d.bucket] = r2(s.buckets[d.bucket] + d.balance);
    s.total = r2(s.total + d.balance);
    if (d.bucket > 0) s.overdue = r2(s.overdue + d.balance);
    s.docs.push(d);
    by.set(d.party_id, s);
  }
  const suppliers = [...by.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  const totals = BUCKETS.map((_, i) => r2(suppliers.reduce((t, s) => t + s.buckets[i], 0)));
  return { suppliers, totals, total: r2(totals.reduce((t, v) => t + v, 0)) };
}

export type PayWeek = { label: string; from: string | null; to: string; docs: PayDoc[]; total: number; cashAfter: number };

/** What falls due to suppliers, week by week from today for `days` days, overdue first, against the cash in bank and petty cash. */
export async function paymentCalendar(now = today(), days = 30) {
  const end = plus(now, days - 1);
  const [docs, [cash]] = await Promise.all([
    payDocs(now),
    sql<{ n: number }[]>`select coalesce(sum(l.dr - l.cr), 0)::float n from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      join accounts a on a.code = l.account and a.is_bank and a.type = 'asset'`,
  ]);
  const due = docs.filter(d => d.due && d.due <= end).sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : a.no < b.no ? -1 : 1));
  const weeks: PayWeek[] = [];
  let left = r2(cash.n);
  const push = (label: string, from: string | null, to: string, xs: PayDoc[]) => {
    const total = r2(xs.reduce((t, d) => t + d.balance, 0));
    left = r2(left - total);
    weeks.push({ label, from, to, docs: xs, total, cashAfter: left });
  };
  push('Overdue', null, plus(now, -1), due.filter(d => d.due! < now));
  for (let from = now; from <= end; from = plus(from, 7)) {
    const to = plus(from, 6) < end ? plus(from, 6) : end;
    push(`${from} to ${to}`, from, to, due.filter(d => d.due! >= from && d.due! <= to));
  }
  const later = docs.filter(d => d.due && d.due > end);
  return { now, end, days, cash: r2(cash.n), weeks, total: r2(due.reduce((t, d) => t + d.balance, 0)), later: r2(later.reduce((t, d) => t + d.balance, 0)) };
}
