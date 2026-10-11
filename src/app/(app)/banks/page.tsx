import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { KIND_LABEL, bankAccounts, bankActivity, bankSummary, cardFigures, reconcile, type BankAccount } from '@/lib/banks';
import { chargeAction, clearedAction, interestAction, statementAction } from './actions';

/** The second line of an account's tile: what kind of account it is and the detail that tells it apart. */
function describe(a: BankAccount) {
  if (a.kind === 'card') { const c = cardFigures(a); return `Credit card · limit ${fmt(a.credit_limit ?? 0)}${c.available === null ? '' : ` · available ${fmt(c.available)}`}`; }
  if (a.kind === 'cash') return `Petty cash${a.holder ? ` · ${a.holder}` : ''}`;
  return `Bank account${a.branch ? ` · ${a.branch}` : ''}${a.account_no ? ` · ···${a.account_no.slice(-4)}` : ''}`;
}

export default async function Banks({ searchParams }: { searchParams: Promise<{ account?: string; from?: string; to?: string; error?: string; ok?: string }> }) {
  await requireUser('finance');
  const { account, from = '', to = '', error, ok } = await searchParams;
  const accounts = await bankAccounts();
  const cur = accounts.find(a => a.code === account) ?? accounts[0];
  const [lines, sum] = cur ? await Promise.all([bankActivity(cur.code, from, to), bankSummary(cur.code, from, to)]) : [[], null];
  const rec = cur ? reconcile(cur) : null;
  let run = 0;
  const q = (code: string) => `/banks?account=${code}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  const period = from || to ? `${from || 'start'} to ${to || 'today'}` : 'all dates';
  const hidden = cur && <><input type="hidden" name="account" value={cur.code} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /></>;
  return (
    <>
      <div className="head"><div><h1>Banks &amp; cash</h1><p>The bank account, the credit card and petty cash: balances, activity and reconciliation. Every payment out of them gets its own reference number.</p></div>
        <div className="row"><Link className="btn" href="/entries/new?type=collection">Record collection</Link><Link className="btn" href="/entries/new?type=expense">Record expense</Link><Link className="btn" href="/entries/new?type=transfer">Transfer</Link></div></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {accounts.length === 0 && <div className="empty card">No bank or cash accounts. Tick &quot;Bank or cash account&quot; on an account in the chart of accounts.</div>}
      <div className="tiles">{accounts.map(a => (
        <Link key={a.code} href={q(a.code)} className="tile" style={{ textDecoration: 'none', outline: cur?.code === a.code ? '2px solid var(--gold-ink, #e5b35a)' : undefined }}>
          <div className="k"><span className="mono">{a.code}</span> · {a.name}</div><div className="v mono">{fmt(a.kind === 'card' ? cardFigures(a).owed : a.balance)}</div>
          <div className="muted" style={{ fontSize: 12 }}>{describe(a)}</div>
          {a.stmt_balance !== null && <div className="muted" style={{ fontSize: 12 }}>{reconcile(a).reconciled ? '✓ reconciled' : `statement ${fmt(a.stmt_balance)}`}{a.stmt_date ? ` · ${a.stmt_date}` : ''}</div>}
        </Link>))}</div>

      {cur && (
        <div className="grid g2">
          <div className="card">
            <h2>{KIND_LABEL[cur.kind]} · {cur.code}</h2>
            <table><tbody>
              {cur.bank_name && <tr><td>Bank</td><td>{cur.bank_name}{cur.branch ? `, ${cur.branch}` : ''}</td></tr>}
              {cur.account_no && <tr><td>{cur.kind === 'card' ? 'Card' : 'Account no.'}</td><td className="mono" style={{ wordBreak: 'break-all' }}>{cur.account_no}</td></tr>}
              {cur.iban && <tr><td>IBAN</td><td className="mono" style={{ wordBreak: 'break-all' }}>{cur.iban}</td></tr>}
              {cur.swift && <tr><td>SWIFT</td><td className="mono">{cur.swift}</td></tr>}
              {cur.kind === 'card' && <><tr><td>Limit</td><td className="num">{fmt(cur.credit_limit ?? 0)}</td></tr><tr><td>Owed</td><td className="num">{fmt(cardFigures(cur).owed)}</td></tr>
                <tr><td>Available</td><td className="num">{cardFigures(cur).available === null ? '—' : fmt(cardFigures(cur).available!)}</td></tr></>}
              {cur.holder && <tr><td>{cur.kind === 'bank' ? 'Account name' : 'Held by'}</td><td>{cur.holder}</td></tr>}
              <tr><td>Payments numbered</td><td className="mono">{cur.ref_prefix ? cur.ref_prefix + '00001, ' + cur.ref_prefix + '00002 …' : '—'}</td></tr>
            </tbody></table>
            {cur.kind === 'card' && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Pay with the card from Record expense (paid from {cur.code}); settle it with a Transfer from the bank to {cur.code}.</p>}
            {cur.kind === 'cash' && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Top it up with a Transfer from the bank; spend it from Record expense (paid from {cur.code}).</p>}
          </div>
          {cur.kind === 'bank' && (
            <div className="card">
              <h2>Bank charges and interest</h2>
              <form action={chargeAction} className="row" style={{ alignItems: 'end', flexWrap: 'wrap', marginBottom: 10 }}>
                {hidden}
                <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
                <label className="f"><span>Charges (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" required /></label>
                <label className="f" style={{ flex: 1, minWidth: 140 }}><span>Description</span><input className="inp" name="memo" placeholder="Bank charges" /></label>
                <button className="btn">Record charges</button>
              </form>
              <form action={interestAction} className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
                {hidden}
                <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
                <label className="f"><span>Interest (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" required /></label>
                <label className="f" style={{ flex: 1, minWidth: 140 }}><span>Description</span><input className="inp" name="memo" placeholder="Bank interest" /></label>
                <button className="btn">Record interest</button>
              </form>
              <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Charges go to the bank-charges code under Finance; interest to Bank interest. Both bring the books level with the statement.</p>
            </div>)}
        </div>)}

      {cur && (
        <form className="row card" style={{ alignItems: 'end' }}>
          <input type="hidden" name="account" value={cur.code} />
          <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
          <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
          <button className="btn">Show</button>
        </form>)}

      {cur && sum && (
        <div className="card">
          <h2>Reconciliation summary · {period}</h2>
          <div className="grid g2">
            <table><thead><tr><th>Credited (money out)</th><th className="num">EGP</th></tr></thead>
              <tbody>{sum.out.map(g => <tr key={g.group}><td>{g.group} <span className="muted">({g.count})</span></td><td className="num">{fmt(g.total)}</td></tr>)}
                {sum.out.length === 0 && <tr><td colSpan={2} className="muted">Nothing went out.</td></tr>}</tbody>
              <tfoot><tr><td>Total out</td><td className="num">{fmt(sum.totalOut)}</td></tr></tfoot></table>
            <table><thead><tr><th>Debited (money in)</th><th className="num">EGP</th></tr></thead>
              <tbody>{sum.in.map(g => <tr key={g.group}><td>{g.group} <span className="muted">({g.count})</span></td><td className="num">{fmt(g.total)}</td></tr>)}
                {sum.in.length === 0 && <tr><td colSpan={2} className="muted">Nothing came in.</td></tr>}</tbody>
              <tfoot><tr><td>Total in</td><td className="num">{fmt(sum.totalIn)}</td></tr></tfoot></table>
          </div>
          <div className="tiles" style={{ marginTop: 12 }}>
            <div className="tile"><div className="k">Opening balance in books</div><div className="v mono">{fmt(sum.opening)}</div></div>
            <div className="tile"><div className="k">Closing balance in books</div><div className="v mono">{fmt(sum.closing)}</div></div>
            <div className="tile"><div className="k">Statement ending balance</div><div className="v mono">{cur.stmt_balance === null ? '—' : fmt(cur.stmt_balance)}</div></div>
            <div className="tile" style={rec && rec.difference !== null && !rec.reconciled ? { borderColor: 'var(--bad)' } : undefined}><div className="k">Difference to statement</div>
              <div className="v mono">{!rec || rec.difference === null ? '—' : rec.reconciled ? '✓ 0.00' : fmt(rec.difference)}</div></div>
          </div>
        </div>)}

      {cur && rec && (
        <div className="card">
          <h2>Statement of {cur.code} · {cur.name}</h2>
          <form action={statementAction} className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            {hidden}
            <label className="f"><span>Statement date</span><input className="inp" type="date" name="date" defaultValue={cur.stmt_date ?? ''} /></label>
            <label className="f"><span>Statement ending balance</span><input className="inp mono" name="balance" inputMode="decimal" defaultValue={cur.stmt_balance ?? ''} /></label>
            <button className="btn">Save statement</button>
          </form>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>Balance in books {fmt(cur.balance)} · cleared {fmt(cur.cleared)} · not yet on a statement {fmt(rec.uncleared)}.
            Tick each line that appears on the bank statement and save; when the difference is zero, the account is reconciled.</p>
        </div>)}

      {cur && (
        <form action={clearedAction}>
          {hidden}
          <input type="hidden" name="shown" value={lines.map(l => l.line_id).join(',')} />
          {lines.length > 0 && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}><button className="btn pri">Save cleared lines</button></div>}
          {lines.length === 0 ? <div className="empty card">No posted activity on this account{from || to ? ' in this period' : ' yet'}.</div> : (
            <div className="tw"><table>
              <thead><tr><th>On statement</th><th>Date</th><th>Entry</th><th className="hide-sm">Ref</th><th>Description</th><th className="hide-sm">Party / cost center</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr></thead>
              <tbody>{lines.map(l => { run += l.dr - l.cr; return (
                <tr key={l.line_id}><td><input type="checkbox" name={'line_' + l.line_id} defaultChecked={l.cleared} aria-label="Cleared" /></td>
                  <td className="mono">{l.date}</td><td className="mono"><Link href={`/entries/${l.entry_id}`}>{l.no}</Link></td><td className="mono hide-sm">{l.ref ?? ''}</td><td dir="auto">{l.description || l.memo}</td>
                  <td className="hide-sm">{[l.party, l.cc].filter(Boolean).join(' · ')}</td>
                  <td className="num">{l.dr ? fmt(l.dr) : ''}</td><td className="num">{l.cr ? fmt(l.cr) : ''}</td><td className="num">{fmt(run)}</td></tr>); })}</tbody>
            </table></div>)}
        </form>)}
    </>
  );
}
