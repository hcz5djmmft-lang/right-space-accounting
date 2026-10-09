import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { fmt, r2 } from '@/lib/money';
import { amountInWords } from '@/lib/ledger';
import { loadTender } from '@/lib/tenders';
import { clientRows, tenderTotals } from '@/lib/tender-calc';

// Printable tender offer for the client: summary by trade, then the priced BOQ per trade.
export default async function PrintTender({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('tenders');
  const { id } = await params;
  const t = await loadTender(id);
  if (!t) notFound();
  const T = tenderTotals(t);
  const rows = clientRows(t);
  const groups = t.trades.map(tr => { const rs = rows.filter(r => r.tr.id === tr.id); return { tr, rows: rs, sum: r2(rs.reduce((s, r) => s + (r.amt ?? 0), 0)) }; });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="pr-print">
      <style>{`
        @page{size:A4;margin:14mm} body{background:#fff;color:#111}
        .pr-print{font-size:11.5px;max-width:900px;margin:0 auto;padding:24px;color:#111}
        @media print{.pr-print{padding:0;max-width:none}.noprint{display:none}}
        .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e5b35a;padding-bottom:10px;margin-bottom:14px}
        .logo{font-family:Montserrat,sans-serif;font-weight:700;font-size:20px;letter-spacing:.05em}.logo b{color:#c9952f}
        .pr-print h1{font-size:18px;margin:0;text-align:right}.pr-print h1 small{display:block;font-size:13px;font-weight:500}.pr-print h2{font-size:13px;margin:16px 0 6px}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px}
        .pr-print table{width:100%;border-collapse:collapse}.pr-print th,.pr-print td{border:1px solid #cfc6b4;padding:4px 6px;text-align:left;vertical-align:top;color:#111}
        .pr-print th{background:#f4efe5;font-size:10.5px;position:static}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.tot td{font-weight:700;background:#f4efe5}
      `}</style>
      <p className="noprint"><button className="btn pri" id="pp">Print / save as PDF</button></p>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('pp').onclick=()=>window.print()" }} />
      <div className="top"><div className="logo">RIGHT <b>SPACE</b></div><h1>Tender offer<small>{t.no}</small></h1></div>
      <div className="meta"><div><b>Project:</b> <span dir="auto">{t.name}</span></div><div><b>Date:</b> {today}</div><div><b>Client:</b> <span dir="auto">{t.client ?? ''}</span></div><div><b>Location:</b> <span dir="auto">{t.location}</span></div></div>
      <h2>Summary</h2>
      <table><thead><tr><th>Trade</th><th className="n">Amount (EGP)</th></tr></thead>
        <tbody>{groups.map(g => <tr key={g.tr.id}><td dir="auto">{g.tr.name}</td><td className="n">{fmt(g.sum)}</td></tr>)}
          <tr className="tot"><td>Total before VAT</td><td className="n">{fmt(T.client)}</td></tr><tr><td>VAT {t.vat}%</td><td className="n">{fmt(T.vat)}</td></tr><tr className="tot"><td>Total incl. VAT</td><td className="n">{fmt(T.client + T.vat)}</td></tr></tbody></table>
      <p><i>{amountInWords(r2(T.client + T.vat))}</i></p>
      {groups.map(g => (
        <div key={g.tr.id}><h2 dir="auto">{g.tr.name}</h2>
          <table><thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="n">Qty</th><th className="n">Unit price</th><th className="n">Amount</th></tr></thead>
            <tbody>{g.rows.map(r => <tr key={r.it.id}><td>{r.it.no}</td><td dir="auto">{r.it.description}</td><td dir="auto">{r.it.unit}</td><td className="n">{r.it.qty !== null ? fmt(r.it.qty) : ''}</td><td className="n">{r.cr === null ? '—' : fmt(r.cr)}</td><td className="n">{r.amt === null ? '—' : fmt(r.amt)}</td></tr>)}
              <tr className="tot"><td colSpan={5}>Total {g.tr.name}</td><td className="n">{fmt(g.sum)}</td></tr></tbody></table></div>))}
      <p style={{ color: '#777', fontSize: 10, marginTop: 16 }}>Right Space Development · prepared {today}</p>
    </div>
  );
}
