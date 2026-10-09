import { PrintButton } from './PrintButton';

/** Export to Excel and Print / PDF buttons for a report; `query` is the page's own filters. */
export function ReportTools({ report, query }: { report: string; query: Record<string, string | undefined> }) {
  const q = new URLSearchParams({ report });
  for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  return (
    <div className="row noprint">
      <a className="btn" href={`/reports/export?${q}`}>Export to Excel (CSV)</a>
      <PrintButton />
    </div>
  );
}
