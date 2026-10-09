import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';

const TABS = [['open', 'Not yet received'], ['draft', 'Drafts'], ['all', 'All']] as const;

export default async function SalesInvoices({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab = 'open' } = await searchParams;
  const rows = await sql<{ id: string; no: string; date: string; due: string | null; customer: string; project: string | null; status: string; total: number; received: number }[]>`
    select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, to_char(i.due_date,'YYYY-MM-DD') due, p.name customer, pr.code project, i.status, i.total,
      coalesce((select sum(a.amount) from payment_allocations a join payments py on py.id = a.payment_id and py.status = 'posted' where a.invoice_id = i.id),0) received
    from invoices i join parties p on p.id = i.party_id left join projects pr on pr.id = i.project_id
    where i.kind = 'sales' order by i.date desc, i.no desc limit 500`;
  const shown = rows.filter(r => tab === 'open' ? r.status === 'posted' && r.total - r.received > 0.004 : tab === 'draft' ? r.status === 'draft' : true);
  const today = new Date().toISOString().slice(0, 10);
  const stateOf = (r: typeof rows[number]) =>
    r.status === 'posted' ? (r.total - r.received <= 0.004 ? 'Received' : r.received ? 'Part received' : r.due && r.due < today ? 'Overdue' : 'Open')
    : r.status === 'void' ? 'Void' : 'Draft';
  const cls = (r: typeof rows[number]) => r.status === 'void' ? 'rejected' : r.status === 'posted' ? (r.total - r.received <= 0.004 ? 'posted' : 'pending') : '';
  const open = shown.reduce((s, r) => s + (r.status === 'posted' ? r.total - r.received : 0), 0);
  return (
    <>
      <div className="head"><div><h1>Sales invoices</h1><p>Invoices to clients · {tab === 'open' ? `${fmt(open)} EGP still to receive` : 'VAT 14% on top'}</p></div>
        {hasRole(user, 'finance') && <div className="row"><Link className="btn pri" href="/sales-invoices/new">New invoice</Link><Link className="btn" href="/receipts/new">Record a receipt</Link></div>}</div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/sales-invoices?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {shown.length === 0 ? <div className="empty card">Nothing here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Customer</th><th className="hide-sm">Project</th><th>Status</th><th className="num">Total (EGP)</th><th className="num hide-sm">Received</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}><td className="mono"><Link href={`/sales-invoices/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td>
              <td dir="auto">{r.customer}</td><td className="hide-sm">{r.project ?? '—'}</td>
              <td><span className={'pill ' + cls(r)}>{stateOf(r)}</span></td>
              <td className="num">{fmt(r.total)}</td><td className="num hide-sm">{fmt(r.received)}</td></tr>))}
          </tbody></table></div>)}
    </>
  );
}
