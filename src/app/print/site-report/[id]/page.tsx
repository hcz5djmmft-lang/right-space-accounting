import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listAttachments } from '@/lib/attachments';
import { getSettings } from '@/lib/books';
import { REPORT_STATUSES, getReport, label, listManpower, listWork } from '@/lib/site';

// The daily site report as a one-page sheet for the client or the file: manpower, work done, materials, issues, photos.
export default async function PrintSiteReport({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const r = await getReport(id);
  if (!r) notFound();
  const [man, work, files, s] = await Promise.all([listManpower(id), listWork(id), listAttachments('site-report', id), getSettings()]);
  const photos = files.filter(f => f.mime_type.startsWith('image/') && f.mime_type !== 'image/heic');
  const hours = man.reduce((a, m) => a + m.headcount * m.hours, 0);
  return (
    <div className="po-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .po-print{font-size:12px;max-width:860px;margin:0 auto;padding:24px;color:#111}
        @media print{.po-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .po-print h1{font-size:20px;margin:0;text-align:right}.po-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:120px}
        .po-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.po-print th,.po-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .po-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .box{border:1px solid #cfc6b4;padding:8px;margin-bottom:12px}.box h3{margin:0 0 6px;font-size:12px}
        .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.photos img{width:100%;height:170px;object-fit:cover;border:1px solid #cfc6b4}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}.sd{color:#666;font-size:11px}.foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 38 }} /><h1>Daily site report {r.no}<small>تقرير الموقع اليومي</small></h1></div>
      <div className="meta">
        <div><b>Project (المشروع)</b><span dir="auto">{r.code}{r.project_name !== r.code ? ` · ${r.project_name}` : ''}</span></div><div><b>Day (التاريخ)</b>{r.day}</div>
        <div><b>Weather (الجو)</b>{r.weather || '—'}</div><div><b>Status</b>{label(REPORT_STATUSES, r.status)}{r.submitted_at ? ` · sent ${r.submitted_at} by ${r.submitted_by_name ?? ''}` : ''}</div>
        <div><b>Visitors (الزوار)</b><span dir="auto">{r.visitors || '—'}</span></div><div><b>Reviewed</b>{r.reviewed_at ? `${r.reviewed_at} · ${r.reviewed_by_name ?? ''}` : '—'}</div>
      </div>
      <table>
        <thead><tr><th>Trade (الحرفة)</th><th className="n">People (العدد)</th><th className="n">Hours each (الساعات)</th></tr></thead>
        <tbody>{man.map(m => <tr key={m.id}><td dir="auto">{m.trade}</td><td className="n">{m.headcount}</td><td className="n">{m.hours}</td></tr>)}
          <tr><td><b>Total manpower</b></td><td className="n"><b>{r.headcount}</b></td><td className="n">{hours} h</td></tr></tbody>
      </table>
      <div className="box"><h3>Work done (الأعمال المنفذة)</h3><div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{r.work_done || '—'}</div>{work.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{work.map(w => <li key={w.activity_id} dir="auto">{w.name}</li>)}</ul>}</div>
      {r.materials && <div className="box"><h3>Materials received (المواد الواردة)</h3><div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{r.materials}</div></div>}
      {r.issues && <div className="box"><h3>Issues, delays, safety (ملاحظات ومعوقات)</h3><div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{r.issues}</div></div>}
      {r.review_note && <div className="box"><h3>Engineer&apos;s note</h3><div dir="auto">{r.review_note}</div></div>}
      {photos.length > 0 && <div className="box"><h3>Photos ({photos.length})</h3><div className="photos">{photos.map(f => <img key={f.id} src={`/files/${f.id}`} alt={f.file_name} />)}</div></div>}
      <div className="sigs">
        <div className="sig"><b>Site engineer (مهندس الموقع)</b><div>{r.submitted_by_name ?? r.created_by_name ?? ' '}</div><div className="sd">{s.company_name}</div></div>
        <div className="sig"><b>Project manager (مدير المشروع)</b><div>{r.reviewed_by_name ?? ' '}</div><div className="sd">Signature / date</div></div>
      </div>
      <div className="foot">Right Space Accounting · {r.no} · {r.day}</div>
    </div>
  );
}
