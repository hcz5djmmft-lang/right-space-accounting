import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';

export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const [banks, [pl], [pend], projects] = await Promise.all([
    sql<{ code: string; name: string; bal: number }[]>`
      select a.code, a.name, coalesce(sum(l.dr - l.cr),0) bal from accounts a
      left join journal_lines l on l.account = a.code and exists (select 1 from journal_entries e where e.id = l.entry_id and e.status = 'posted')
      where a.is_bank group by a.code, a.name order by a.code`,
    sql<{ rev: number; exp: number }[]>`
      select coalesce(sum(case when a.type='revenue' then l.cr - l.dr end),0) rev, coalesce(sum(case when a.type='expense' then l.dr - l.cr end),0) exp
      from journal_lines l join accounts a on a.code = l.account join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where e.date >= ${today().slice(0, 4) + '-01-01'}::date`,
    sql<{ n: number }[]>`select count(*)::int n from journal_entries where status = 'pending'`,
    sql<{ id: string; code: string; name: string; budget: number | null; spent: number; collected: number }[]>`
      select p.id, p.code, p.name, p.budget,
        coalesce(sum(case when a.type='expense' then l.dr - l.cr end),0) spent,
        coalesce(sum(case when a.type='revenue' then l.cr - l.dr end),0) collected
      from projects p left join journal_lines l on l.project_id = p.id
        and exists (select 1 from journal_entries e where e.id = l.entry_id and e.status = 'posted')
      left join accounts a on a.code = l.account
      where p.status <> 'Closed' group by p.id order by p.is_office desc, p.code`,
  ]);
  const cash = banks.reduce((s, b) => s + b.bal, 0);
  return (
    <>
      {denied && <div className="msg bad">Your role does not give you access to that page.</div>}
      <div className="head">
        <div><h1>Good day, {user.name.split(' ')[0]}</h1><p>Right Space Development · all amounts in EGP</p></div>
        <div className="row"><Link className="btn pri" href="/entries/new?type=expense">Record expense</Link><Link className="btn" href="/entries/new?type=collection">Collection</Link></div>
      </div>
      <div className="tiles">
        <div className="tile"><div className="k">Cash &amp; bank</div><div className="v mono">{fmt(cash)}</div></div>
        <div className="tile"><div className="k">Revenue this year</div><div className="v mono">{fmt(pl.rev)}</div></div>
        <div className="tile"><div className="k">Expenses this year</div><div className="v mono">{fmt(pl.exp)}</div></div>
        <Link href="/approvals" className="tile" style={{ textDecoration: 'none' }}><div className="k">Waiting for approval</div><div className="v">{pend.n}</div></Link>
      </div>
      <div className="grid g2">
        <div className="card"><h2>Banks &amp; cash</h2>
          <table><tbody>{banks.map(b => <tr key={b.code}><td><span className="mono">{b.code}</span> · {b.name}</td><td className="num">{fmt(b.bal)}</td></tr>)}</tbody></table></div>
        <div className="card"><h2>Projects</h2>
          <table><thead><tr><th>Project</th><th className="num">Spent</th><th className="num">Collected</th></tr></thead>
            <tbody>{projects.map(p => <tr key={p.id}><td><Link href={`/cost-centers/${p.id}`}>{p.code}</Link></td><td className="num">{fmt(p.spent)}</td><td className="num">{fmt(p.collected)}</td></tr>)}</tbody></table></div>
      </div>
    </>
  );
}
