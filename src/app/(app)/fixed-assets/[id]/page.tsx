import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { sql } from '@/lib/db';
import { listAssets } from '@/lib/assets';
import { stopAssetAction } from '../actions';

/** One fixed asset: its figures and the depreciation posted on it. */
export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireUser('finance');
  const { id } = await params;
  const q = await searchParams;
  const [a] = await listAssets(id);
  if (!a) notFound();
  const lines = await sql<{ period: string; amount: number; entry_id: string; no: string }[]>`
    select l.period, l.amount::float amount, r.entry_id, e.no from depreciation_lines l join depreciation_runs r on r.period = l.period join journal_entries e on e.id = r.entry_id
    where l.asset_id = ${id} order by l.period`;
  let run = 0;
  const left = Math.max(0, Math.ceil((a.cost - a.salvage - a.depreciated) / (a.monthly || 1)));
  return (
    <>
      <div className="head"><div><h1 dir="auto">{a.no} · {a.name}</h1><p>{a.category || 'Fixed asset'} · {a.cc} · in service from {a.in_service}</p></div><Link className="btn" href="/fixed-assets">Fixed assets</Link></div>
      {q.ok && <div className="msg good">{q.ok}</div>}
      {q.error && <div className="msg bad">{q.error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Cost</div><div className="v mono">{fmt(a.cost)}</div></div>
        <div className="tile"><div className="k">Per month ({a.life_months} months{a.salvage ? `, salvage ${fmt(a.salvage)}` : ''})</div><div className="v mono">{fmt(a.monthly)}</div></div>
        <div className="tile"><div className="k">Depreciated</div><div className="v mono">{fmt(a.depreciated)}</div></div>
        <div className="tile"><div className="k">Book value</div><div className="v mono">{fmt(a.book_value)}</div></div>
      </div>
      <div className="card">
        <p style={{ marginTop: 0 }}>GL code {a.asset_account}{a.purchase_no ? <> · bought in <Link href={`/entries/${a.purchase_entry_id}`}>{a.purchase_no}</Link></> : ' · purchase already in the books'}{a.notes ? ` · ${a.notes}` : ''}</p>
        {a.stopped_on ? <p><span className="pill rejected">Stopped</span> on {a.stopped_on}: {a.stop_note}</p> : <p className="muted">{left} months of depreciation left.</p>}
        {lines.length === 0 ? <p className="muted">No depreciation posted yet.</p> : (
          <div className="tw"><table><thead><tr><th>Month</th><th>Entry</th><th className="num">Depreciation</th><th className="num">Book value</th></tr></thead>
            <tbody>{lines.map(l => { run += l.amount; return <tr key={l.period}><td className="mono">{l.period}</td><td><Link href={`/entries/${l.entry_id}`}>{l.no}</Link></td><td className="num">{fmt(l.amount)}</td><td className="num">{fmt(a.cost - run)}</td></tr>; })}</tbody></table></div>)}
      </div>
      {!a.stopped_on && (
        <form action={stopAssetAction.bind(null, a.id)} className="card grid g3" style={{ alignItems: 'end' }}>
          <label className="f"><span>Sold or written off on</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
          <label className="f"><span>What happened</span><input className="inp" name="note" dir="auto" placeholder="Sold to …, stolen, broken" /></label>
          <button className="btn bad">Stop depreciating</button>
          <p className="muted" style={{ fontSize: 13, gridColumn: '1 / -1', margin: 0 }}>This only stops the depreciation; the sale or write-off itself is posted by Finance in the books.</p>
        </form>)}
    </>
  );
}
