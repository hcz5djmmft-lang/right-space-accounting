import { currentUser } from '@/lib/auth';
import { getSettings } from '@/lib/books';
import { reportCsv, toCsv } from '@/lib/reports';

/** Excel (CSV) of any report with the same filters as its page: /reports/export?report=tb|is|bs|gl|cc|budget|aging|tax&from=&to=&cc=&account=&side= */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  const p = new URL(req.url).searchParams;
  const q = Object.fromEntries(['from', 'to', 'cc', 'account', 'side'].map(k => [k, p.get(k) ?? undefined]));
  const r = await reportCsv(p.get('report') ?? '', q, await getSettings());
  if (!r) return new Response('Unknown report', { status: 404 });
  const name = `RS ${r.name}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  return new Response(toCsv(r.rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
}
