import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { amountInWords, lineAmount } from '@/lib/ledger';
import { getPurchaseApprovals, getPurchaseLines, getPurchaseRequest, poFigures } from '@/lib/purchasing';
import { getSettings } from '@/lib/books';
import { today } from '@/lib/dates';

// Printable purchase order with the company logo, to send to the vendor. Use the browser's Print / Save as PDF.
export default async function PrintPO({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const r = await getPurchaseRequest(id);
  if (!r || r.status !== 'approved') notFound();
  const [lines, approvals, s, [v]] = await Promise.all([
    getPurchaseLines(id), getPurchaseApprovals(id), getSettings(),
    sql<{ full_name: string | null; phone: string | null; email: string | null; tax_id: string | null }[]>`select full_name, phone, email, tax_id from parties where id = ${r.vendor_id}`,
  ]);
  const fig = poFigures(lines);
  const vat = Math.round(fig.ordered * r.vat_rate) / 100;
  const total = Math.round((fig.ordered + vat) * 100) / 100;
  const mgmt = approvals.find(a => a.step === 'management');
  return (
    <div className="po-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .po-print{font-size:12px;max-width:820px;margin:0 auto;padding:24px;color:#111}
        @media print{.po-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .po-print h1{font-size:20px;margin:0;text-align:right}.po-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:110px}
        .po-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.po-print th,.po-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .po-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .tot td{font-weight:700;background:#f4efe5}.words{font-style:italic;margin:-6px 0 12px}
        .box{border:1px solid #cfc6b4;padding:8px;margin-bottom:12px}.box h3{margin:0 0 6px;font-size:12px}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}
        .sd{color:#666;font-size:11px}.foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 38 }} /><h1>Purchase Order<small>أمر شراء</small></h1></div>
      <div className="meta">
        <div><b>PO no.</b>{r.po_no}</div><div><b>Date</b>{r.po_date}</div>
        <div><b>To</b><span dir="auto">{v?.full_name || r.vendor}</span></div><div><b>Request</b>{r.no}</div>
        <div><b>Deliver for</b>{r.cc}</div><div><b>Needed by</b>{r.needed_by ?? '—'}</div>
        {v?.phone || v?.email ? <div><b>Vendor contact</b>{[v.phone, v.email].filter(Boolean).join(' · ')}</div> : null}
        {v?.tax_id ? <div><b>Vendor tax no.</b>{v.tax_id}</div> : null}
      </div>
      <table><thead><tr><th>#</th><th>Item</th><th>Details</th><th className="n">Qty</th><th>Unit</th><th className="n">Unit price</th><th className="n">Amount (EGP)</th></tr></thead>
        <tbody>
          {lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td dir="auto">{l.name ?? ''}{l.name_ar ? ` · ${l.name_ar}` : ''}</td><td dir="auto">{l.description}</td><td className="n">{Number(l.qty)}</td><td>{l.unit}</td><td className="n">{fmt(l.price)}</td><td className="n">{fmt(lineAmount(l))}</td></tr>)}
          <tr><td colSpan={6}>Subtotal</td><td className="n">{fmt(fig.ordered)}</td></tr>
          {vat ? <tr><td colSpan={6}>VAT {r.vat_rate}%</td><td className="n">{fmt(vat)}</td></tr> : null}
          <tr className="tot"><td colSpan={6}>Total</td><td className="n">{fmt(total)}</td></tr>
        </tbody></table>
      <div className="words">{amountInWords(total)}</div>
      {r.notes && <div className="box"><h3>Notes</h3><div dir="auto">{r.notes}</div></div>}
      <div className="box"><h3>Terms</h3>Please quote PO no. {r.po_no} on your delivery note and invoice. Payment by bank transfer against your invoice for the quantities delivered.</div>
      <div className="sigs">
        <div className="sig"><b>For {s.company_name}</b><div>{mgmt?.who ?? ' '}</div><div className="sd">{mgmt ? `Approved ${mgmt.at}` : 'Signature / date'}</div></div>
        <div className="sig"><b>Vendor acceptance</b><div> </div><div className="sd">Signature / stamp / date</div></div>
      </div>
      <div className="foot">Printed from Right Space Accounting · {today()}</div>
    </div>
  );
}
