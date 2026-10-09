import { currentUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { loadTender } from '@/lib/tenders';
import { clientRows, tenderTotals, uRate } from '@/lib/tender-calc';
import { r2 } from '@/lib/money';
import { toCsv } from '@/lib/reports';

/** CSV for Excel: the client BOQ with client prices, or the full comparison of every bidder's unit rates. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || !hasRole(user, 'tenders')) return new Response('Sign in first', { status: 401 });
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get('kind') === 'compare' ? 'compare' : 'client';
  const t = await loadTender(id);
  if (!t) return new Response('Not found', { status: 404 });
  const out: unknown[][] = [];
  if (kind === 'client') {
    const T = tenderTotals(t);
    out.push(['Trade', 'Item no.', 'Description', 'Unit', 'Qty', 'Unit price (EGP)', 'Amount (EGP)']);
    for (const r of clientRows(t)) out.push([r.tr.name, r.it.no, r.it.description, r.it.unit, r.it.qty, r.cr ?? '', r.amt ?? '']);
    out.push([], ['', '', 'Total before VAT', '', '', '', T.client], ['', '', `VAT ${t.vat}%`, '', '', '', T.vat], ['', '', 'Total incl. VAT', '', '', '', r2(T.client + T.vat)]);
  } else {
    out.push(['Trade', 'Item no.', 'Description', 'Unit', 'Qty', 'Bidder', 'Unit rate', 'Total']);
    for (const tr of t.trades) for (const it of tr.items) for (const b of tr.bidders) { const u = uRate(t, tr, b, it); out.push([tr.name, it.no, it.description, it.unit, it.qty, b.name, u ?? '', u === null ? '' : r2(u * (it.qty ?? 0))]); }
  }
  const csv = toCsv(out); // same quoting and formula guard as the reports
  const name = `${t.no} ${t.name} ${kind === 'client' ? 'client BOQ' : 'comparison'}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
}
