import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { bankAccounts, bankActivity, reconcile } from '@/lib/banks';
import { clearedAction, statementAction } from './actions';

export default async function Banks({ searchParams }: { searchParams: Promise<{ account?: string; from?: string; to?: string; error?: string; ok?: string }> }) {
  await requireUser('finance');
  const { account, from = '', to = '', error, ok } = await searchParams;
  const accounts = await bankAccounts();
  const cur = accounts.find(a => a.code === account) ?? accounts[0];
  const lines = cur ? await bankActivity(cur.code, from, to) : [];
  const rec = cur ? reconcile(cur) : null;
  let run = 0;
  const q = (code: string) => `/banks?account=${code}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  return (
    <>
      <div className="head"><div><h1>Banks &amp; cash</h1><p>Balances, account activity and reconciliation against the bank statement.</p></div>
        <div className="row"><Link className="btn" href="/entries/new?type=collection">Record collection</Link><Link className="btn" href="/entries/new?type=expense">Record expense</Link><Link className="btn" href="/entries/new?type=transfer">Transfer</Link></div></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {accounts.length === 0 && <div className="empty card">No bank or cash accounts. Tick "Bank or cash account" on an account in the chart of accounts.</div>}
      <div className="tiles">{accounts.map(a => (
        <Link key={a.code} href={q(a.code)} className="tile" style={{ textDecoration: 'none', outline: cur?.code === a.code ? '2px solid var(--gold-ink, #e5b35a)' : undefined }}>
          <div className="k"><span className="mono">{a.code}</span> · {a.name}</div><div className="v mono">{fmt(a.balance)}</div>
          {a.stmt_balance !== null && <div className="muted" style={{ fontSize: 12 }}>{reconcile(a).reconciled ? '✓ reconciled' : `statement ${fmt(a.stmt_balance)}`}{a.stmt_date ? ` · ${a.stmt_date}` : ''}</div>}
        </Link>))}</div>

      {cur && rec && (
        <div className="card">
          <h2>Reconcile {cur.code} · {cur.name}</h2>
          <form action={statementAction} className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <input type="hidden" name="account" value={cur.code} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
            <label className="f"><span>Statement date</span><input className="inp" type="date" name="date" defaultValue={cur.stmt_date ?? ''} /></label>
            <label className="f"><span>Statement ending balance</span><input className="inp mono" name="balance" inputMode="decimal" defaultValue={cur.stmt_balance ?? ''} /></label>
            <button className="btn">Save statement</button>
          </form>
          <div className="tiles" style={{ marginTop: 12 }}>
            <div className="tile"><div className="k">Balance in books</div><div className="v mono">{fmt(cur.balance)}</div></div>
            <div className="tile"><div className="k">Cleared in books</div><div className="v mono">{fmt(cur.cleared)}</div></div>
            <div className="tile"><div className="k">Not yet on a statement</div><div className="v mono">{fmt(rec.uncleared)}</div></div>
            <div className="tile" style={rec.difference !== null && !rec.reconciled ? { borderColor: 'var(--bad)' } : undefined}><div className="k">Difference to statement</div>
              <div className="v mono">{rec.difference === null ? '—' : rec.reconciled ? '✓ 0.00' : fmt(rec.difference)}</div></div>
          </div>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>Tick each line that appears on the bank statement and save. When the difference is zero, the account is reconciled.</p>
        </div>)}

      {cur && (
        <form className="row card" style={{ alignItems: 'end' }}>
          <input type="hidden" name="account" value={cur.code} />
          <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
          <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Show</button>
        </form>)}
      {cur && (
        <form action={clearedAction}>
          <input type="hidden" name="account" value={cur.code} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
          <input type="hidden" name="shown" value={lines.map(l => l.line_id).join(',')} />
          {lines.length > 0 && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}><button className="btn pri">Save cleared lines</button></div>}
          {lines.length === 0 ? <div className="empty card">No posted activity on this account{from || to ? ' in this period' : ' yet'}.</div> : (
            <div className="tw"><table>
              <thead><tr><th>On statement</th><th>Date</th><th>Entry</th><th>Description</th><th className="hide-sm">Party / cost center</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr></thead>
              <tbody>{lines.map(l => { run += l.dr - l.cr; return (
                <tr key={l.line_id}><td><input type="checkbox" name={'line_' + l.line_id} defaultChecked={l.cleared} aria-label="Cleared" /></td>
                  <td className="mono">{l.date}</td><td className="mono"><Link href={`/entries/${l.entry_id}`}>{l.no}</Link></td><td dir="auto">{l.description || l.memo}</td>
                  <td className="hide-sm">{[l.party, l.cc].filter(Boolean).join(' · ')}</td>
                  <td className="num">{l.dr ? fmt(l.dr) : ''}</td><td className="num">{l.cr ? fmt(l.cr) : ''}</td><td className="num">{fmt(run)}</td></tr>); })}</tbody>
            </table></div>)}
        </form>)}
    </>
  );
}
