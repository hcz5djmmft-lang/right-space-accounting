import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';

const KIND: Record<string, string> = {
  expense: 'Expense', collection: 'Collection', transfer: 'Transfer', adjustment: 'Adjustment', payment_request: 'Payment request',
  sales_invoice: 'Sales invoice', payment: 'Vendor payment', receipt: 'Receipt', payroll: 'Payroll', reversal: 'Reversal',
};
const STATUSES = ['all', 'draft', 'pending', 'posted', 'rejected'];

export default async function Entries({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireUser();
  const { status = 'all', q = '' } = await searchParams;
  const rows = await sql<{ id: string; no: string; date: string; memo: string; kind: string; status: string; total: number; reversed_by: string | null }[]>`
    select e.id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, e.kind, e.status, e.reversed_by, coalesce(sum(l.dr),0) total
    from journal_entries e left join journal_lines l on l.entry_id = e.id
    where (${status} = 'all' or e.status = ${status})
      and (${q} = '' or e.no ilike ${'%' + q + '%'} or e.memo ilike ${'%' + q + '%'} or e.ref ilike ${'%' + q + '%'})
    group by e.id order by e.date desc, e.no desc limit 500`;
  return (
    <>
      <div className="head">
        <div><h1>Entries</h1><p>Every expense, collection, transfer and posted document, newest first.</p></div>
        <div className="row">
          <Link className="btn pri" href="/entries/new?type=expense">Record expense</Link>
          <Link className="btn" href="/entries/new?type=collection">Collection</Link>
          <Link className="btn" href="/entries/new?type=transfer">Transfer</Link>
        </div>
      </div>
      <div className="tabs">
        {STATUSES.map(s => <Link key={s} href={`/entries?status=${s}`} className={s === status ? 'on' : ''}>{s[0].toUpperCase() + s.slice(1)}</Link>)}
      </div>
      <form className="row" style={{ marginBottom: 12 }}><input type="hidden" name="status" value={status} />
        <input className="inp" name="q" defaultValue={q} placeholder="Search number, description or reference" style={{ maxWidth: 360 }} />
        <button className="btn">Search</button></form>
      {rows.length === 0 ? <div className="empty card">No entries here yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Type</th><th>Description</th><th>Status</th><th className="num">Amount (EGP)</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td className="mono"><Link href={`/entries/${r.id}`}>{r.no}</Link></td>
              <td className="mono">{r.date}</td>
              <td>{KIND[r.kind] ?? r.kind}</td>
              <td dir="auto">{r.memo}{r.reversed_by ? <span className="muted"> · reversed</span> : null}</td>
              <td><span className={'pill ' + r.status}>{r.status}</span></td>
              <td className="num">{fmt(r.total)}</td>
            </tr>))}
          </tbody></table></div>)}
    </>
  );
}
