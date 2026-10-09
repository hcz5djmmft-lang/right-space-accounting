import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';

export default async function Approvals() {
  await requireUser();
  const rows = await sql<{ id: string; no: string; date: string; memo: string; who: string | null; total: number }[]>`
    select e.id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, u.name who, coalesce(sum(l.dr),0) total
    from journal_entries e left join journal_lines l on l.entry_id = e.id left join users u on u.id = e.created_by
    where e.status = 'pending' group by e.id, u.name order by e.date`;
  return (
    <>
      <div className="head"><div><h1>Approvals</h1><p>Entries submitted for approval. Payment requests join this list in the next step of the build.</p></div></div>
      {rows.length === 0 ? <div className="empty card">Nothing is waiting for approval.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Description</th><th>Submitted by</th><th className="num">Amount</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td className="mono"><Link href={`/entries/${r.id}`}>{r.no}</Link></td><td className="mono">{r.date}</td><td dir="auto">{r.memo}</td><td>{r.who}</td><td className="num">{fmt(r.total)}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
