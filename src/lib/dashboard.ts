import 'server-only';
import { sql } from './db';
import { r2 } from './money';
import { today } from './dates';

// Partners' dashboard (improvement 4): per project what was sold, billed, collected, spent and committed, and the margin
// it is heading for; and a 30-day cash view from the bank and petty cash, collections due and approved payment requests.

export type ProjectMoney = {
  id: string; code: string; name: string; phase: string | null; status: string;
  contract: number; invoiced: number; collected: number; cost: number; committed: number; budget: number;
  expectedCost: number; margin: number; marginPct: number | null;
};

/** Each client project: contract (with approved variations), invoiced, collected, cost to date, open commitments and the expected margin. */
export async function projectMoney(): Promise<ProjectMoney[]> {
  const rows = await sql<{ id: string; code: string; name: string; phase: string | null; status: string; contract: number; budget: number; invoiced: number; collected: number; cost: number; po_open: number; wo_open: number; pr_pending: number }[]>`
    select p.id, p.code, p.name, p.phase, p.status, coalesce(p.contract, 0)::float contract, coalesce(p.budget, 0)::float budget,
      coalesce((select sum(i.total) from invoices i where i.kind = 'sales' and i.status = 'posted' and i.project_id = p.id), 0)::float invoiced,
      coalesce((select sum(py.amount) from payments py where py.kind = 'receipt' and py.status = 'posted' and py.project_id = p.id), 0)::float
      + coalesce((select sum(l.cr - l.dr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.kind = 'collection'
        join accounts a on a.code = l.account and a.type = 'revenue' where l.project_id = p.id), 0)::float collected,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.code = l.account and a.type = 'expense' where l.project_id = p.id), 0)::float cost,
      -- approved purchase orders not yet billed by the vendor
      coalesce((select sum(greatest(
          coalesce((select sum(round(x.qty * x.price, 2)) from purchase_request_lines x where x.request_id = r.id), 0)
          - coalesce((select sum(i.subtotal) from invoices i where i.po_id = r.id and i.status = 'posted'), 0), 0))
        from purchase_requests r where r.project_id = p.id and r.status = 'approved' and not r.closed), 0)::float po_open,
      -- approved work orders less what their claims have already turned into payment requests
      coalesce((select sum(greatest(
          coalesce((select sum(round(x.qty * x.rate, 2)) from work_order_lines x where x.work_order_id = w.id), 0)
          - coalesce((select sum(i.subtotal) from sub_claims c join invoices i on i.id = c.request_id and i.status in ('pending', 'posted') where c.work_order_id = w.id), 0), 0))
        from work_orders w where w.project_id = p.id and w.status = 'approved'), 0)::float wo_open,
      -- payment requests still on their way through the approvals
      coalesce((select sum(i.subtotal) from invoices i where i.kind = 'purchase' and i.status = 'pending' and i.project_id = p.id
        and not exists (select 1 from payment_request_bills b where b.request_id = i.id)), 0)::float pr_pending
    from projects p where not p.is_office and p.status <> 'Closed' order by (p.status = 'Active') desc, p.code`;
  return rows.map(r => {
    const committed = r2(r.po_open + r.wo_open + r.pr_pending);
    const expectedCost = r2(Math.max(r.budget, r.cost + committed));
    const margin = r2(r.contract - expectedCost);
    return {
      id: r.id, code: r.code, name: r.name, phase: r.phase, status: r.status, contract: r2(r.contract), invoiced: r2(r.invoiced), collected: r2(r.collected),
      cost: r2(r.cost), committed, budget: r2(r.budget), expectedCost, margin, marginPct: r.contract ? Math.round(margin / r.contract * 1000) / 10 : null,
    };
  });
}

export type CashWeek = { from: string; to: string; inflow: number; outflow: number; closing: number };
export type CashView = {
  bank: number; pettyCash: number; opening: number; overdueIn: number; overdueOut: number;
  weeks: CashWeek[]; closing: number; pendingRequests: number; card: number; cardLimit: number; cardAvailable: number;
  ins: { no: string; party: string; due: string; amount: number; href: string }[];
  outs: { no: string; party: string; due: string; amount: number; href: string }[];
};
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/**
 * The next 30 days: today's cash in bank and petty cash, plus client invoices falling due, less approved payment requests
 * and vendor invoices falling due (no due date: due now). Overdue amounts are counted in the first week. Requests still in
 * approval are shown apart, as they may still change.
 */
