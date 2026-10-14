import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { fmt } from '@/lib/money';
import { listExpenses, toReimburse } from '@/lib/expenses';

const STATE: Record<string, [string, string]> = { pending: ['Waiting for approval', 'pending'], rejected: ['Returned', 'rejected'], posted: ['Approved', 'posted'], cancelled: ['Cancelled', ''] };

/** Expenses (improvement 6): what each person spent from petty cash, the card or their own money, with the receipt. */
export default async function Expenses({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { status = '' } = await searchParams;
  const fin = hasRole(user, 'finance');
  const [list, owed] = await Promise.all([listExpenses(user, status), fin ? toReimburse() : []]);
  return (
    <>
      <div className="head"><div><h1>Expenses</h1><p>{fin ? 'Everyone\'s expenses with their receipts.' : 'What you spent for the company, with the receipt.'} Each goes to the head of the department, then Management, and posts when approved.</p></div>
        <Link className="btn pri" href="/expenses/new">New expense</Link></div>
      {fin && owed.length > 0 && <div className="msg">To reimburse: {owed.length} expense{owed.length === 1 ? '' : 's'} paid from people&apos;s own money, {fmt(owed.reduce((t, x) => t + x.amount, 0))} in all. Open each one to record the payment.</div>}
      <div className="tabs">{[['', 'All'], ['pending', 'Waiting'], ['rejected', 'Returned'], ['posted', 'Approved']].map(([k, l]) => <Link key={k} href={`/expenses${k ? `?status=${k}` : ''}`} className={status === k ? 'on' : ''}>{l}</Link>)}</div>
      {list.length === 0 ? <div className="empty card">No expenses here yet. Tap New expense and take a photo of the receipt.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>What for</th><th className="hide-sm">For</th>{fin && <th className="hide-sm">Who</th>}<th className="hide-sm">Paid from</th><th className="num">Amount</th><th>State</th></tr></thead>
          <tbody>{list.map(x => (
            <tr key={x.id}><td className="mono"><Link href={`/expenses/${x.id}`}>{x.no}</Link></td><td className="mono">{x.date}</td><td dir="auto">{x.description}</td>
              <td className="hide-sm">{x.project_code ?? x.dept_name}</td>{fin && <td className="hide-sm">{x.who}</td>}<td className="hide-sm">{x.paid_from_name}</td>
              <td className="num">{fmt(x.amount)}</td><td><span className={`pill ${STATE[x.status]?.[1] ?? ''}`}>{STATE[x.status]?.[0] ?? x.status}</span>{x.paid_from === 'own' && x.status === 'posted' ? <div className="muted" style={{ fontSize: 12 }}>{x.reimbursed_no ? 'reimbursed' : 'to reimburse'}</div> : null}</td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
