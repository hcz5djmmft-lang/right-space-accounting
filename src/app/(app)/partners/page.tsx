import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { hasRole } from '@/lib/roles';
import { getSettings } from '@/lib/books';
import { listPartners, partnerStatement, profitFor, profitShares } from '@/lib/partners';
import { depositAction, shareAction, withdrawalAction } from './actions';

const ACTION_LABEL: Record<string, string> = { deposit: 'Money put in', withdrawal: 'Withdrawal', profit: 'Profit share' };
const nextDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

/** The partners: each one's share, what they put in and took out, their share of the profit and their current account. */
export default async function Partners({ searchParams }: { searchParams: Promise<{ partner?: string; error?: string; ok?: string }> }) {
  const user = await requireUser('finance');
  const { partner = '', error, ok } = await searchParams;
  const now = today();
  const s = await getSettings();
  const m = s.fy_start_month || 1, y = Number(now.slice(0, 4)) - (Number(now.slice(5, 7)) < m ? 1 : 0);
  const yearStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const [partners, shares, banks, ytd, capital] = await Promise.all([
    listPartners(), profitShares(),
    sql<{ code: string; name: string }[]>`select code, name from accounts where is_bank and postable order by code`,
    profitFor(yearStart, now),
    sql<{ balance: number }[]>`select coalesce(sum(l.cr - l.dr), 0) balance from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' where l.account = 'Q110'`,
  ]);
  const last = shares.find(x => !x.reversed);
  const shareFrom = last ? nextDay(last.date_to) : yearStart;
  const cur = partners.find(p => p.id === partner);
  const lines = cur ? await partnerStatement(cur.account) : [];
  const sum = (k: 'deposits' | 'withdrawals' | 'profit' | 'balance') => partners.reduce((t, p) => t + p[k], 0);
  const bankDefault = banks.find(b => b.code === 'A120')?.code ?? banks[0]?.code;
  const partnerSelect = <select className="inp" name="partner" defaultValue={partner} required><option value="">Select…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>;
  const bankSelect = <select className="inp" name="bank" defaultValue={bankDefault}>{banks.map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</select>;
  let run = 0;
  return (
    <>
      <div className="head"><div><h1>Partners</h1><p>The four partners and their current accounts: the money each one puts in (self-financing), what they take out, and their share of the profit.</p></div></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}

      <div className="tiles">{partners.map(p => (
        <Link key={p.id} href={`/partners?partner=${p.id}`} className="tile" style={{ textDecoration: 'none', outline: cur?.id === p.id ? '2px solid var(--gold-ink, #e5b35a)' : undefined }}>
          <div className="k">{p.name} · {Number(p.share)}%</div><div className="v mono">{fmt(p.balance)}</div>
          <div className="muted" style={{ fontSize: 12 }}>Invested {fmt(p.deposits - p.withdrawals)} · profit {fmt(p.profit)}</div>
        </Link>))}</div>

      <div className="card">
        <h2>Current accounts</h2>
        <div className="tw"><table>
          <thead><tr><th>Partner</th><th className="num">Share</th><th className="num">Money put in</th><th className="num">Withdrawn</th><th className="num hide-sm">Invested</th><th className="num">Profit shared</th><th className="num">Balance</th></tr></thead>
          <tbody>{partners.map(p => (
            <tr key={p.id}><td><Link href={`/partners?partner=${p.id}`}>{p.name}</Link> <span className="muted mono">{p.account}</span></td><td className="num">{Number(p.share)}%</td>
              <td className="num">{fmt(p.deposits)}</td><td className="num">{fmt(p.withdrawals)}</td><td className="num hide-sm">{fmt(p.deposits - p.withdrawals)}</td>
              <td className="num">{fmt(p.profit)}</td><td className="num">{fmt(p.balance)}</td></tr>))}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{partners.reduce((t, p) => t + Number(p.share), 0)}%</td><td className="num">{fmt(sum('deposits'))}</td><td className="num">{fmt(sum('withdrawals'))}</td>
            <td className="num hide-sm">{fmt(sum('deposits') - sum('withdrawals'))}</td><td className="num">{fmt(sum('profit'))}</td><td className="num">{fmt(sum('balance'))}</td></tr></tfoot>
        </table></div>
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Balance is what the company owes each partner. Profit this year so far ({yearStart} to {now}): {fmt(ytd.profit)}, of which each 25% is {fmt(ytd.profit / 4)}.
          {capital[0]?.balance ? ` Partners' capital & funding (Q110, not split by partner): ${fmt(capital[0].balance)}.` : ''}</p>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Money put in</h2>
          <form action={depositAction} className="grid g2">
            <label className="f"><span>Partner</span>{partnerSelect}</label>
            <label className="f"><span>Into</span>{bankSelect}</label>
            <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={now} /></label>
            <label className="f"><span>Amount (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" required /></label>
            <label className="f" style={{ gridColumn: '1 / -1' }}><span>Description</span><input className="inp" name="memo" dir="auto" placeholder="Self-financing deposit" /></label>
            <div><button className="btn pri">Record money put in</button></div>
          </form>
        </div>
        <div className="card">
          <h2>Withdrawal</h2>
          <form action={withdrawalAction} className="grid g2">
            <label className="f"><span>Partner</span>{partnerSelect}</label>
            <label className="f"><span>Paid from</span>{bankSelect}</label>
            <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={now} /></label>
            <label className="f"><span>Amount (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" required /></label>
            <label className="f" style={{ gridColumn: '1 / -1' }}><span>Description</span><input className="inp" name="memo" dir="auto" placeholder="Withdrawal" /></label>
            <div><button className="btn">Record withdrawal</button></div>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>Share out profit</h2>
        {hasRole(user, 'management') ? (
          <form action={shareAction} className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="f"><span>Profit from</span><input className="inp" type="date" name="from" defaultValue={shareFrom} /></label>
            <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={now} /></label>
            <label className="f"><span>Entry date</span><input className="inp" type="date" name="date" defaultValue={now} /></label>
            <button className="btn">Share out profit</button>
          </form>) : <p className="muted">Management shares out the profit.</p>}
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Takes revenue less expenses for the period from retained earnings to each partner&apos;s current account by share (a loss the other way). The same days cannot be shared twice; reverse the entry to redo it.</p>
        {shares.length > 0 && (
          <div className="tw" style={{ marginTop: 10 }}><table>
            <thead><tr><th>Period</th><th>Entry</th><th className="num">Profit</th><th></th></tr></thead>
            <tbody>{shares.map(x => <tr key={x.id}><td className="mono">{x.date_from} to {x.date_to}</td><td className="mono"><Link href={`/entries/${x.entry_id}`}>{x.entry_no}</Link></td>
              <td className="num">{fmt(x.profit)}</td><td className="muted">{x.reversed ? 'reversed' : ''}</td></tr>)}</tbody>
          </table></div>)}
      </div>

      {cur && (
        <div className="card">
          <h2>Current account of {cur.name} · {cur.account}</h2>
          {lines.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
            <div className="tw"><table>
              <thead><tr><th>Date</th><th>Entry</th><th className="hide-sm">Ref</th><th>What</th><th className="hide-sm">Description</th><th className="num">Out</th><th className="num">In</th><th className="num">Balance</th></tr></thead>
              <tbody>{lines.map((l, i) => { run += l.cr - l.dr; return (
                <tr key={i}><td className="mono">{l.date}</td><td className="mono"><Link href={`/entries/${l.entry_id}`}>{l.no}</Link></td><td className="mono hide-sm">{l.payment_ref ?? ''}</td>
                  <td>{(l.action && ACTION_LABEL[l.action]) || 'Other'}</td><td className="hide-sm" dir="auto">{l.memo}</td>
                  <td className="num">{l.dr ? fmt(l.dr) : ''}</td><td className="num">{l.cr ? fmt(l.cr) : ''}</td><td className="num">{fmt(run)}</td></tr>); })}</tbody>
            </table></div>)}
        </div>)}
    </>
  );
}