export async function cashView(now = today()): Promise<CashView> {
  const end = plus(now, 29);
  const [[cash], ins, outs, [pending], [lim]] = await Promise.all([
    sql<{ bank: number; petty: number; card: number }[]>`
      select coalesce(sum(case when coalesce(b.kind, 'bank') = 'bank' and a.type = 'asset' then l.dr - l.cr end), 0)::float bank,
        coalesce(sum(case when b.kind = 'cash' and not coalesce(b.hidden, false) then l.dr - l.cr end), 0)::float petty, coalesce(sum(case when b.kind = 'card' then l.cr - l.dr end), 0)::float card
      from accounts a left join bank_accounts b on b.account = a.code join journal_lines l on l.account = a.code join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where a.is_bank`,
    sql<{ id: string; no: string; party: string; due: string; amount: number }[]>`
      select i.id, i.no, p.name party, to_char(coalesce(i.due_date, i.date),'YYYY-MM-DD') due, (i.total - invoice_paid(i.id))::float amount
      from invoices i join parties p on p.id = i.party_id where i.kind = 'sales' and i.status = 'posted' and i.total - invoice_paid(i.id) > 0.004
        and coalesce(i.due_date, i.date) <= ${end}::date order by coalesce(i.due_date, i.date), i.no`,
    sql<{ id: string; no: string; party: string; due: string; amount: number; po_id: string | null }[]>`
      select i.id, i.no, p.name party, to_char(coalesce(i.due_date, ${now}::date),'YYYY-MM-DD') due, (i.net - invoice_paid(i.id))::float amount, case when i.is_bill then i.id end po_id
      from invoices i join parties p on p.id = i.party_id
      where i.kind = 'purchase' and i.status = 'posted' and i.net - invoice_paid(i.id) > 0.004
        and not exists (select 1 from payment_request_bills b where b.request_id = i.id)
        and (not i.is_bill or exists (select 1 from payment_request_bills b join invoices r on r.id = b.request_id and r.status = 'posted' where b.bill_id = i.id))
        and coalesce(i.due_date, ${now}::date) <= ${end}::date order by coalesce(i.due_date, ${now}::date), i.no`,
    sql<{ n: number }[]>`select coalesce(sum(net), 0)::float n from invoices where kind = 'purchase' and status = 'pending'`,
    sql<{ n: number }[]>`select coalesce(sum(credit_limit), 0)::float n from bank_accounts where kind = 'card'`,
  ]);
  const opening = r2(cash.bank + cash.petty);
  const weeks: CashWeek[] = [];
  let bal = opening;
  for (let k = 0; k < 5; k++) {
    const from = plus(now, k * 7), to = k === 4 ? end : plus(now, k * 7 + 6);
    const inWeek = (d: string) => (k === 0 ? d <= to : d >= from && d <= to);
    const inflow = r2(ins.filter(x => inWeek(x.due)).reduce((t, x) => t + x.amount, 0));
    const outflow = r2(outs.filter(x => inWeek(x.due)).reduce((t, x) => t + x.amount, 0));
    bal = r2(bal + inflow - outflow);
    weeks.push({ from, to, inflow, outflow, closing: bal });
  }
  return {
    bank: r2(cash.bank), pettyCash: r2(cash.petty), card: r2(cash.card), cardLimit: r2(lim.n), cardAvailable: r2(lim.n - cash.card), opening,
    overdueIn: r2(ins.filter(x => x.due < now).reduce((t, x) => t + x.amount, 0)),
    overdueOut: r2(outs.filter(x => x.due < now).reduce((t, x) => t + x.amount, 0)),
    weeks, closing: bal, pendingRequests: r2(pending.n),
    ins: ins.map(x => ({ ...x, amount: r2(x.amount), href: `/sales-invoices/${x.id}` })),
    outs: outs.map(({ po_id, ...x }) => ({ ...x, amount: r2(x.amount), href: po_id ? `/purchasing/invoices/${x.id}` : `/payment-requests/${x.id}` })),
  };
}
