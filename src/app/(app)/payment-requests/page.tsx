import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { canSign, getSteps } from '@/lib/documents';

const TABS = [['waiting', 'Waiting for me'], ['mine', 'Raised by me'], ['open', 'Approved, not paid'], ['all', 'All']] as const;

export default async function PaymentRequests({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab = 'all' } = await searchParams;
  const [rows, steps] = await Promise.all([
    sql<{ id: string; no: string; date: string; vendor: string; cc: string | null; status: string; net: number; created_by: string | null; signed: number; paid: number }[]>`
      select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, p.name vendor, coalesce(pr.code, d.name) cc, i.status, i.net, i.created_by,
        (select count(*)::int from invoice_approvals a where a.invoice_id = i.id) signed,
        coalesce((select sum(a.amount) from payment_allocations a join payments py on py.id = a.payment_id and py.status = 'posted' where a.invoice_id = i.id),0) paid
      from invoices i join parties p on p.id = i.party_id left join projects pr on pr.id = i.project_id left join departments d on d.id = i.dept_id
      where i.kind = 'purchase' order by i.date desc, i.no desc limit 500`,
    getSteps(),
  ]);
  const shown = rows.filter(r =>
    tab === 'waiting' ? r.status === 'pending' && canSign(user, steps[r.signed])
    : tab === 'mine' ? r.created_by === user.id
    : tab === 'open' ? r.status === 'posted' && r.net - r.paid > 0.004
    : true);
  const stateOf = (r: typeof rows[number]) =>
    r.status === 'pending' ? `Waiting for ${steps[r.signed]?.name ?? 'approval'}`
    : r.status === 'posted' ? (r.net - r.paid <= 0.004 ? 'Paid' : r.paid ? 'Part paid' : 'Approved') : r.status === 'rejected' ? 'Returned' : 'Draft';
  return (
    <>
      <div className="head"><div><h1>Payment requests</h1><p>إذن صرف · approval goes {steps.map(s => s.name).join(' → ')}</p></div>
        <div className="row"><Link className="btn pri" href="/payment-requests/new">New payment request</Link><Link className="btn" href="/payments/new">Pay a vendor</Link></div></div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/payment-requests?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
      {shown.length === 0 ? <div className="empty card">Nothing here.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Vendor</th><th className="hide-sm">Cost center</th><th>Status</th><th className="num">Net (EGP)</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}><td className="mono"><Link href={`/payment-requests/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td>
              <td dir="auto">{r.vendor}</td><td className="hide-sm">{r.cc ?? 'Per line'}</td>
              <td><span className={'pill ' + (r.status === 'rejected' ? 'rejected' : r.status === 'pending' ? 'pending' : r.status === 'posted' ? 'posted' : '')}>{stateOf(r)}</span></td>
              <td className="num">{fmt(r.net)}</td></tr>))}
          </tbody></table></div>)}
    </>
  );
}
