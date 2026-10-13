import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { SNAG_STATUSES, label, listSnags, snagCounts } from '@/lib/site';

// The snag list of a project for the handover walk: every finding with where, what, who fixes it and its state.
export default async function PrintSnags({ params }: { params: Promise<{ project: string }> }) {
  await requireUser();
  const { project } = await params;
  const [p] = await sql<{ code: string; name: string; client: string | null }[]>`select p.code, p.name, c.name client from projects p left join parties c on c.id = p.client_id where p.id = ${project} and not p.is_office`;
  if (!p) notFound();
  const [rows, counts] = await Promise.all([listSnags({ project }), snagCounts(project)]);
  const live = rows.filter(s => s.status !== 'cancelled');
  return (
    <div className="po-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .po-print{font-size:12px;max-width:860px;margin:0 auto;padding:24px;color:#111}
        @media print{.po-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .po-print h1{font-size:20px;margin:0;text-align:right}.po-print h1 small{display:block;font-size:15px;direction:rtl}
        .po-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.po-print th,.po-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .po-print th{background:#f4efe5;font-size:11px;position:static}.foot{margin-top:16px;color:#777;font-size:10px}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}.sd{color:#666;font-size:11px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 38 }} /><h1>Snag list · {p.code}<small>قائمة الملاحظات</small></h1></div>
      <p style={{ margin: '0 0 10px' }}><b>Project</b> <span dir="auto">{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</span>{p.client ? <> · <b>Client</b> <span dir="auto">{p.client}</span></> : null} · <b>Printed</b> {today()} · {counts.open} open, {counts.fixed} fixed, {counts.verified} verified</p>
      {live.length === 0 ? <p>No snag recorded.</p> : (
        <table>
          <thead><tr><th>#</th><th>Where</th><th>Snag</th><th>Trade</th><th>Who fixes</th><th>Due</th><th>Found</th><th>Fixed</th><th>Verified</th><th>Status</th></tr></thead>
          <tbody>{live.map(s => <tr key={s.id}><td>S-{s.snag_no}</td><td dir="auto">{s.area}</td><td dir="auto">{s.description}{s.fixed_note ? <div style={{ color: '#666' }}>{s.fixed_note}</div> : null}</td><td dir="auto">{s.trade}</td><td dir="auto">{s.vendor ?? s.assignee ?? ''}</td><td>{s.due ?? ''}</td><td>{s.found_at}</td><td>{s.fixed_at ?? ''}</td><td>{s.verified_at ?? ''}</td><td>{label(SNAG_STATUSES, s.status)}</td></tr>)}</tbody>
        </table>)}
      <div className="sigs">
        <div className="sig"><b>Client representative</b><div className="sd">Signature / date</div></div>
        <div className="sig"><b>Site engineer</b><div className="sd">Signature / date</div></div>
      </div>
      <div className="foot">Right Space Accounting · snags open and fixed are still to be verified before the handover certificate is signed.</div>
    </div>
  );
}
