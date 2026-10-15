import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { today } from '@/lib/dates';
import { quarterOf, whtCertificate } from '@/lib/tax-returns';
import { PrintBar } from '@/components/PrintBar';

// WHT certificate for a supplier (شهادة خصم من المنبع): the tax Right Space withheld from their invoices in the period.
// Use the browser's Print / Save as PDF.
export default async function PrintWht({ params, searchParams }: { params: Promise<{ party: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser('finance');
  const { party } = await params;
  const q = await searchParams;
  const qt = quarterOf(today());
  const from = q.from || qt.from, to = q.to || qt.to;
  const c = await whtCertificate(party, from, to);
  if (!c) notFound();
  return (
    <div className="pr-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .pr-print{font-size:12px;max-width:820px;margin:0 auto;padding:24px;color:#111}
        @media print{.pr-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .pr-print h1{font-size:18px;margin:0;text-align:right}.pr-print h1 small{display:block;font-size:15px;direction:rtl}
        .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px}.box{border:1px solid #cfc6b4;padding:8px}.box h3{margin:0 0 6px;font-size:12px}
        .pr-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.pr-print th,.pr-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;color:#111}
        .pr-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .amt{border:2px solid #e5b35a;background:#f4efe5;padding:10px 14px;margin:12px 0;display:flex;justify-content:space-between;align-items:baseline}.amt b{font-size:20px}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}.sd{color:#666;font-size:11px}
        .foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <PrintBar />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 34 }} />
        <h1>Withholding Tax Certificate<small>شهادة خصم ضريبة من المنبع</small></h1></div>
      <p>Period <b>{from}</b> to <b>{to}</b></p>
      <div className="cols">
        <div className="box"><h3>Withheld by (الجهة الخاصمة)</h3><div>{c.company}</div><div>Tax registration no.: {c.companyTaxId || '—'}</div></div>
        <div className="box"><h3>Withheld from (المخصوم منه)</h3><div dir="auto">{c.party.full_name || c.party.name}</div><div>Tax registration no.: {c.party.tax_id || '—'}</div></div>
      </div>
      <table><thead><tr><th>Document</th><th>Date</th><th>Vendor ref.</th><th className="n">Amount before tax (EGP)</th><th className="n">Rate</th><th className="n">Tax withheld (EGP)</th></tr></thead>
        <tbody>{c.lines.map(l => <tr key={l.id}><td>{l.no}</td><td>{l.date}</td><td>{l.ref || '—'}</td><td className="n">{fmt(l.base)}</td><td className="n">{l.rate}%</td><td className="n">{fmt(l.wht)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={3}><b>Total</b></td><td className="n"><b>{fmt(c.base)}</b></td><td></td><td className="n"><b>{fmt(c.wht)}</b></td></tr></tfoot>
      </table>
      <div className="amt"><span>Total tax withheld and paid to the Egyptian Tax Authority (EGP)</span><b>{fmt(c.wht)}</b></div>
      <div style={{ fontStyle: 'italic' }}>{amountInWords(c.wht)}</div>
      <div className="sigs"><div className="sig"><b>Finance</b><div className="sd">Signature / stamp / date</div></div><div className="sig"><b>Management</b><div className="sd">Signature / date</div></div></div>
      <div className="foot">Printed from Right Space · {today()}</div>
    </div>
  );
}
