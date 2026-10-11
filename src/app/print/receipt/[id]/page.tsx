import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fmt } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { getSettings } from '@/lib/books';
import { getReceipt, getReceiptAllocations } from '@/lib/collections';
import { today } from '@/lib/dates';

// Printable receipt for the client: a cash receipt (إيصال استلام نقدية) or a bank transfer receipt (إيصال تحويل بنكي). Use the browser's Print / Save as PDF.
export default async function PrintReceipt({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) notFound();
  const [alloc, settings] = await Promise.all([getReceiptAllocations(id), getSettings()]);
  const settled = alloc.reduce((s, a) => s + a.amount, 0);
  const advance = r.amount - settled;
  const cash = r.method === 'cash';
  const types = [...new Set(alloc.map(a => a.type).filter(Boolean))].join(', ');
  return (
    <div className="pr-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .pr-print{font-size:12px;max-width:820px;margin:0 auto;padding:24px;color:#111;position:relative}
        @media print{.pr-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .pr-print h1{font-size:18px;margin:0;text-align:right}.pr-print h1 small{display:block;font-size:15px;direction:rtl}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:12px}.meta div{display:flex;gap:8px}.meta b{min-width:120px}
        .amt{border:2px solid #e5b35a;background:#f4efe5;padding:10px 14px;margin:12px 0;display:flex;justify-content:space-between;align-items:baseline}
        .amt b{font-size:22px;font-variant-numeric:tabular-nums}.words{font-style:italic;margin:0 0 12px}
        .pr-print table{width:100%;border-collapse:collapse;margin-bottom:12px}.pr-print th,.pr-print td{border:1px solid #cfc6b4;padding:5px 7px;text-align:left;vertical-align:top;color:#111}
        .pr-print th{background:#f4efe5;font-size:11px;position:static}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.box{border:1px solid #cfc6b4;padding:8px}.box h3{margin:0 0 6px;font-size:12px}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}.sd{color:#666;font-size:11px}
        .void{position:absolute;left:0;right:0;top:40%;text-align:center;font-size:72px;color:#b3261e44;transform:rotate(-20deg);font-weight:700}
        .foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      {r.status === 'void' && <div className="void">VOID</div>}
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 34 }} />
        <h1>{cash ? 'Cash Receipt' : 'Bank Transfer Receipt'}<small>{cash ? 'إيصال استلام نقدية' : 'إيصال تحويل بنكي'}</small></h1></div>
      <div className="meta">
        <div><b>Receipt no.</b>{r.no}</div><div><b>Date</b>{r.date}</div>
        <div><b>Received from</b><span dir="auto">{r.customer_full || r.customer}</span></div>
        <div><b>Project</b>{r.project_code ? (r.project_name && r.project_name !== r.project_code ? `${r.project_code} · ${r.project_name}` : r.project_code) : '—'}</div>
        <div><b>For</b><span dir="auto">{r.memo || (types ? `${types} · ${alloc.map(a => a.no).join(', ')}` : alloc.length ? alloc.map(a => a.no).join(', ') : 'Advance on account')}</span></div>
        <div><b>{cash ? 'Received in' : 'Transfer ref.'}</b>{cash ? r.account_name : r.ref || '—'}</div>
      </div>
      <div className="amt"><span>Amount received{cash ? ' in cash' : ' by bank transfer'} (EGP)</span><b>{fmt(r.amount - r.wht)}</b></div>
      <div className="words">{amountInWords(r.amount - r.wht)}</div>
      {(alloc.length > 0 || r.wht > 0 || advance > 0.004) && (
        <table><thead><tr><th>Against</th><th>Type</th><th className="n">Invoice total</th><th className="n">Settled (EGP)</th></tr></thead>
          <tbody>
            {alloc.map(a => <tr key={a.invoice_id}><td>{a.no} · {a.date}</td><td>{a.type ?? '—'}</td><td className="n">{fmt(a.total)}</td><td className="n">{fmt(a.amount)}</td></tr>)}
            {advance > 0.004 && <tr><td colSpan={3}>Advance on account, not yet against an invoice</td><td className="n">{fmt(advance)}</td></tr>}
            {r.wht > 0 && <tr><td colSpan={3}>Of which withholding tax deducted at source by the client</td><td className="n">{fmt(r.wht)}</td></tr>}
          </tbody></table>)}
      <div className="cols">
        <div className="box"><h3>{cash ? 'Received in cash' : 'Received by bank transfer to'}</h3>
          {cash ? <div>{r.account_name}</div> : <>
            <div>{r.bank_name ?? r.account_name}{r.branch ? `, ${r.branch} branch` : ''}</div>
            {r.holder && <div>Account name: {r.holder}</div>}{r.account_no && <div>Account no.: {r.account_no}</div>}{r.iban && <div>IBAN: {r.iban}</div>}</>}
        </div>
        <div className="box"><h3>Issued by</h3><div>{settings.company_name}</div>{r.created_by_name && <div>{r.created_by_name} · Finance</div>}<div>Entry {r.entry_no ?? '—'}</div></div>
      </div>
      <div className="sigs"><div className="sig"><b>Received by</b><div className="sd">Signature / date</div></div><div className="sig"><b>Client</b><div className="sd">Signature / date</div></div></div>
      <div className="foot">Printed from Right Space Accounting · {today()}</div>
    </div>
  );
}
