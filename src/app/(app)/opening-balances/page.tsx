import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { getSettings } from '@/lib/books';
import { openingEntry, openingLines, openingRows } from '@/lib/opening';
import { saveOpeningAction, voidOpeningAction } from './actions';

const TYPE: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity' };

/** Opening balances (improvement 8): every balance-sheet account on the day the books start, posted as one entry. */
export default async function OpeningBalances({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireUser('finance');
  const { ok, error } = await searchParams;
  const [rows, entry, totals, s] = await Promise.all([openingRows(), openingEntry(), openingLines(), getSettings()]);
  const partners = rows.filter(r => r.partner), others = rows.filter(r => !r.partner);
  const locked = !!entry;
  const row = (r: (typeof rows)[number]) => (
    <tr key={r.code}><td dir="auto"><span className="mono">{r.code}</span> · {r.partner ? `${r.partner} (money put in)` : r.name}</td>
      <td className="num"><input className="inp mono" name={'dr_' + r.code} inputMode="decimal" defaultValue={r.dr || ''} disabled={locked} style={{ maxWidth: 150, textAlign: 'right' }} aria-label={`${r.code} debit`} /></td>
      <td className="num"><input className="inp mono" name={'cr_' + r.code} inputMode="decimal" defaultValue={r.cr || ''} disabled={locked} style={{ maxWidth: 150, textAlign: 'right' }} aria-label={`${r.code} credit`} /></td></tr>);
  return (
    <>
      <div className="head"><div><h1>Opening balances</h1><p>What each account held on {entry?.date ?? s.opening_date}, when the books start: the bank and petty cash, what clients and vendors owed, and the partners&apos; funding. Posted as one opening entry.</p></div>
        <Link className="btn" href="/reports/balance-sheet">Balance sheet</Link></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      {entry && <div className="card row" style={{ justifyContent: 'space-between' }}>
        <span>Posted as <Link href={`/entries/${entry.id}`}>{entry.no}</Link> on {entry.date}. To change a figure, void it, correct and post again.</span>
        <form action={voidOpeningAction} className="row"><input className="inp" name="reason" placeholder="Why (optional)" /><button className="btn bad">Void opening entry</button></form>
      </div>}
      <form action={saveOpeningAction}>
        <div className="tiles">
          <div className="tile"><div className="k">Debits</div><div className="v mono">{fmt(totals.dr)}</div></div>
          <div className="tile"><div className="k">Credits</div><div className="v mono">{fmt(totals.cr)}</div></div>
          <div className="tile"><div className="k">Difference to retained earnings{totals.retained ? ` (${totals.retained})` : ''}</div><div className="v mono">{fmt(totals.difference)}</div></div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Partners&apos; funding</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>The money each partner had put in by the opening date, as a credit on their current account. The bank account then shows the money it really held.</p>
          <div className="tw"><table><thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead><tbody>{partners.map(row)}</tbody></table></div>
        </div>
        {(['asset', 'liability', 'equity'] as const).map(t => (
          <div key={t} className="card">
            <h2 style={{ marginTop: 0 }}>{TYPE[t]}</h2>
            <div className="tw"><table><thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead><tbody>{others.filter(r => r.type === t).map(row)}</tbody></table></div>
          </div>))}
        {!locked && <div className="card row" style={{ position: 'sticky', bottom: 0, alignItems: 'end' }}>
          <label className="f"><span>Opening date</span><input className="inp" type="date" name="date" defaultValue={s.opening_date} /></label>
          <button className="btn">Save</button>
          <button className="btn pri" name="post" value="1">Save and post opening entry</button>
          <span className="muted" style={{ fontSize: 13 }}>Assets are debits; liabilities, equity and the partners&apos; funding are credits. Saving keeps the figures as a draft.</span>
        </div>}
      </form>
    </>
  );
}
