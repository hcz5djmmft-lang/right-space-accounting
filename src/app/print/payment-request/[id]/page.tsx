import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { amountInWords, lineAmount } from '@/lib/ledger';
import { getSteps } from '@/lib/documents';
import { getPR, getPRApprovals, getPRLines } from '@/lib/pr-queries';
import { today } from '@/lib/dates';

// Printable payment request (إذن صرف), same layout as the old app's printout. Use the browser's Print / Save as PDF.
export default async function PrintPR({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const r = await getPR(id);
  if (!r) notFound();
  const [lines, approvals, steps, [v]] = await Promise.all([
    getPRLines(id), getPRApprovals(id), getSteps(),
    sql<{ full_name: string | null; bank_name: string | null; account_no: string | null; iban: string | null; swift: string | null }[]>`
      select full_name, bank_name, account_no, iban, swift from parties where id = ${r.party_id}`,
  ]);
  const ded = [[`Less withholding tax (${r.wht_rate}%)`, r.wht], [`Less social insurance (${r.si_rate}%)`, r.si], [`Less retention (${r.ret_rate}%)`, r.retention], ['Less down payment', r.dp_amount]] as const;
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
        .sigs{display:grid;grid-template-columns:repeat(${steps.length},1fr);gap:14px;margin-top:22px}.sig{border-top:1px solid #111;padding-top:5px;text-align:center}
        .sd{color:#666;font-size:11px}.foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><div className="logo">RIGHT <b>SPACE</b></div><h1>Payment Request<small>إذن صــرف</small></h1></div>
      <div className="meta">
        <div><b>Request no.</b>{r.no}</div><div><b>Date</b>{r.date}</div>
        <div><b>For</b><span dir="auto">{r.vendor}{v?.full_name && v.full_name !== r.vendor ? ' · ' + v.full_name : ''}</span></div><div><b>Vendor code</b>{r.vendor_code}</div>
        <div><b>Requester</b>{r.requester || r.created_by_name || '—'}</div><div><b>Assigned to</b>{r.cc ?? 'Per line'}</div>
        <div><b>Vendor inv. no.</b>{r.ref || '—'}</div><div><b>Budget type</b>{r.cost_type || '—'}</div>
      </div>
      <table><thead><tr><th>A/C code</th><th>A/C name</th><th>Description</th><th>Assigned to</th><th className="n">Amount (EGP)</th></tr></thead>
        <tbody>
          {lines.map((l, i) => <tr key={i}><td>{l.account}</td><td dir="auto">{l.name}</td><td dir="auto">{l.description}</td><td>{l.cc ?? r.cc}</td><td className="n">{fmt(lineAmount(l))}</td></tr>)}
          <tr><td colSpan={4}>Subtotal</td><td className="n">{fmt(r.subtotal)}</td></tr>
          {r.vat ? <tr><td colSpan={4}>VAT {r.vat_rate}%</td><td className="n">{fmt(r.vat)}</td></tr> : null}
          {ded.filter(d => d[1]).map(d => <tr key={d[0]}><td colSpan={4}>{d[0]}</td><td className="n">({fmt(d[1])})</td></tr>)}
          <tr className="tot"><td colSpan={4}>Net amount to pay</td><td className="n">{fmt(r.net)}</td></tr>
        </tbody></table>
      <div className="words">{amountInWords(r.net)}</div>
      <div className="cols">
        <div className="box"><h3>Transfer to</h3>
          {v?.bank_name && <div>Bank: {v.bank_name}</div>}{v?.account_no && <div>Account no.: {v.account_no}</div>}
          {v?.iban && <div>IBAN: {v.iban}</div>}{v?.swift && <div>SWIFT: {v.swift}</div>}
          {!v?.bank_name && !v?.iban && <div>Cash / no bank details on file</div>}</div>
        <div className="box"><h3>Status</h3>{r.status === 'posted' ? `Approved and posted (${r.entry_no})` : r.status === 'pending' ? `Waiting for ${steps[approvals.length]?.name}` : r.status}</div>
      </div>
      <div className="sigs">{steps.map((s, i) => <div className="sig" key={s.position}><b>{s.name}</b><div>{approvals[i]?.who ?? ' '}</div><div className="sd">{approvals[i]?.at.slice(0, 10) ?? 'Signature / date'}</div></div>)}</div>
      <div className="foot">Printed from Right Space Accounting · {today()}</div>
    </div>
  );
}
