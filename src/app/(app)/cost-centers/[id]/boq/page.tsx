import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { boqVsActual, getBoqLines, projectAccounts } from '@/lib/boq';
import { boqCodesAction, deleteBoqAction, uploadBoqAction } from './actions';

/** A project's BOQ against actual spending on each of its GL codes. */
export default async function ProjectBoq({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { id } = await params;
  const { error, ok } = await searchParams;
  const [p] = await sql<{ id: string; code: string; name: string; is_office: boolean }[]>`select id, code, name, is_office from projects where id = ${id}`;
  if (!p || p.is_office) notFound();
  const [cmp, accounts] = await Promise.all([boqVsActual(id), projectAccounts(id)]);
  const lines = cmp.boq ? await getBoqLines(cmp.boq.id) : [];
  const may = hasRole(user, 'finance', 'engineering');
  const unmatched = lines.filter(l => !l.account).length;
  const usedPct = cmp.total.boq ? Math.round((cmp.total.actual / cmp.total.boq) * 100) : null;
  return (
    <>
      <div className="head"><div><h1>BOQ · {p.code}</h1><p dir="auto">{p.name !== p.code ? p.name + ' · ' : ''}The BOQ is the budget for each of the project&apos;s GL codes; actual is what is posted on them, on order is what purchase orders still have to deliver and payment requests waiting for approval.</p></div>
        <Link className="btn" href={`/cost-centers/${id}`}>Back to the project</Link></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}

      {may && (
        <form action={uploadBoqAction.bind(null, id)} className="card row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
          <label className="f" style={{ flex: 1, minWidth: 220 }}><span>{cmp.boq ? 'Upload a new BOQ (replaces this one)' : 'Upload the BOQ'} · Excel .xlsx or CSV</span>
            <input className="inp" type="file" name="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required /></label>
          <button className="btn pri">Upload BOQ</button>
          <a className="btn" href="/boq-template.csv" download>Template</a>
        </form>)}
      {may && <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>The sheet needs a header row with Description and Amount (or Qty and Unit price), in English or Arabic (البيان، الكمية، الفئة، الإجمالي). A GL code column (22002) matches lines exactly; otherwise each line is matched by name and the rest are matched by hand below.</p>}

      {!cmp.boq && cmp.rows.length === 0 ? <div className="empty card">No BOQ uploaded and nothing spent on this project yet.</div> : (
        <>
          <div className="tiles">
            <div className="tile"><div className="k">BOQ{cmp.boq ? ` · ${cmp.boq.file_name}` : ''}</div><div className="v mono">{fmt(cmp.total.boq)}</div>{cmp.boq && <div className="muted" style={{ fontSize: 12 }}>{cmp.boq.uploaded_at}{cmp.boq.who ? ` · ${cmp.boq.who}` : ''}</div>}</div>
            <div className="tile"><div className="k">Actual{usedPct !== null ? ` · ${usedPct}% of BOQ` : ''}</div><div className="v mono">{fmt(cmp.total.actual)}</div></div>
            <div className="tile"><div className="k">On order</div><div className="v mono">{fmt(cmp.total.on_order)}</div></div>
            <div className="tile" style={cmp.total.remaining < 0 ? { borderColor: 'var(--bad)' } : undefined}><div className="k">Remaining</div><div className="v mono">{fmt(cmp.total.remaining)}</div></div>
          </div>
          <div className="tw" style={{ marginBottom: 14 }}><table>
            <thead><tr><th>GL code</th><th className="num">BOQ</th><th className="num">Actual</th><th className="num hide-sm">On order</th><th className="num">Remaining</th><th className="hide-sm">Used</th></tr></thead>
            <tbody>{cmp.rows.map(r => (
              <tr key={r.code ?? '_none'}><td dir="auto">{r.code ? <><Link className="mono" href={`/reports/ledger?account=${r.code}`}>{r.code}</Link> · {r.name}</> : <span className="muted">{r.name}</span>}</td>
                <td className="num">{r.boq ? fmt(r.boq) : <span className="muted">not in BOQ</span>}</td><td className="num">{fmt(r.actual)}</td><td className="num hide-sm">{r.on_order ? fmt(r.on_order) : ''}</td>
                <td className="num" style={r.remaining < 0 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{fmt(r.remaining)}</td>
                <td className="hide-sm" style={{ minWidth: 120 }}>{r.pct !== null && (
                  <div className="row" style={{ gap: 6 }}><div className="bar"><div style={{ width: `${Math.min(100, r.pct)}%`, background: r.pct > 100 ? 'var(--bad)' : r.pct > 85 ? 'var(--warn, #c9952f)' : 'var(--gold, #e5b35a)' }} /></div><span className="mono" style={{ fontSize: 12 }}>{r.pct}%</span></div>)}</td></tr>))}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{fmt(cmp.total.boq)}</td><td className="num">{fmt(cmp.total.actual)}</td><td className="num hide-sm">{fmt(cmp.total.on_order)}</td><td className="num">{fmt(cmp.total.remaining)}</td><td className="hide-sm"></td></tr></tfoot>
          </table></div>
        </>)}

      {lines.length > 0 && (
        <form action={boqCodesAction.bind(null, id)} className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>BOQ lines ({lines.length}{unmatched ? `, ${unmatched} not matched` : ''})</h2>
            {may && <button className="btn pri">Save GL codes</button>}
          </div>
          <div className="tw" style={{ marginTop: 10 }}><table>
            <thead><tr><th>#</th><th>Description</th><th className="hide-sm">Unit</th><th className="num hide-sm">Qty</th><th className="num hide-sm">Rate</th><th className="num">Amount</th><th>GL code</th></tr></thead>
            <tbody>{lines.map(l => (
              <tr key={l.id}><td className="mono">{l.item_no || l.line_no}</td><td dir="auto">{l.description}</td><td className="hide-sm">{l.unit}</td>
                <td className="num hide-sm">{Number(l.qty) || ''}</td><td className="num hide-sm">{l.rate ? fmt(l.rate) : ''}</td><td className="num">{fmt(l.amount)}</td>
                <td>{may ? (
                  <select className="inp" name={'acc_' + l.id} defaultValue={l.account ?? ''} style={{ minWidth: 180, ...(l.account ? {} : { borderColor: 'var(--bad)' }) }}>
                    <option value="">Not matched</option>{accounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>
                ) : <span className="mono">{l.account ?? '—'}</span>}</td></tr>))}</tbody>
          </table></div>
        </form>)}
      {may && cmp.boq && <form action={deleteBoqAction.bind(null, id)} style={{ textAlign: 'right' }}><button className="btn bad sm">Remove BOQ</button></form>}
    </>
  );
}
