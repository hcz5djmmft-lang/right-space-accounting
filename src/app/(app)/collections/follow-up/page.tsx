import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { BUCKETS } from '@/lib/reports';
import { followUps, raiseCollectionReminders, reminderMessage, waNumber } from '@/lib/followup';
import { CopyButton } from '@/components/CopyButton';

/** Collections follow-up (improvement 7): who owes what and for how long, with the reminder message ready for WhatsApp. */
export default async function FollowUp() {
  await requireUser('finance');
  await raiseCollectionReminders();
  const [{ customers, totals }, [bank]] = await Promise.all([
    followUps(),
    sql<{ holder: string | null; bank_name: string | null; iban: string | null }[]>`select holder, bank_name, iban from bank_accounts where show_on_invoices limit 1`,
  ]);
  return (
    <>
      <div className="head"><div><h1>Collections follow-up</h1><p>Client invoices still owed, by days past due. A reminder task goes to Finance on each due date and every 7 days after, and closes when the invoice is paid.</p></div>
        <div className="row"><Link className="btn" href="/collections">Collections</Link><Link className="btn" href="/reports/aging?side=sales">Aging report</Link></div></div>
      <div className="tiles">{BUCKETS.map((b, i) => <div key={b} className="tile"><div className="k">{b === 'Current' ? 'Not yet due' : `${b} days late`}</div><div className="v mono" style={i >= 3 && totals[i] ? { color: 'var(--bad)' } : undefined}>{fmt(totals[i])}</div></div>)}</div>
      {customers.length === 0 ? <div className="empty card">No client owes anything. 🎉</div> : customers.map(c => {
        const msg = reminderMessage(c, bank);
        const wa = waNumber(c.phone);
        return (
          <div key={c.party_id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><b dir="auto">{c.full_name || c.party}</b> <span className="muted">{c.phone ?? 'no phone on file'}</span></div>
              <div className="mono"><b>{fmt(c.total)}</b>{c.overdue ? <span style={{ color: 'var(--bad)' }}> · {fmt(c.overdue)} overdue</span> : null}</div>
            </div>
            <div className="tw"><table style={{ marginTop: 6 }}>
              <thead><tr>{BUCKETS.map(b => <th key={b} className="num">{b}</th>)}</tr></thead>
              <tbody><tr>{c.buckets.map((v, i) => <td key={i} className="num">{v ? fmt(v) : ''}</td>)}</tr></tbody>
            </table></div>
            <div style={{ display: 'grid', gap: 2, margin: '6px 0' }}>{c.docs.map(d => <div key={d.id} className="row" style={{ gap: 8 }}><Link className="mono" href={`/sales-invoices/${d.id}`}>{d.no}</Link><span className="muted mono">{d.due ? `due ${d.due}` : 'no due date'}</span>{d.days > 0 && <span className="pill rejected">{d.days} days late</span>}<span className="mono">{fmt(d.balance)}</span></div>)}</div>
            <div className="row">
              <CopyButton text={msg.en} label="Copy WhatsApp message" />
              <CopyButton text={msg.ar} label="نسخ الرسالة بالعربي" />
              {wa && <a className="btn sm" href={`https://wa.me/${wa}?text=${encodeURIComponent(msg.en + '\n\n' + msg.ar)}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
              {!c.phone && <Link className="btn sm" href={`/parties/${c.party_id}`}>Add the phone number</Link>}
            </div>
          </div>);
      })}
    </>
  );
}
