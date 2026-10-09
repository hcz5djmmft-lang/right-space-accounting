import { requireUser } from '@/lib/auth';
import { trialBalance } from '@/lib/books';
import { listDepartments, listProjects } from '@/lib/queries';
import { fmt } from '@/lib/money';
import { ReportFilter, parseCC } from '@/components/ReportFilter';
import { ReportTools } from '@/components/ReportTools';

export default async function TrialBalance({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; cc?: string }> }) {
  await requireUser();
  const q = await searchParams;
  const [rows, projects, departments] = await Promise.all([
    trialBalance({ from: q.from || undefined, to: q.to || undefined, ...parseCC(q.cc) }), listProjects(), listDepartments()]);
  const dr = rows.reduce((s, r) => s + Math.max(r.dr - r.cr, 0), 0), cr = rows.reduce((s, r) => s + Math.max(r.cr - r.dr, 0), 0);
  const ok = Math.abs(dr - cr) < 0.005;
  return (
    <>
      <div className="head"><div><h1>Trial balance</h1><p>{ok ? 'Debits and credits agree.' : 'Debits and credits do not agree for this cost center (normal when filtering by project: the bank side has no cost center).'}</p></div><ReportTools report="tb" query={q} /></div>
      <ReportFilter {...q} projects={projects} departments={departments} />
      <div className="tw"><table>
        <thead><tr><th>GL code</th><th>Name</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
        <tbody>{rows.filter(r => Math.abs(r.dr - r.cr) > 0.004).map(r => (
          <tr key={r.code}><td className="mono">{r.code}</td><td dir="auto">{r.name}</td>
            <td className="num">{r.dr > r.cr ? fmt(r.dr - r.cr) : ''}</td><td className="num">{r.cr > r.dr ? fmt(r.cr - r.dr) : ''}</td></tr>))}</tbody>
        <tfoot><tr><td colSpan={2}>Total</td><td className="num">{fmt(dr)}</td><td className="num">{fmt(cr)}</td></tr></tfoot>
      </table></div>
    </>
  );
}
