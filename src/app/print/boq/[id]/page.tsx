import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { getSettings } from '@/lib/books';
import { today } from '@/lib/dates';
import { getEstimate } from '@/lib/qs';
import { MASTER } from '@/lib/qs-data';

// The client's BOQ (quotation): the Master BOQ items at client rates (dry rate ÷ 0.70), VAT apart, with the company logo.
// The dry cost, the risk and the margin never appear here. Use the browser's Print / Save as PDF.
export default async function PrintBoq({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('finance', 'engineering', 'projects');
  const { id } = await params;
  const e = await getEstimate(id);
  if (!e) notFound();
  const [s, [p], info] = await Promise.all([
    getSettings(),
    sql<{ client: string | null; unit: string | null; location: string | null }[]>`select coalesce(c.full_name, c.name) client, p.unit, p.location from projects p left join parties c on c.id = p.client_id where p.id = ${e.project_id}`,
    sql<{ data: Record<string, string> }[]>`select data from project_info where project_id = ${e.project_id}`,
  ]);
  const form = info[0]?.data ?? {};
  const client = form.client_name || p?.client || '';
  const c = e.calc;
  const rows = c.rows.filter(r => r.client_total > 0);
  return (
    <div className="po-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .po-print{font-size:12px;max-width:860px;margin:0 auto;padding:24px;color:#111}
        @media print{.po-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .po-print h1{font-size:20px;margin:0;text-align:right}.po-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:110px}
        .po-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.po-print th,.po-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .po-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .sec td{background:#f8f4ec;font-weight:700}.desc{direction:rtl;text-align:right;font-size:11px;min-width:280px}.wrap{overflow-x:auto}
        .tot td{font-weight:700;background:#f4efe5}.words{font-style:italic;margin:-6px 0 12px}
        .box{border:1px solid #cfc6b4;padding:8px;margin-bottom:12px}.box h3{margin:0 0 6px;font-size:12px}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}
        .sd{color:#666;font-size:11px}.foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 38 }} /><h1>Bill of Quantities<small>مقايسة أعمال التشطيبات</small></h1></div>
      <div className="meta">
        <div><b>Project</b><span dir="auto">{e.project_code}{e.project_name !== e.project_code ? ` · ${e.project_name}` : ''}</span></div><div><b>Date</b>{e.sent_at ?? e.updated_at.slice(0, 10)}</div>
        <div><b>Client</b><span dir="auto">{client || '—'}</span></div><div><b>Estimate</b>rev {e.rev}</div>
        {form.compound || p?.location ? <div><b>Location</b><span dir="auto">{form.compound || p?.location}</span></div> : null}
        {e.area || form.gross_area ? <div><b>Area</b>{e.area ?? form.gross_area} m²</div> : null}
      </div>
      <div className="wrap"><table><thead><tr><th>No.</th><th className="desc">البند والمواصفات</th><th>Unit</th><th className="n">Qty</th><th className="n">Rate (EGP)</th><th className="n">Total (EGP)</th></tr></thead>
        <tbody>
          {MASTER.sections.filter(sec => rows.some(r => r.section === sec.no)).map(sec => (
            <SectionRows key={sec.no} title={`${sec.no}. ${sec.title}`} rows={rows.filter(r => r.section === sec.no)} />))}
          <tr className="tot"><td colSpan={5}>Total before VAT</td><td className="n">{fmt(c.pricing.client)}</td></tr>
          {c.pricing.vat ? <tr><td colSpan={5}>VAT {c.pricing.vat_pct}%</td><td className="n">{fmt(c.pricing.vat)}</td></tr> : null}
          <tr className="tot"><td colSpan={5}>Total</td><td className="n">{fmt(c.pricing.total)}</td></tr>
        </tbody></table></div>
      <div className="words">{amountInWords(c.pricing.total)}</div>
      <div className="box"><h3>Terms</h3>{form.payment_terms ? <div dir="auto">{form.payment_terms}</div> : 'Prices in Egyptian pounds, valid for 30 days. Quantities are as measured on site; the final account follows the executed quantities at these rates.'}{form.advance ? <div>Advance payment: {form.advance}</div> : null}{form.retention_pct ? <div>Retention: {form.retention_pct} %</div> : null}</div>
      <div className="sigs">
        <div className="sig"><b>For {s.company_name}</b><div> </div><div className="sd">Signature / date</div></div>
        <div className="sig"><b>Client acceptance</b><div> </div><div className="sd">Signature / date</div></div>
      </div>
      <div className="foot">Printed from Right Space · {today()}</div>
    </div>
  );
}

const SectionRows = ({ title, rows }: { title: string; rows: { key: string; no: string; desc: string; unit: string; qty: number | null; client_rate: number; client_total: number }[] }) => <>
  <tr className="sec"><td colSpan={6} dir="auto">{title}</td></tr>
  {rows.map(r => <tr key={r.key}><td>{r.no}</td><td className="desc">{r.desc}</td><td dir="auto">{r.unit}</td><td className="n">{r.qty}</td><td className="n">{fmt(r.client_rate)}</td><td className="n">{fmt(r.client_total)}</td></tr>)}</>;
