import Link from 'next/link';
import { requireUser } from '@/lib/auth';

const REPORTS = [
  ['/reports/trial-balance', 'Trial balance', 'Debit and credit totals per GL code; must agree.'],
  ['/reports/income-statement', 'Income statement', 'Revenue less expenses for a period, company-wide or per cost center.'],
  ['/reports/balance-sheet', 'Balance sheet', 'Assets, liabilities and equity on a date.'],
  ['/reports/ledger', 'General ledger', 'Every posted line of one GL code with a running balance.'],
  ['/reports/cost-centers', 'Cost centers', 'Revenue, cost and budget used per project, grouped by type, service or unit.'],
  ['/reports/budget', 'Budget vs actual', 'Budget, actual and committed payment requests per GL code.'],
  ['/reports/aging', 'Aging', 'Open payables and receivables by days past due.'],
  ['/reports/tax', 'VAT, WHT and deductions', 'VAT in and out, withholding tax and social insurance for the returns.'],
];

export default async function Reports() {
  await requireUser();
  return (
    <>
      <div className="head"><div><h1>Reports</h1><p>Every report exports to Excel (CSV) and prints to PDF.</p></div></div>
      <div className="tiles">{REPORTS.map(([href, t, d]) => (
        <Link key={href} href={href} className="tile" style={{ textDecoration: 'none' }}><div style={{ fontWeight: 600 }}>{t}</div><div className="k" style={{ marginTop: 4 }}>{d}</div></Link>))}
      </div>
    </>
  );
}
