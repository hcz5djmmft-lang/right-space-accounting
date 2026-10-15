import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { KIND_LABEL, bankAccounts, bankActivity, bankSummary, cardFigures, reconcile, type BankAccount } from '@/lib/banks';
import { payCardAction, chargeAction, clearedAction, ignoreLineAction, importStatementAction, interestAction, matchAgainAction, recordLineAction, statementAction, unmatchLineAction } from './actions';
import { lastImport, statementCounts, statementLines } from '@/lib/statements';

/** The second line of an account's tile: what kind of account it is and the detail that tells it apart. */
function describe(a: BankAccount) {
  if (a.kind === 'card') { const c = cardFigures(a); return `Credit card · available of the ${fmt(a.credit_limit ?? 0)} limit · owed ${fmt(c.owed)}`; }
  if (a.kind === 'cash') return 'Office cash · petty cash is paid from here';
  return `Bank account${a.branch ? ` · ${a.branch}` : ''}${a.account_no ? ` · ···${a.account_no.slice(-4)}` : ''}`;
}

export type BanksParams = Promise<{ account?: string; from?: string; to?: string; error?: string; ok?: string }>;

/**
 * Banks & cash (mode 'cash'): balances, account details, the card, charges and interest, and the activity of each account.
 * Closing > Bank reconciliation (mode 'rec', update 20): the CIB account and the card against their statements: import,
 * tick the lines on the statement, and the balance not yet reconciled.
 */
