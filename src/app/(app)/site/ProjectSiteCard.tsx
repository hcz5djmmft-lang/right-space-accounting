import Link from 'next/link';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';

/** The project page's site card: reports sent, inspections waiting, snags, and the handover certificate. */
export async function ProjectSiteCard({ id, phase }: { id: string; phase: string | null }) {
  const [r] = await sql<{ reports: number; last_report: string | null; today_id: string | null; inspections: number; open_snags: number; fixed_snags: number; verified_snags: number; handover: string | null; man_days: number }[]>`
    select (select count(*)::int from site_reports r where r.project_id = ${id} and r.status <> 'draft') reports,
      (select to_char(max(r.day),'YYYY-MM-DD') from site_reports r where r.project_id = ${id} and r.status <> 'draft') last_report,
      (select r.id from site_reports r where r.project_id = ${id} and r.day = ${today()}::date) today_id,
      (select count(*)::int from inspection_requests i where i.project_id = ${id} and i.status = 'open') inspections,
      (select count(*)::int from snags s where s.project_id = ${id} and s.status = 'open') open_snags, (select count(*)::int from snags s where s.project_id = ${id} and s.status = 'fixed') fixed_snags,
      (select count(*)::int from snags s where s.project_id = ${id} and s.status = 'verified') verified_snags,
      (select h.status from handovers h where h.project_id = ${id}) handover,
      coalesce((select sum(m.headcount)::int from site_report_manpower m join site_reports r on r.id = m.report_id where r.project_id = ${id} and r.status <> 'draft'), 0) man_days`;
  if (!r || (!['execution', 'handover', 'closed'].includes(phase ?? '') && !r.reports && !r.inspections && !r.open_snags && !r.handover)) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Site execution</h2>
        <div className="row"><Link className="btn sm pri" href={r.today_id ? `/site/reports/${r.today_id}` : `/site/reports/new?project=${id}&day=${today()}`}>Today&apos;s report</Link><Link className="btn sm" href={`/site?tab=reports&project=${id}`}>Reports</Link><Link className="btn sm" href={`/site/snags?project=${id}`}>Snag list</Link><Link className="btn sm" href={`/site/handover/${id}`}>Handover</Link></div></div>
      <div className="tiles" style={{ marginTop: 8, marginBottom: 0 }}>
        <div className="tile"><div className="k">Site reports</div><div className="v mono">{r.reports}</div><div className="muted" style={{ fontSize: 12 }}>{r.last_report ? `last ${r.last_report}` : 'none sent yet'} · {r.man_days} man-days</div></div>
        <div className="tile"><div className="k">Inspections waiting</div><div className="v mono">{r.inspections ? <span className="pill pending">{r.inspections}</span> : 0}</div></div>
        <div className="tile"><div className="k">Snags open · fixed · verified</div><div className="v mono">{r.open_snags ? <span className="pill rejected">{r.open_snags}</span> : 0} · {r.fixed_snags} · {r.verified_snags}</div></div>
        <div className="tile"><div className="k">Handover certificate</div><div className="v">{r.handover ? <span className={'pill ' + (r.handover === 'signed' ? 'posted' : 'pending')}>{r.handover}</span> : <span className="muted">not drafted</span>}</div></div>
      </div>
    </div>
  );
}
