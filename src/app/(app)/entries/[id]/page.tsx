import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { canPostDirect, getSettings } from '@/lib/books';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { approveAction, deleteAction, returnAction, reverseAction } from '../actions';
import { listAttachments } from '@/lib/attachments';
import { Attachments } from '@/components/Attachments';
import { hasRole } from '@/lib/roles';
import { TZ, today } from '@/lib/dates';

export default async function EntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const [e] = await sql<{ id: string; no: string; date: string; memo: string; ref: string; kind: string; status: string; reverses_id: string | null; reversed_by: string | null; source_type: string | null; created_by: string | null }[]>`
    select id, no, to_char(date,'YYYY-MM-DD') date, memo, ref, kind, status, reverses_id, reversed_by, source_type, created_by from journal_entries where id = ${id}`;
  if (!e) notFound();
  const [lines, log, links, settings, files] = await Promise.all([
    sql<{ account: string; name: string; dr: number; cr: number; cc: string | null; party: string | null; description: string }[]>`
      select l.account, a.name, l.dr, l.cr, coalesce(p.code, d.name) cc, pt.name party, l.description
      from journal_lines l join accounts a on a.code = l.account
      left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id left join parties pt on pt.id = l.party_id
      where l.entry_id = ${id} order by l.line_no`,
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'journal' and g.entity_id = ${id} order by g.at`,
    sql<{ id: string; no: string }[]>`select id, no from journal_entries where id in (${e.reverses_id ?? ''}, ${e.reversed_by ?? ''})`,
    getSettings(),
    listAttachments('journal', id),
  ]);
  const dr = lines.reduce((s, l) => s + l.dr, 0), cr = lines.reduce((s, l) => s + l.cr, 0);
  const approver = canPostDirect(user, settings);
  const typed = ['expense', 'collection', 'transfer'].includes(e.kind);
  const editable = typed && (e.status === 'draft' || e.status === 'rejected') && !e.source_type;
  const todayStr = today();
  const lastReturn = [...log].reverse().find(g => g.action === 'Returned for changes');
  return (
    <>
      <div className="head">
        <div><h1>{e.no} <span className={'pill ' + e.status}>{e.status}</span></h1>
          <p dir="auto">{e.date} · {e.memo}{e.ref ? ` · Ref ${e.ref}` : ''}</p></div>
        <div className="row">
          {editable && <Link className="btn" href={`/entries/${id}/edit`}>Edit</Link>}
          {e.status === 'pending' && approver && <form action={approveAction.bind(null, id)}><button className="btn pri">Approve &amp; post</button></form>}
          {e.status !== 'posted' && !e.source_type && <form action={deleteAction.bind(null, id)}><button className="btn bad">Delete</button></form>}
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {e.status === 'rejected' && lastReturn && <div className="msg bad">Returned for changes: {lastReturn.note || 'no reason given'}</div>}
      {links.map(l => <div key={l.id} className="msg good">{l.id === e.reversed_by ? 'Reversed by ' : 'Reverses '}<Link href={`/entries/${l.id}`}>{l.no}</Link></div>)}
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>GL code</th><th>Project / dept.</th><th className="hide-sm">Party</th><th className="hide-sm">Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td dir="auto"><span className="mono">{l.account}</span> · {l.name}</td><td>{l.cc}</td><td className="hide-sm">{l.party}</td>
            <td className="hide-sm" dir="auto">{l.description}</td><td className="num">{l.dr ? fmt(l.dr) : ''}</td><td className="num">{l.cr ? fmt(l.cr) : ''}</td></tr>))}
        </tbody>
        <tfoot><tr><td colSpan={2}>Total</td><td className="hide-sm" colSpan={2}></td><td className="num">{fmt(dr)}</td><td className="num">{fmt(cr)}</td></tr></tfoot>
      </table></div>

      {e.status === 'pending' && approver && (
        <form action={returnAction.bind(null, id)} className="card row">
          <input className="inp" name="reason" placeholder="Reason for returning (shown to the preparer)" style={{ flex: 1, minWidth: 200 }} />
          <button className="btn bad">Return for changes</button>
        </form>)}
      {e.status === 'posted' && !e.reversed_by && e.kind !== 'reversal' && approver && (
        <details className="card"><summary>Reverse this entry</summary>
          <form action={reverseAction.bind(null, id)} className="grid g3" style={{ marginTop: 10, alignItems: 'end' }}>
            <label className="f"><span>Reversal date</span><input className="inp" type="date" name="date" defaultValue={todayStr} /></label>
            <label className="f"><span>Reason</span><input className="inp" name="reason" /></label>
            <button className="btn bad">Post reversal</button>
          </form></details>)}

      {typed && <Attachments entity="journal" id={id} path={`/entries/${id}`} items={files} userId={user.id} canRemove={hasRole(user, 'finance')} locked={e.status === 'posted'} />}
      <div className="card"><h2>History</h2>
        <div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? 'Imported'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
