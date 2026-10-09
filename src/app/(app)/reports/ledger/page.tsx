import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { natural, type AccountType } from '@/lib/ledger';

export default async function Ledger({ searchParams }: { searchParams: Promise<{ account?: string; from?: string; to?: string }> }) {
  await requireUser();
  const { account = '', from = '', to = '' } = await searchParams;
  const accounts = await sql<{ code: string; name: string; type: AccountType }[]>`select code, name, type from accounts where postable order by code`;
  const acc = accounts.find(a => a.code === account);
  const lines = acc ? await sql<{ id: string; no: string; date: string; memo: string; description: string; cc: string | null; dr: number; cr: number }[]>`
    select e.id, e.no, to_char(e.date,'YYYY-MM-DD') date, e.memo, l.description, coalesce(p.code, d.name) cc, l.dr, l.cr
    from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    left join projects p on p.id = l.project_id left join departments d on d.id = l.dept_id
    where l.account = ${account} and (${from} = '' or e.date >= ${from || null}::date) and (${to} = '' or e.date <= ${to || null}::date)
    order by e.date, e.no, l.line_no` : [];
  let run = 0;
  return (
    <>
      <div className="head"><div><h1>General ledger</h1><p>{acc ? `${acc.code} · ${acc.name}` : 'Pick a GL code'}</p></div></div>
      <form className="row card" style={{ alignItems: 'end' }}>
        <label className="f" style={{ minWidth: 260 }}><span>GL code</span><select className="inp" name="account" defaultValue={account}>
          <option value="">Select…</option>{accounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label>
        <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
        <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
        <button className="btn">Show</button>
      </form>
      {acc && (lines.length === 0 ? <div className="empty card">No posted lines.</div> : (
        <div className="tw"><table>
          <thead><tr><th>Date</th><th>Entry</th><th>Description</th><th className="hide-sm">Cost center</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
          <tbody>{lines.map((l, i) => { run += natural(acc.type, l.dr, l.cr); return (
            <tr key={i}><td className="mono">{l.date}</td><td className="mono"><Link href={`/entries/${l.id}`}>{l.no}</Link></td><td dir="auto">{l.description || l.memo}</td>
              <td className="hide-sm">{l.cc}</td><td className="num">{l.dr ? fmt(l.dr) : ''}</td><td className="num">{l.cr ? fmt(l.cr) : ''}</td><td className="num">{fmt(run)}</td></tr>); })}</tbody>
        </table></div>))}
    </>
  );
}
