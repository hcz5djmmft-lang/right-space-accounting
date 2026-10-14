import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { KINDS, activity, auditEvents, fieldLabel } from '@/lib/audit-trail';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const OP: Record<string, [string, string]> = { create: ['Created', 'posted'], change: ['Changed', 'pending'], delete: ['Deleted', 'rejected'] };

/** Settings > Audit log (improvement 16): every change to entries, invoices, payments and payroll with before and after, and all logged activity. */
export default async function AuditLog({ searchParams }: { searchParams: Promise<{ view?: string; tbl?: string; who?: string; from?: string; to?: string; q?: string }> }) {
  await requireUser('management');
  const f = await searchParams;
  const all = f.view === 'activity';
  const users = await sql<{ id: string; name: string }[]>`select id, name from users order by name`;
  const filter = { tbl: f.tbl, who: f.who, from: f.from, to: f.to, q: f.q };
  const tabs = (
    <div className="row noprint" style={{ gap: 6, marginBottom: 12 }}>
      <Link className={`btn sm${all ? '' : ' pri'}`} href="/settings/audit">Changes to records</Link>
      <Link className={`btn sm${all ? ' pri' : ''}`} href="/settings/audit?view=activity">All activity</Link>
    </div>);
  const form = (
    <form className="card row noprint" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
      {all && <input type="hidden" name="view" value="activity" />}
      {!all && <label className="f"><span>Record</span><select className="inp" name="tbl" defaultValue={f.tbl ?? ''}><option value="">All</option>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      <label className="f"><span>Who</span><select className="inp" name="who" defaultValue={f.who ?? ''}><option value="">Anyone</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={f.from ?? ''} /></label>
      <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={f.to ?? ''} /></label>
      <label className="f"><span>Number or text</span><input className="inp" name="q" defaultValue={f.q ?? ''} placeholder="JE-00012" /></label>
      <button className="btn">Show</button>
    </form>);
  if (all) {
    const rows = await activity(filter);
    return (
      <>
        <div className="head"><div><h1>Audit log</h1><p>Everything people did in the system, newest first.</p></div><Link className="btn" href="/settings">Settings</Link></div>
        {tabs}{form}
        <div className="tw"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th className="hide-sm">Record</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td className="mono">{r.at}</td><td>{r.who ?? <span className="muted">system or client</span>}</td><td dir="auto">{r.action}{r.note ? <div className="muted" style={{ fontSize: 12 }}>{r.note}</div> : null}</td><td className="hide-sm mono" style={{ fontSize: 12 }}>{r.entity} {r.entity_id.slice(0, 12)}</td></tr>)}</tbody>
        </table></div>
        {rows.length === 0 && <p className="muted">Nothing found.</p>}
      </>);
  }
  const events = await auditEvents(filter);
  return (
    <>
      <div className="head"><div><h1>Audit log</h1><p>Every create, edit, post, void and delete of entries, invoices, payment requests, payments and payroll, with who did it and what it was before and after.</p></div><Link className="btn" href="/settings">Settings</Link></div>
      {tabs}{form}
      {events.length === 0 ? <p className="muted">Nothing found.</p> : events.map(e => (
        <div key={e.id} className="card" style={{ padding: '10px 14px' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span><span className={`pill ${OP[e.op][1]}`}>{OP[e.op][0]}</span> <b>{e.href ? <Link href={e.href}>{e.no}</Link> : e.no}</b> <span className="muted">· {KINDS[e.tbl]}</span>{e.action ? <> · {e.action}</> : null}</span>
            <span className="muted" style={{ fontSize: 13 }}>{e.at} · {e.who ?? 'not recorded'}</span>
          </div>
          {e.changes.length > 0 && e.op === 'change' && <div className="tw"><table style={{ marginTop: 6 }}>
            <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{e.changes.map(c => <tr key={c.field}><td>{fieldLabel(c.field)}</td><td dir="auto" style={{ color: 'var(--bad)' }}>{show(c.before)}</td><td dir="auto">{show(c.after)}</td></tr>)}</tbody>
          </table></div>}
          {e.lines.length > 0 && <ul style={{ margin: '6px 0 0', paddingInlineStart: 18, fontSize: 13 }}>{e.lines.map((l, i) => <li key={i} dir="auto" style={{ color: l.kind === 'removed' ? 'var(--bad)' : undefined }}>{l.kind === 'added' ? 'Line added: ' : 'Line removed: '}{l.text}</li>)}</ul>}
        </div>))}
    </>
  );
}
