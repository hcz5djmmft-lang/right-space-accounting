import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { getVoucher } from '@/lib/petty-vouchers';

// Printable petty cash voucher (إذن صرف نقدية): paid in cash from the office safe, signed by the person who received it.
export default async function PrintPettyCash({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('finance');
  const { id } = await params;
  const v = await getVoucher(id);
  if (!v) notFound();
  return (
    <div className="pr-print">
      <style>{`
        @page{size:A5 landscape;margin:12mm} body{background:#fff;color:#111}
        .pr-print{font-size:12px;max-width:820px;margin:0 auto;padding:24px;color:#111;position:relative}
        @media print{.pr-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .pr-print h1{font-size:18px;margin:0;text-align:right}.pr-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:110px}
        .amt{border:2px solid #e5b35a;background:#f4efe5;padding:10px 14px;margin:12px 0;display:flex;justify-content:space-between;align-items:baseline}
        .amt b{font-size:22px;font-variant-numeric:tabular-nums}.words{font-style:italic;margin:0 0 12px}
        .sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:40px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}
        .void{position:absolute;left:0;right:0;top:40%;text-align:center;font-size:72px;color:#b3261e44;transform:rotate(-20deg);font-weight:700}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      {v.voided && <div className="void">VOID</div>}
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 34 }} />
        <h1>Petty Cash Voucher<small>إذن صرف نقدية</small></h1></div>
      <div className="meta">
        <div><b>Voucher no.</b>{v.ref ?? v.no}</div><div><b>Date</b>{v.date}</div>
        <div><b>Paid to</b><span dir="auto">{v.paid_to}</span></div><div><b>Project / dept.</b>{v.cc ?? '—'}</div>
        <div><b>For</b><span dir="auto">{v.purpose}</span></div><div><b>GL code</b>{v.account} · <span dir="auto">{v.account_name}</span></div>
        <div><b>Paid from</b>Office cash</div><div><b>Entry</b>{v.no}</div>
      </div>
      <div className="amt"><span>Amount paid in cash (EGP)</span><b>{fmt(v.amount)}</b></div>
      <div className="words">{amountInWords(v.amount)}</div>
      <div className="sigs"><div className="sig">Received by · المستلم</div><div className="sig">Accountant · المحاسب</div><div className="sig">Approved · الاعتماد</div></div>
    </div>
  );
}
