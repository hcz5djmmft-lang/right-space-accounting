import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { projectForToken } from '@/lib/client-link';
import { fmt, r2 } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { getSettings } from '@/lib/books';
import { today } from '@/lib/dates';
import { clientClaimFull } from '@/lib/claims';

// The client's progress claim (statement of work done against the BOQ) with the Right Space logo. Browser Print / Save as PDF.
export default async function PrintClientClaim({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> }) {
  // the client opens it from their client link (?c=<link>), for their own project's certified claims only
  const { c: link } = await searchParams;
  const client = link ? await projectForToken(link) : null;
  if (!client) await requireUser('finance', 'engineering', 'projects');
  const { id } = await params;
  const full = await clientClaimFull(id);
  if (!full || (client && (full.c.project_id !== client || !['certified', 'invoiced'].includes(full.c.status)))) notFound();
  const { c, lines, fig } = full;
  const s = await getSettings();
  const shown = lines.filter(l => l.pct > 0 || l.prev_pct > 0);
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
        .sd{color:#666;font-size:11px}.foot{margin-top:16px;color:#777;font-size:10px}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><img src="/logo.svg" alt="Right Space Development" style={{ height: 38 }} /><h1>Progress claim no. {c.claim_no}<small>مستخلص جارى رقم ( {c.claim_no} )</small></h1></div>
      <div className="meta">
        <div><b>Claim</b>{c.no} · {c.date}</div><div><b>Project</b><span dir="auto">{c.code}{c.project_name !== c.code ? ` · ${c.project_name}` : ''}</span></div>
        <div><b>Client</b><span dir="auto">{c.client ?? '—'}</span></div><div><b>Contract value</b>{c.contract ? fmt(c.contract) : '—'}</div>
        <div><b>Certified by</b>{c.certified_by_name ?? '—'}{c.certified_at ? ` · ${c.certified_at}` : ''}</div><div><b>Invoice</b>{c.invoice_no ?? '—'}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="n">Qty</th><th className="n">BOQ amount</th><th className="n">Previous %</th><th className="n">Done %</th><th className="n">Certified to date</th><th className="n">This claim</th></tr></thead>
        <tbody>
          {shown.map(l => <tr key={l.id}><td>{l.item_no}{l.vo_no ? ` (${l.vo_no})` : ''}</td><td dir="auto">{l.description}</td><td>{l.unit}</td><td className="n">{l.qty}</td><td className="n">{fmt(l.amount)}</td><td className="n">{l.prev_pct}%</td><td className="n">{l.pct}%</td><td className="n">{fmt(r2(l.pct / 100 * l.amount))}</td><td className="n">{fmt(r2((l.pct - l.prev_pct) / 100 * l.amount))}</td></tr>)}
          <tr className="tot"><td colSpan={7}>Total work certified to date</td><td className="n">{fmt(fig.gross)}</td><td className="n">{fmt(fig.period_work)}</td></tr>
          <tr><td colSpan={7}>Less previously certified</td><td className="n">{fmt(fig.previously_paid)}</td><td></td></tr>
          <tr><td colSpan={7}>Less advance recovered (this claim {fmt(fig.advance)})</td><td className="n">{fmt(fig.advance_cum)}</td><td></td></tr>
          <tr><td colSpan={7}>Less retention {c.retention_pct}% on the cumulative work</td><td className="n">{fmt(fig.retention)}</td><td></td></tr>
          <tr className="net"><td colSpan={7}>Due now (before VAT)</td><td className="n">{fmt(fig.net)}</td><td></td></tr>
        </tbody></table>
      <div className="words">{amountInWords(fig.net)}</div>
      {c.notes && <div className="box"><h3>Notes</h3><div dir="auto">{c.notes}</div></div>}
      <div className="sigs">
        <div className="sig"><b>For {s.company_name}</b><div>{c.certified_by_name ?? ' '}</div><div className="sd">{c.certified_at ? `Certified ${c.certified_at}` : 'Signature / date'}</div></div>
        <div className="sig"><b>Client</b><div> </div><div className="sd">Signature / date</div></div>
      </div>
      <div className="foot">Printed from Right Space · {today()}</div>
    </div>
  );
}
