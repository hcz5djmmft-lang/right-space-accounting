import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { amountInWords, lineAmount } from '@/lib/ledger';
import { getSettings } from '@/lib/books';
import { getInvoice, getInvoiceLines } from '@/lib/sales-queries';
import { today } from '@/lib/dates';

// Printable sales invoice for the client. Use the browser's Print / Save as PDF.
export default async function PrintInvoice({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const r = await getInvoice(id);
  if (!r) notFound();
  const [lines, settings, [c], bank] = await Promise.all([
    getInvoiceLines(id), getSettings(),
    sql<{ full_name: string | null; tax_id: string | null; email: string | null; phone: string | null }[]>`select full_name, tax_id, email, phone from parties where id = ${r.party_id}`,
    sql<{ name: string }[]>`select name from accounts where is_bank and postable and code <> 'A110' order by code limit 1`,
  ]);
  return (
    <div className="pr-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .pr-print{font-size:12px;max-width:820px;margin:0 auto;padding:24px;color:#111}
        @media print{.pr-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .logo{font-family:Montserrat,sans-serif;font-weight:700;font-size:20px;letter-spacing:.05em}.logo b{color:#c9952f}
        .pr-print h1{font-size:18px;margin:0;text-align:right}.pr-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:110px}
        .pr-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.pr-print th,.pr-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .pr-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .tot td{font-weight:700;background:#f4efe5}.words{font-style:italic;margin:-6px 0 12px}
        .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.box{border:1px solid #cfc6b4;padding:8px}.box h3{margin:0 0 6px;font-size:12px}
        .void{position:absolute;left:0;right:0;top:40%;text-align:center;font-size:72px;color:#b3261e44;transform:rotate(-20deg);font-weight:700}
        .foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      {r.status === 'void' && <div className="void">VOID</div>}
      <div className="top"><div className="logo">RIGHT <b>SPACE</b></div><h1>Invoice<small>فاتورة</small></h1></div>
      <div className="meta">
        <div><b>Invoice no.</b>{r.no}</div><div><b>Date</b>{r.date}</div>
        <div><b>Bill to</b><span dir="auto">{c?.full_name || r.customer}</span></div><div><b>Due</b>{r.due ?? '—'}</div>
        <div><b>Customer tax ID</b>{c?.tax_id || '—'}</div><div><b>Project</b>{r.project_code ? (r.project_name && r.project_name !== r.project_code ? `${r.project_code} · ${r.project_name}` : r.project_code) : '—'}</div>
        <div><b>Reference</b>{r.ref || '—'}</div><div><b>From</b>{settings.company_name}</div>
      </div>
      <table><thead><tr><th>#</th><th>Description</th><th className="n">Qty</th><th className="n">Unit price</th><th className="n">Amount (EGP)</th></tr></thead>
        <tbody>
          {lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td dir="auto">{l.description || l.name}</td><td className="n">{l.qty}</td><td className="n">{fmt(l.price)}</td><td className="n">{fmt(lineAmount(l))}</td></tr>)}
          <tr><td colSpan={4}>Subtotal</td><td className="n">{fmt(r.subtotal)}</td></tr>
          {r.vat ? <tr><td colSpan={4}>VAT {r.vat_rate}%</td><td className="n">{fmt(r.vat)}</td></tr> : null}
          <tr className="tot"><td colSpan={4}>Total due</td><td className="n">{fmt(r.total)}</td></tr>
        </tbody></table>
      <div className="words">{amountInWords(r.total)}</div>
      <div className="cols">
        <div className="box"><h3>Payment</h3><div>Please transfer to {bank[0]?.name ?? 'our bank account'} quoting {r.no}.</div>{r.received ? <div>Received so far: {fmt(r.received)} · open {fmt(r.total - r.received)}</div> : null}</div>
        <div className="box"><h3>Contact</h3><div>{c?.email || ''}</div><div>{c?.phone || ''}</div></div>
      </div>
      <div className="foot">Printed from Right Space Accounting · {today()}</div>
    </div>
  );
}
