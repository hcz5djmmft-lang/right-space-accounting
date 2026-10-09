import Link from 'next/link';
import { requireUser } from '@/lib/auth';

const REPORTS = [
  ['/reports/trial-balance', 'Trial balance', 'Debit and credit totals per GL code; must agree.'],
  ['/reports/income-statement', 'Income statement', 'Revenue less expenses for a period, company-wide or per cost center.'],
  ['/reports/balance-sheet', 'Balance sheet', 'Assets, liabilities and equity on a date.'],
  ['/reports/ledger', 'General ledger', 'Every posted line of one GL code with a running balance.'],
];

export default async function Reports() {
  await requireUser();
  return (
    <>
      <div className="head"><div><h1>Reports</h1><p>Aging, budget vs actual and Excel/PDF export come in the next steps.</p></div></div>
      <div className="tiles">{REPORTS.map(([href, t, d]) => (
        <Link key={href} href={href} className="tile" style={{ textDecoration: 'none' }}><div style={{ fontWeight: 600 }}>{t}</div><div className="k" style={{ marginTop: 4 }}>{d}</div></Link>))}
      </div>
    </>
  );
}
