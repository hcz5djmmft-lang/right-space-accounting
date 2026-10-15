import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { bankAccounts } from '@/lib/banks';
import { CashCount } from '@/components/CashCount';
import { DENOMINATIONS, canApproveTopup, cashCounts, pettyBoxes, topups } from '@/lib/petty';
import { approveTopupAction, countAction, floatAction, rejectTopupAction, topupAction } from './actions';
import { formLists } from '@/lib/form-data';
import { listAssignees } from '@/lib/hr';
import { listVouchers, officeCash } from '@/lib/petty-vouchers';
import { STATUS_LABEL, listPetty } from '@/lib/petty-docs';
import { sql } from '@/lib/db';
import { PettyCashForm } from '@/components/PettyCashForm';
import { voidVoucherAction, voucherAction } from './voucher-actions';

/** Petty cash: a new petty cash sent for approval and paid from the office cash (updates 18 and 20), the petty cash made, the count sheet, top-up requests and their approval (improvement 15). */
export default async function PettyCash({ searchParams }: { searchParams: Promise<{ box?: string; ok?: string; error?: string }> }) {
  const user = await requireUser('finance');
  const q = await searchParams;
  const boxes = await pettyBoxes();
  if (!boxes.length) return <><div className="head"><div><h1>Petty cash</h1></div></div><p className="muted">No petty cash account is set up under Banks &amp; cash.</p></>;
  const b = boxes.find(x => x.code === q.box) ?? boxes[0];
  const [counts, all, banks, lists, people, vouchers, cash, docs, parties] = await Promise.all([cashCounts(b.code), topups(), bankAccounts(), formLists(), listAssignees(), listVouchers(), officeCash(), listPetty(),
    sql<{ id: string; name: string; code: string | null; is_sub: boolean }[]>`select id, name, code, is_sub from parties where type = 'vendor' order by name`]);
  const pending = all.filter(t => t.account === b.code && t.status === 'pending');
  const past = all.filter(t => t.account === b.code && t.status !== 'pending').slice(0, 10);
  const suggest = b.float !== null ? Math.max(0, Math.round((b.float - b.balance) * 100) / 100) : 0;
  const fromBanks = banks.filter(a => a.kind === 'bank' && a.type === 'asset');
  return (
    <>
      <div className="head"><div><h1>Petty cash</h1><p>A petty cash is a cash payment out of the office cash, never from the bank. Pay one here, count the box, and ask Finance for a top-up.</p></div>
        <Link className="btn" href={`/banks?account=${b.code}`}>Activity</Link></div>
      {q.ok && <div className="msg good">{q.ok}</div>}
      {q.error && <div className="msg bad">{q.error}</div>}
      <PettyCashForm accounts={lists.accounts} projects={lists.projects} departments={lists.departments} cash={{ code: cash.code, name: cash.name, balance: fmt(cash.balance) }} date={today()} action={voucherAction}
        employees={people.filter(p => p.employee_id).map(p => ({ id: p.employee_id!, name: p.name, detail: p.detail }))}
        vendors={parties.filter(p => !p.is_sub).map(p => ({ id: p.id, name: p.name, detail: p.code ?? '' }))} subs={parties.filter(p => p.is_sub).map(p => ({ id: p.id, name: p.name, detail: p.code ?? '' }))} />
      {(docs.length > 0 || vouchers.length > 0) && <div className="card">
        <h2 style={{ marginTop: 0 }}>Petty cash</h2>
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Date</th><th>Paid to</th><th className="hide-sm">Purpose</th><th className="hide-sm">Project / dept.</th><th>Status</th><th className="num">EGP</th><th></th></tr></thead>
          <tbody>{docs.map(d => <tr key={d.id} style={d.status === 'voided' ? { opacity: .55, textDecoration: 'line-through' } : undefined}>
            <td className="mono"><Link href={`/petty-cash/${d.id}`}>{d.no}</Link></td><td className="mono">{d.date}</td><td dir="auto">{d.paid_to_name}</td>
            <td className="hide-sm" dir="auto">{d.purpose}</td><td className="hide-sm">{d.cc}</td>
            <td><span className={'pill ' + (d.status === 'paid' ? 'posted' : d.status === 'rejected' || d.status === 'voided' ? 'rejected' : 'pending')}>{STATUS_LABEL[d.status]}</span></td>
            <td className="num">{fmt(d.total)}</td>
            <td><Link className="btn sm" href={`/print/petty-cash/${d.id}`} target="_blank">Print</Link></td></tr>)}
          {vouchers.map(v => <tr key={v.id} style={v.voided ? { opacity: .55, textDecoration: 'line-through' } : undefined}>
            <td className="mono"><Link href={`/entries/${v.id}`}>{v.ref ?? v.no}</Link></td><td className="mono">{v.date}</td><td dir="auto">{v.paid_to}</td>
            <td className="hide-sm" dir="auto">{v.purpose}</td><td className="hide-sm">{v.cc}<div className="muted mono" style={{ fontSize: 12 }}>{v.account}</div></td>
            <td><span className="pill posted">Paid</span></td><td className="num">{fmt(v.amount)}</td>
            <td style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={`/print/petty-cash/${v.id}`} target="_blank">Print</Link>
              {!v.voided && <details style={{ display: 'inline-block', marginInlineStart: 4 }}><summary className="btn sm">Void</summary>
                <form action={voidVoucherAction.bind(null, v.id)} className="row" style={{ marginTop: 6 }}><input className="inp" name="reason" placeholder="Why" required /><button className="btn sm bad">Void</button></form></details>}</td></tr>)}</tbody>
        </table></div></div>}
      {boxes.length > 1 && <div className="row" style={{ gap: 6, marginBottom: 12 }}>{boxes.map(x => <Link key={x.code} className={`btn sm${x.code === b.code ? ' pri' : ''}`} href={`/petty-cash?box=${x.code}`}>{x.name}</Link>)}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">{b.name}{b.holder ? ` · ${b.holder}` : ''}</div><div className="v mono">{fmt(b.balance)}</div></div>
        <div className="tile"><div className="k">Float (topped up to)</div><div className="v mono">{b.float === null ? '—' : fmt(b.float)}</div></div>
        <div className="tile"><div className="k">Last count</div><div className="v">{b.last_count ?? 'Never'}{b.last_difference ? <span className="mono" style={{ color: 'var(--bad)', fontSize: 14 }}> · {fmt(b.last_difference)}</span> : null}</div></div>
      </div>

      {pending.map(t => (
        <div key={t.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{t.no} · top-up of {fmt(t.amount)}</b><span className="pill pending">Waiting</span></div>
          <p className="muted" style={{ margin: '4px 0 8px' }}>Asked by {t.who} on {t.at}{t.note ? ` · ${t.note}` : ''}</p>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
            {canApproveTopup(user, t) && <form action={approveTopupAction.bind(null, b.code, t.id)} className="row" style={{ alignItems: 'end' }}>
              <label className="f"><span>Pay from</span><select className="inp" name="bank">{fromBanks.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></label>
              <button className="btn pri">Approve and transfer</button></form>}
            <form action={rejectTopupAction.bind(null, b.code, t.id)} className="row" style={{ alignItems: 'end' }}>
              {t.requested_by !== user.id && <label className="f"><span>Why not</span><input className="inp" name="reason" /></label>}
              <button className="btn">{t.requested_by === user.id ? 'Cancel request' : 'Turn down'}</button></form>
          </div>
        </div>))}

      <form action={countAction.bind(null, b.code)} className="card">
        <h2 style={{ marginTop: 0 }}>Count the cash</h2>
        <CashCount denominations={DENOMINATIONS} book={b.balance} />
        <div className="grid g2" style={{ alignItems: 'end', marginTop: 8 }}>
          <label className="f"><span>Day of the count</span><input className="inp" type="date" name="date" defaultValue={today()} max={today()} /></label>
          <label className="f"><span>Note on any difference</span><input className="inp" name="remark" dir="auto" /></label>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>The books figure is today&apos;s; a count dated earlier is set against that day&apos;s balance.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Save count</button></div>
      </form>

      <div className="grid g2">
        {pending.length === 0 && <form action={topupAction.bind(null, b.code)} className="card">
          <h2 style={{ marginTop: 0 }}>Ask for a top-up</h2>
          <label className="f"><span>Amount</span><input className="inp mono" name="amount" inputMode="decimal" defaultValue={suggest || ''} /></label>
          <label className="f" style={{ marginTop: 8 }}><span>Note</span><input className="inp" name="note" dir="auto" placeholder="Site expenses this week" /></label>
          <p className="muted" style={{ fontSize: 13 }}>Goes to Finance and Management for approval; the transfer from the bank is recorded on approval.</p>
          <button className="btn pri">Send request</button>
        </form>}
        <form action={floatAction.bind(null, b.code)} className="card">
          <h2 style={{ marginTop: 0 }}>Float</h2>
          <label className="f"><span>Top the box up to</span><input className="inp mono" name="float" inputMode="decimal" defaultValue={b.float ?? ''} /></label>
          <p className="muted" style={{ fontSize: 13 }}>A top-up request suggests the float less what is in the box.</p>
          <button className="btn">Save float</button>
        </form>
      </div>

      {counts.length > 0 && <div className="card">
        <h2 style={{ marginTop: 0 }}>Counts</h2>
        <div className="tw"><table>
          <thead><tr><th>Day</th><th className="num">Counted</th><th className="num hide-sm">Books</th><th className="num">Difference</th><th className="hide-sm">By</th></tr></thead>
          <tbody>{counts.map(c => <tr key={c.id}><td className="mono">{c.date}</td><td className="num">{fmt(c.counted)}</td><td className="num hide-sm">{fmt(c.book)}</td>
            <td className="num" style={{ color: c.difference ? 'var(--bad)' : undefined }}>{fmt(c.difference)}{c.remark ? <div className="muted" style={{ fontSize: 12 }} dir="auto">{c.remark}</div> : null}</td><td className="hide-sm">{c.who}</td></tr>)}</tbody>
        </table></div></div>}
      {past.length > 0 && <div className="card">
        <h2 style={{ marginTop: 0 }}>Top-ups</h2>
        <div className="tw"><table><tbody>{past.map(t => <tr key={t.id}><td className="mono">{t.no}</td><td>{t.at.slice(0, 10)}</td><td className="num">{fmt(t.amount)}</td>
          <td>{t.status === 'paid' ? <>Paid · {t.entry_id && <Link href={`/entries/${t.entry_id}`}>{t.entry_no}</Link>}</> : t.status === 'rejected' ? `Turned down: ${t.decision}` : 'Cancelled'}</td></tr>)}</tbody></table></div></div>}
    </>
  );
}
