import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { closeChecklist, closeMonths } from '@/lib/close';
import { lockAction, reopenAction, tickAction } from './actions';

/** Month-end close (improvement 9): the checklist of a month and the lock date. */
export default async function Close({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; error?: string }> }) {
  const user = await requireUser('finance');
  const { m, ok, error } = await searchParams;
  const months = await closeMonths();
  // default: the most recent month that is not locked and has ended, else the current one
  const pick = months.find(x => x.period === m) ?? months.find(x => !x.locked && !x.current) ?? months[0];
  const c = await closeChecklist(pick.period);
  const mgmt = hasRole(user, 'management');
  return (
    <>
      <div className="head"><div><h1>Month-end close</h1><p>Check each month, then lock the books to its last day. Locked months take no new or changed entries until Management reopens them.</p></div>
        <Link className="btn" href="/settings">Lock date in Settings</Link></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {months.map(x => <Link key={x.period} href={`/close?m=${x.period}`} className={`btn sm${x.period === c.period ? ' pri' : ''}`}>{x.name}{x.locked ? ' 🔒' : ''}</Link>)}
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{c.name}</h2>
          {c.locked ? <span className="pill posted">Locked{c.closedBy ? ` by ${c.closedBy} on ${c.closedAt}` : ''}</span> : c.ready ? <span className="pill posted">Ready to lock</span> : <span className="pill pending">{c.items.filter(i => !i.done).length} to do</span>}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {c.items.map(i => (
            <li key={i.key} className="row" style={{ borderTop: '1px solid var(--line)', padding: '10px 0', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <b>{i.done ? '✅' : '⬜'} {i.label}</b>
                <div className="muted" style={{ fontSize: 13 }}>{i.detail}{i.auto ? ' · checked by the system' : ''} · <Link href={i.href}>Open</Link></div>
              </div>
              {!i.auto && !c.locked && <form action={tickAction.bind(null, c.period, i.key, !i.done)}><button className={`btn sm${i.done ? '' : ' pri'}`}>{i.done ? 'Untick' : 'Tick as done'}</button></form>}
            </li>))}
        </ul>
      </div>
      {mgmt ? (c.locked
        ? <form action={reopenAction.bind(null, c.period)} className="card row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="f" style={{ flex: 1 }}><span>Why reopen {c.name}? Later months reopen with it.</span><input className="inp" name="reason" /></label>
            <button className="btn bad">Reopen the month</button>
          </form>
        : <form action={lockAction.bind(null, c.period)} className="card row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>Locking sets the lock date to {c.end}{c.lockDate ? ` (now ${c.lockDate})` : ''}.</span>
            {!c.ready && <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="anyway" /> Lock anyway</label>}
            <button className="btn pri">Lock the books to {c.end}</button>
          </form>)
        : <p className="muted">Management locks the month when the checklist is done.</p>}
    </>
  );
}
