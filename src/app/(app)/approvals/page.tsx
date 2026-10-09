import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { waitingForUser } from '@/lib/documents';

export default async function Approvals() {
  const user = await requireUser();
  const rows = await waitingForUser(user);
  return (
    <>
      <div className="head"><div><h1>Approvals</h1><p>Everything waiting for your signature.</p></div></div>
      {rows.length === 0 ? <div className="empty card">Nothing is waiting for you.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Type</th><th>Date</th><th>Vendor / description</th><th className="hide-sm">Raised by</th><th className="num">Amount</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.href}><td className="mono"><Link href={r.href}>{r.no}</Link></td><td>{r.type}</td><td className="mono">{r.date}</td>
            <td dir="auto">{r.memo}</td><td className="hide-sm">{r.who}</td><td className="num">{fmt(r.amount)}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