export async function BanksView({ searchParams, mode }: { searchParams: BanksParams; mode: 'cash' | 'rec' }) {
  await requireUser('finance');
  const { account, from = '', to = '', error, ok } = await searchParams;
  const rec_ = mode === 'rec', base = rec_ ? '/bank-reconciliation' : '/banks';
  const accounts = (await bankAccounts()).filter(a => !a.hidden && (!rec_ || a.kind !== 'cash'));   // the accountant's box (A115) stays in the books, off this page
  const cur = accounts.find(a => a.code === account) ?? accounts.find(a => a.kind === 'bank') ?? accounts[0]; // the bank account first
  const [lines, sum] = cur ? await Promise.all([bankActivity(cur.code, from, to), bankSummary(cur.code, from, to)]) : [[], null];
  const rec = cur ? reconcile(cur) : null;
  const [stLines, stCounts, stLast] = cur && cur.kind !== 'cash' ? await Promise.all([statementLines(cur.code, { from, to }), statementCounts(cur.code), lastImport(cur.code)]) : [[], null, null];
  const openLines = stLines.filter(l => l.status === 'open'), doneLines = stLines.filter(l => l.status !== 'open');
  let run = 0;
  const q = (code: string) => `${base}?account=${code}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  const period = from || to ? `${from || 'start'} to ${to || 'today'}` : 'all dates';
  const hidden = cur && <><input type="hidden" name="page" value={mode} /><input type="hidden" name="account" value={cur.code} /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /></>;
  return (
    <>
      {rec_
        ? <div className="head"><div><h1>Bank reconciliation</h1><p>The CIB account and the credit card against their statements: import the statement or tick each book line that is on it. What is not yet ticked is the balance still to reconcile.</p></div></div>
        : <div className="head"><div><h1>Banks &amp; cash</h1><p>The cash flow of the office cash, the CIB current account and the credit card: balances and activity. Money moves through payment requests, collections and petty cash, never typed here. Statements are reconciled in <Link href="/bank-reconciliation">Closing &gt; Bank reconciliation</Link>.</p></div></div>}
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {accounts.length === 0 && <div className="empty card">No bank or cash accounts. Tick &quot;Bank or cash account&quot; on an account in the chart of accounts.</div>}
      <div className="tiles">{accounts.map(a => (
        <Link key={a.code} href={q(a.code)} className="tile" style={{ textDecoration: 'none', outline: cur?.code === a.code ? '2px solid var(--gold-ink, #e5b35a)' : undefined }}>
          <div className="k"><span className="mono">{a.code}</span> · {a.name}</div><div className="v mono">{fmt(a.kind === 'card' ? cardFigures(a).available ?? a.credit_limit ?? 0 : a.balance)}</div>
          <div className="muted" style={{ fontSize: 12 }}>{describe(a)}</div>
          {a.stmt_balance !== null && <div className="muted" style={{ fontSize: 12 }}>{reconcile(a).reconciled ? '✓ reconciled' : `statement ${fmt(a.stmt_balance)}`}{a.stmt_date ? ` · ${a.stmt_date}` : ''}</div>}
        </Link>))}</div>

      {cur && rec_ && rec && (
        <div className="tiles">
          <div className="tile"><div className="k">Balance in books</div><div className="v mono">{fmt(cur.balance)}</div></div>
          <div className="tile"><div className="k">Ticked as on the statement</div><div className="v mono">{fmt(cur.cleared)}</div></div>
          <div className="tile" style={rec.uncleared ? { borderColor: 'var(--gold-ink, #e5b35a)' } : undefined}><div className="k">Not yet reconciled</div><div className="v mono">{fmt(rec.uncleared)}</div></div>
          <div className="tile" style={rec.difference !== null && !rec.reconciled ? { borderColor: 'var(--bad)' } : undefined}><div className="k">Difference to statement</div>
            <div className="v mono">{rec.difference === null ? '—' : rec.reconciled ? '✓ 0.00' : fmt(rec.difference)}</div></div>
        </div>)}

      {cur && !rec_ && (
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
            {cur.kind === 'card' && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Card purchases are paid from an approved payment request, paid by the credit card (CC-12-…).</p>}
            {cur.kind === 'card' && (
              <form action={payCardAction} className="row" style={{ alignItems: 'end', flexWrap: 'wrap', marginTop: 10 }}>
                {hidden}
                <label className="f"><span>Pay the card from</span><select className="inp" name="bank">{accounts.filter(a => a.kind === 'bank').map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
                <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
                <label className="f"><span>Amount (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" defaultValue={cardFigures(cur).owed > 0 ? cardFigures(cur).owed.toFixed(2) : ''} required /></label>
                <button className="btn pri">Pay the card</button>
              </form>)}
            {cur.kind === 'cash' && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Spent only through Petty cash; topped up from Petty cash &gt; Ask for a top-up.</p>}
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

      {cur && sum && rec_ && (
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

      {cur && rec && rec_ && (
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

      {cur && stCounts && rec_ && (
        <div className="card" id="statement-import">
          <h2>Import the {cur.kind === 'card' ? 'card' : 'bank'} statement</h2>
          <form action={importStatementAction} className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            {hidden}
            <label className="f"><span>Statement file (Excel .xlsx or CSV, as downloaded from CIB online)</span><input className="inp" type="file" name="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
            {cur.kind === 'card' && <label className="f"><span>On this file, purchases are</span><select className="inp" name="sign" defaultValue="charges-positive"><option value="charges-positive">Plain amounts (payments marked CR or minus)</option><option value="charges-negative">Minus or in a Debit column</option></select></label>}
            <button className="btn pri">Import statement</button>
            {stCounts.open > 0 && <button className="btn" formAction={matchAgainAction} formNoValidate>Match again</button>}
          </form>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Each line is matched to the book line of the same amount within 7 days and ticked as on the statement; the last balance on the file becomes the statement balance. A statement imported twice adds nothing.
            {stLast ? ` Last import ${stLast.at}${stLast.who ? ` by ${stLast.who}` : ''}: ${stLast.file_name} (${stLast.lines} new lines).` : ''} Matched {stCounts.matched} · open {stCounts.open} · set aside {stCounts.ignored}.</p>
          {openLines.length > 0 && <>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>Statement lines with no book entry ({openLines.length})</h3>
            <div className="tw"><table>
              <thead><tr><th>Date</th><th>Description</th><th className="num">In</th><th className="num">Out</th><th></th></tr></thead>
              <tbody>{openLines.map(l => (
                <tr key={l.id}><td className="mono">{l.date}</td><td dir="auto">{l.description}{l.ref ? <span className="muted mono"> · {l.ref}</span> : ''}</td>
                  <td className="num">{l.amount > 0 ? fmt(l.amount) : ''}</td><td className="num">{l.amount < 0 ? fmt(-l.amount) : ''}</td>
                  <td><form className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>{hidden}
                    {cur.kind === 'bank' && <button className="btn sm" formAction={recordLineAction.bind(null, l.id)}>{l.amount < 0 ? 'Record as bank charges' : 'Record as interest'}</button>}
                    <button className="btn sm" formAction={ignoreLineAction.bind(null, l.id, true)}>Set aside</button></form></td></tr>))}</tbody>
            </table></div>
            <p className="muted" style={{ fontSize: 12 }}>After the payment or receipt is recorded where it belongs (payment request, Money received, petty cash), press Match again.</p>
          </>}
          {doneLines.length > 0 && <details style={{ marginTop: 8 }}><summary>Matched and set-aside lines ({doneLines.length})</summary>
            <div className="tw"><table>
              <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Book entry</th><th></th></tr></thead>
              <tbody>{doneLines.map(l => (
                <tr key={l.id}><td className="mono">{l.date}</td><td dir="auto">{l.description}</td><td className="num">{fmt(l.amount)}</td>
                  <td className="mono">{l.entry_id ? <Link href={`/entries/${l.entry_id}`}>{l.entry_no}</Link> : <span className="muted">set aside</span>}{l.entry_date && l.entry_date !== l.date ? <span className="muted"> · {l.entry_date}</span> : ''}</td>
                  <td><form>{hidden}{l.status === 'matched' ? <button className="btn sm" formAction={unmatchLineAction.bind(null, l.id)}>Undo match</button> : <button className="btn sm" formAction={ignoreLineAction.bind(null, l.id, false)}>Bring back</button>}</form></td></tr>))}</tbody>
            </table></div></details>}
        </div>)}

      {cur && (
        <form action={clearedAction}>
          {hidden}
          <input type="hidden" name="shown" value={lines.map(l => l.line_id).join(',')} />
          {rec_ && lines.length > 0 && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}><button className="btn pri">Save cleared lines</button></div>}
          {lines.length === 0 ? <div className="empty card">No posted activity on this account{from || to ? ' in this period' : ' yet'}.</div> : (
            <div className="tw"><table>
              <thead><tr>{rec_ && <th>On statement</th>}<th>Date</th><th>Entry</th><th className="hide-sm">Ref</th><th>Description</th><th className="hide-sm">Party / cost center</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr></thead>
              <tbody>{lines.map(l => { run += l.dr - l.cr; return (
                <tr key={l.line_id}>{rec_ ? <td><input type="checkbox" name={'line_' + l.line_id} defaultChecked={l.cleared} aria-label="Cleared" /></td> : null}
                  <td className="mono">{l.date}</td><td className="mono"><Link href={`/entries/${l.entry_id}`}>{l.no}</Link></td><td className="mono hide-sm">{l.ref ?? ''}</td><td dir="auto">{l.description || l.memo}</td>
                  <td className="hide-sm">{[l.party, l.cc].filter(Boolean).join(' · ')}</td>
                  <td className="num">{l.dr ? fmt(l.dr) : ''}</td><td className="num">{l.cr ? fmt(l.cr) : ''}</td><td className="num">{fmt(run)}</td></tr>); })}</tbody>
            </table></div>)}
        </form>)}
    </>
  );
}
