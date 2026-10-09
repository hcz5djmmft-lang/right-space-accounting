import { requireUser } from '@/lib/auth';
import { trialBalance, type TBRow } from '@/lib/books';
import { listDepartments, listProjects } from '@/lib/queries';
import { fmt } from '@/lib/money';
import { natural } from '@/lib/ledger';
import { ReportFilter, parseCC } from '@/components/ReportFilter';
import { ReportTools } from '@/components/ReportTools';

export default async function IncomeStatement({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; cc?: string }> }) {
  await requireUser();
  const q = await searchParams;
  const year = new Date().getFullYear();
  const from = q.from || `${year}-01-01`, to = q.to || `${year}-12-31`;
  const [rows, projects, departments] = await Promise.all([trialBalance({ from, to, ...parseCC(q.cc) }), listProjects(), listDepartments()]);
  const rev = rows.filter(r => r.type === 'revenue'), exp = rows.filter(r => r.type === 'expense');
  const sum = (l: TBRow[]) => l.reduce((s, r) => s + natural(r.type, r.dr, r.cr), 0);
  const section = (title: string, list: TBRow[]) => (
    <><tr className="hdr"><td colSpan={2}>{title}</td></tr>
      {list.map(r => <tr key={r.code} className="lvl1"><td dir="auto"><span className="mono">{r.code}</span> · {r.name}</td><td className="num">{fmt(natural(r.type, r.dr, r.cr))}</td></tr>)}
      <tr className="hdr"><td>Total {title.toLowerCase()}</td><td className="num">{fmt(sum(list))}</td></tr></>);
  return (
    <>
      <div className="head"><div><h1>Income statement</h1><p>{from} to {to}</p></div><ReportTools report="is" query={{ from, to, cc: q.cc }} /></div>
      <ReportFilter from={from} to={to} cc={q.cc} projects={projects} departments={departments} />
      <div className="tw"><table><tbody>
        {section('Revenue', rev)}{section('Expenses', exp)}
      </tbody><tfoot><tr><td>Net profit</td><td className="num">{fmt(sum(rev) - sum(exp))}</td></tr></tfoot></table></div>
    </>
  );
}
