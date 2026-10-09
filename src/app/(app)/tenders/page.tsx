import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { listTenders } from '@/lib/tenders';
import { createTenderAction } from './actions';

export default async function Tenders({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser('tenders');
  const { error } = await searchParams;
  const [list, customers] = await Promise.all([listTenders(), sql<{ id: string; name: string }[]>`select id, name from parties where type = 'customer' order by name`]);
  return (
    <>
      <div className="head"><div><h1>Tenders</h1><p>Build the BOQ, compare subcontractor offers trade by trade, award, then price the tender for the client.</p></div></div>
      {error && <div className="msg bad">{error}</div>}
      <form action={createTenderAction} className="card grid g4" style={{ alignItems: 'end' }}>
        <label className="f"><span>Tender / project name</span><input className="inp" name="name" dir="auto" placeholder="e.g. Villa fit-out, Marassi" required /></label>
        <label className="f"><span>Client</span><select className="inp" name="client_id"><option value="">—</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="f"><span>Client name (if not a customer yet)</span><input className="inp" name="client_name" dir="auto" /></label>
        <div className="row"><label className="f" style={{ flex: 1 }}><span>Submission date</span><input className="inp" type="date" name="due_date" /></label><button className="btn pri">New tender</button></div>
      </form>
      {list.length === 0 ? <div className="empty card">No tenders yet. Start with New tender: details, then BOQ, bidders and prices, comparison and the client price.</div> : (
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Tender</th><th className="hide-sm">Client</th><th className="hide-sm">Submission</th><th>Status</th><th className="num hide-sm">Trades</th><th className="num">Cost (selected)</th><th className="num">Client price</th><th className="num hide-sm">Margin</th></tr></thead>
          <tbody>{list.map(t => (
            <tr key={t.id}><td className="mono"><Link href={`/tenders/${t.id}`}>{t.no}</Link></td><td dir="auto">{t.name}{t.location && <div className="muted" style={{ fontSize: 11 }}>{t.location}</div>}</td>
              <td className="hide-sm" dir="auto">{t.client ?? ''}</td><td className="mono hide-sm">{t.due_date ?? ''}</td><td><span className={'pill ' + (t.status === 'Won' ? 'posted' : t.status === 'Lost' ? 'rejected' : t.status === 'Draft' ? '' : 'pending')}>{t.status}</span></td>
              <td className="num hide-sm">{t.totals.trades}</td><td className="num">{fmt(t.totals.cost)}</td><td className="num">{fmt(t.totals.client)}</td>
              <td className="num hide-sm">{t.totals.client ? Math.round((t.totals.client - t.totals.cost) / t.totals.client * 100) + '%' : ''}</td></tr>))}
          </tbody></table></div>)}
    </>
  );
}
