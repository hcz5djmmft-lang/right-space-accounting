import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { getSettings } from '@/lib/books';
import { getInfo } from '@/lib/projects';
import { getHandover, listSnags, snagCounts } from '@/lib/site';

// The handover certificate (شهادة تسليم): project and client, contract and variations, the snag list's state, the defects period, two signatures.
export default async function PrintHandover({ params }: { params: Promise<{ project: string }> }) {
  await requireUser();
  const { project } = await params;
  const [p] = await sql<{ id: string; code: string; name: string; contract: number | null; client: string | null; vo: number }[]>`
    select p.id, p.code, p.name, p.contract::float contract, c.name client,
      coalesce((select sum(round(l.qty * l.rate, 2)) from variation_orders v join variation_lines l on l.vo_id = v.id where v.project_id = p.id and v.status = 'approved'), 0)::float vo
    from projects p left join parties c on c.id = p.client_id where p.id = ${project} and not p.is_office`;
  if (!p) notFound();
  const [h, counts, snags, info, s] = await Promise.all([getHandover(project), snagCounts(project), listSnags({ project }), getInfo(project), getSettings()]);
  if (!h) notFound();
  const d = (info?.data ?? {}) as Record<string, string | string[] | undefined>;
  const str = (k: string) => { const v = d[k]; return Array.isArray(v) ? v.join(', ') : (v ?? ''); };
  const outstanding = snags.filter(x => x.status === 'open' || x.status === 'fixed');
  return (
    <div className="po-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .po-print{font-size:12px;max-width:860px;margin:0 auto;padding:24px;color:#111}
        @media print{.po-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .po-print h1{font-size:20px;margin:0;text-align:right}.po-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:150px}
        .po-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.po-print th,.po-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .po-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .box{border:1px solid #cfc6b4;padding:8px;margin-bottom:12px}.box h3{margin:0 0 6px;font-size:12px}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}
        .sd{color:#666;font-size:11px}.foot{margin-top:16px;color:#777;font-size:10px}.draft{color:#b00;font-weight:700}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 38 }} /><h1>Handover certificate {h.no}<small>شهادة تسليم الأعمال</small></h1></div>
      {h.status !== 'signed' && <p className="draft">DRAFT — not yet signed</p>}
      <div className="meta">
        <div><b>Project (المشروع)</b><span dir="auto">{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</span></div><div><b>Handover date (تاريخ التسليم)</b>{h.date}</div>
        <div><b>Client (العميل)</b><span dir="auto">{p.client ?? (str('client_name') || '—')}</span></div><div><b>Unit (الوحدة)</b><span dir="auto">{[str('compound'), str('unit_no')].filter(Boolean).join(' · ') || '—'}</span></div>
        <div><b>Contract (قيمة العقد)</b>{fmt(p.contract)}{p.vo ? ` + variations ${fmt(p.vo)}` : ''}</div><div><b>Defects liability (فترة الضمان)</b>{h.defects_months} month{h.defects_months === 1 ? '' : 's'} from the handover date</div>
      </div>
      <div className="box"><h3>Declaration</h3>
        <p style={{ margin: 0 }}>{s.company_name} hereby hands over to the client the works of the project named above, completed in accordance with the contract, the approved drawings and the approved variation orders{outstanding.length || h.outstanding ? ', except for the outstanding items listed below, which the client accepts and which will be completed within the defects liability period' : ''}. The client acknowledges receipt of the unit and of the works on the date above. Defects appearing within the defects liability period will be made good by {s.company_name} at no cost to the client.</p></div>
      <div className="box"><h3>Snag list (قائمة الملاحظات)</h3>
        <p style={{ margin: '0 0 6px' }}>{counts.verified} verified · {counts.fixed} fixed, to verify · {counts.open} open{counts.cancelled ? ` · ${counts.cancelled} cancelled` : ''}.</p>
        {outstanding.length > 0 && <table><thead><tr><th>#</th><th>Where</th><th>Snag</th><th>Status</th></tr></thead><tbody>{outstanding.map(x => <tr key={x.id}><td>S-{x.snag_no}</td><td dir="auto">{x.area}</td><td dir="auto">{x.description}</td><td>{x.status}</td></tr>)}</tbody></table>}
      </div>
      {h.outstanding && <div className="box"><h3>Outstanding works accepted by the client (أعمال متبقية بموافقة العميل)</h3><div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{h.outstanding}</div></div>}
      {h.notes && <div className="box"><h3>Notes (ملاحظات)</h3><div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{h.notes}</div></div>}
      <div className="sigs">
        <div className="sig"><b>Client (العميل)</b><div dir="auto">{h.client_rep || ' '}</div><div className="sd">Signature / date</div></div>
        <div className="sig"><b>{s.company_name}</b><div>{h.company_rep ?? ' '}</div><div className="sd">{h.status === 'signed' ? `Signed ${h.signed_at} by ${h.signed_by_name ?? ''}` : 'Signature / stamp / date'}</div></div>
      </div>
      <div className="foot">{h.no} · drafted {h.created_at}{h.created_by_name ? ` by ${h.created_by_name}` : ''} · Right Space Accounting</div>
    </div>
  );
}
