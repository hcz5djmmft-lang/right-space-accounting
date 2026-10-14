import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { getSettings } from '@/lib/books';
import { today } from '@/lib/dates';
import { claimLineAmount, cumQty, subClaimFull } from '@/lib/claims';

const num = (v: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(v);

// The subcontractor's progress claim in the shape of the company form (مستخلص جارى), with the Right Space logo. Browser Print / Save as PDF.
export default async function PrintClaim({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const full = await subClaimFull(id);
  if (!full) notFound();
  const { c, lines, fig } = full;
  const s = await getSettings();
  return (
    <div className="po-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .po-print{font-size:12px;max-width:860px;margin:0 auto;padding:24px;color:#111}
        @media print{.po-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .po-print h1{font-size:20px;margin:0;text-align:right}.po-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:130px}
        .po-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.po-print th,.po-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .po-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .tot td{font-weight:700;background:#f4efe5}.net td{font-weight:700;background:#f2f2f2}.words{font-style:italic;margin:-6px 0 12px}
        .box{border:1px solid #cfc6b4;padding:8px;margin-bottom:12px}.box h3{margin:0 0 6px;font-size:12px}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}
        .sd{color:#666;font-size:11px}.foot{margin-top:16px;color:#777;font-size:10px}.ar{direction:rtl}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 38 }} /><h1>Interim progress claim no. {c.claim_no}<small>مستخلص جارى رقم ( {c.claim_no} )</small></h1></div>
      <div className="meta">
        <div><b>Claim</b>{c.no} · {c.date}</div><div><b>Project (المشروع)</b><span dir="auto">{c.code}{c.project_name !== c.code ? ` · ${c.project_name}` : ''}</span></div>
        <div><b>Subcontractor (المقاول)</b><span dir="auto">{c.vendor}</span></div><div><b>Trade (نوع الأعمال)</b><span dir="auto">{c.trade || c.wo_title || '—'}</span></div>
        <div><b>Work order</b>{c.wo_no ?? '—'}</div><div><b>Status</b>{c.request_no ? `Payment request ${c.request_no}` : c.status}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Item (البيان)</th><th>Unit (الوحدة)</th><th className="n">Rate (الفئة)</th><th className="n">Current (الحالي)</th><th className="n">Previous (السابق)</th><th className="n">Cumulative (الإجمالي)</th><th className="n">Exec. % (نسبة التنفيذ)</th><th className="n">Amount (القيمة)</th><th>Notes (ملاحظات)</th></tr></thead>
        <tbody>
          {lines.map(l => <tr key={l.id}><td>{l.line_no}</td><td dir="auto">{l.item}</td><td dir="auto">{l.unit}</td><td className="n">{fmt(l.rate)}</td><td className="n">{num(l.current_qty)}</td><td className="n">{num(l.previous_qty)}</td><td className="n">{num(cumQty(l))}</td><td className="n">{num(l.pct)}%</td><td className="n">{fmt(claimLineAmount(l))}</td><td dir="auto">{l.notes}</td></tr>)}
          <tr className="tot"><td colSpan={8}>Total (الإجمالي)</td><td className="n">{fmt(fig.gross)}</td><td></td></tr>
          <tr><td colSpan={8}>Less previously paid (خصم ما سبق صرفه)</td><td className="n">{fmt(fig.previously_paid)}</td><td></td></tr>
          <tr><td colSpan={8}>Less advance recovered (خصم دفعة تعاقد)</td><td className="n">{fmt(fig.advance_cum)}</td><td></td></tr>
          <tr><td colSpan={8}>Less retention {c.retention_pct}% (خصم {c.retention_pct}% تأمين أعمال)</td><td className="n">{fmt(fig.retention)}</td><td></td></tr>
          <tr><td colSpan={8}>Total deductions (إجمالي الخصومات)</td><td className="n">{fmt(fig.deductions)}</td><td></td></tr>
          <tr className="net"><td colSpan={8}>Net payable (المستحق للصرف)</td><td className="n">{fmt(fig.net)}</td><td></td></tr>
        </tbody></table>
      <div className="words">{amountInWords(fig.net)}</div>
      {c.notes && <div className="box"><h3>Notes</h3><div dir="auto">{c.notes}</div></div>}
      <div className="box"><h3>Processing</h3>
        Certified by {c.certified_by_name ?? '—'}{c.certified_at ? ` on ${c.certified_at}` : ''} · priced by {c.priced_by_name ?? '—'}{c.priced_at ? ` on ${c.priced_at}` : ''}{c.account ? ` · GL code ${c.account}` : ''}{c.vat_rate ? ` · VAT ${c.vat_rate}% on the payment request` : ''}{c.request_no ? ` · payment request ${c.request_no}` : ''}.</div>
      <div className="sigs">
        <div className="sig"><b>Contractor (المقاول)</b><div dir="auto">{c.vendor}</div><div className="sd">Signature / stamp / date</div></div>
        <div className="sig"><b>Supervising engineer (المهندس المشرف)</b><div>{c.certified_by_name ?? ' '}</div><div className="sd">{c.certified_at ? `Certified ${c.certified_at}` : 'Signature / date'} · {s.company_name}</div></div>
      </div>
      <div className="foot">Printed from Right Space · {today()}</div>
    </div>
  );
}
