import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { listVariations, voState } from '@/lib/claims';

const pill = (s: string) => (s === 'approved' ? 'posted' : ['rejected', 'cancelled'].includes(s) ? 'rejected' : s === 'draft' ? '' : 'pending');

/** The variation orders register: priced changes sent to the client; the approved ones are part of the BOQ and the contract. */
export default async function Variations({ searchParams }: { searchParams: Promise<{ project?: string; ok?: string; error?: string }> }) {
  await requireUser();
  const { project, ok, error } = await searchParams;
  const rows = await listVariations({ project });
  return (
    <>
      <div className="head"><div><h1>Variation orders</h1><p>A change the client asks for is priced here and sent to the client. Once the client approves it, its lines join the project&apos;s BOQ as budget (the client claims certify against them) and the contract grows by its value.</p></div>
        <div className="row"><Link className="btn pri" href={`/variations/new${project ? `?project=${project}` : ''}`}>New variation order</Link><Link className="btn" href="/cost-control?tab=variations">Per project</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      {rows.length === 0 ? <div className="empty card">No variation order yet.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Project</th><th>Title</th><th className="hide-sm">Client ref.</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody>{rows.map(v => <tr key={v.id}><td className="mono"><Link href={`/variations/${v.id}`}>{v.no}</Link></td><td className="mono">{v.date}</td><td>{v.code}</td><td dir="auto">{v.title}</td><td className="hide-sm" dir="auto">{v.client_ref}</td>
            <td><span className={'pill ' + pill(v.status)}>{voState(v)}</span></td><td className="num mono">{fmt(v.total)}</td></tr>)}</tbody>
        </table></div>)}
    </>
  );
}
