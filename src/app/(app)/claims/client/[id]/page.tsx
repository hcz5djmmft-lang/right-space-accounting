import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt, r2 } from '@/lib/money';
import { TZ, today } from '@/lib/dates';
import { collectionTypes } from '@/lib/collections';
import { canCertify, canEngineer, clientClaimFull, clientClaimState } from '@/lib/claims';
import { cancelClientAction, certifyClientAction, invoiceClientAction } from '../../actions';

/** A client progress claim: the work certified per BOQ line, the retention and advance, what is due now, and Finance's invoice. */
export default async function ClientClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const full = await clientClaimFull(id);
  if (!full) notFound();
  const { c, lines, prev, fig } = full;
  const [certifier, types, log] = await Promise.all([canCertify(user, c.project_id), collectionTypes(),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'client-claim' and g.entity_id = ${id} order by g.at`]);
  const finance = hasRole(user, 'finance');
  const mayEdit = c.status === 'draft' && (certifier || finance || c.created_by === user.id);
  const mayCancel = !['invoiced', 'cancelled'].includes(c.status) && (c.created_by === user.id || finance || canEngineer(user));
  const progressed = lines.filter(l => l.pct > l.prev_pct);
  const chain = [
    { key: 'eng', name: 'Engineer certifies', note: c.certified_at ? `✓ ${c.certified_by_name ?? ''} · ${c.certified_at}` : 'Entering the % done', cur: c.status === 'draft' },
    { key: 'fin', name: 'Finance invoices', note: c.invoice_no ? `✓ ${c.invoice_no} · ${c.invoice_status}` : c.status === 'certified' ? 'Waiting' : '—', cur: c.status === 'certified' },
    { key: 'col', name: 'Client pays', note: c.collected ? `${fmt(c.collected)} collected of ${fmt(c.invoice_total ?? 0)}` : c.status === 'invoiced' ? 'Waiting' : '—', cur: c.status === 'invoiced' },
  ];
  const pillClass = c.status === 'invoiced' ? 'posted' : c.status === 'cancelled' ? 'rejected' : c.status === 'draft' ? '' : 'pending';
  return (
    <>
      <div className="head">
        <div><h1>{c.no} <span className={'pill ' + pillClass}>{clientClaimState(c)}</span></h1>
          <p dir="auto"><Link href={`/cost-centers/${c.project_id}`}>{c.code}</Link> · {c.client ?? 'no customer set'} · claim {c.claim_no} · {c.date} · contract {c.contract ? fmt(c.contract) : '—'} · raised by {c.created_by_name ?? '—'}</p></div>
        <div className="row">
          {mayEdit && <Link className="btn" href={`/claims/client/new?edit=${id}`}>Edit</Link>}
          {mayEdit && certifier && <form action={certifyClientAction.bind(null, id)}><button className="btn pri">Certify and send to Finance</button></form>}
          <a className="btn" href={`/print/client-claim/${id}`} target="_blank" rel="noreferrer">Print</a>
          {mayCancel && <form action={cancelClientAction.bind(null, id)}><button className="btn bad">Cancel</button></form>}
          <Link className="btn" href="/claims?tab=client">All claims</Link>
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      <div className="steps">{chain.map(s => <div key={s.key} className={s.cur ? 'cur' : ''}><b>{s.name}</b><div className="muted" style={{ fontSize: 13 }}>{s.note}</div></div>)}</div>
      {c.notes && <div className="card" dir="auto"><b>Notes:</b> {c.notes}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Work certified to date</div><div className="v mono">{fmt(fig.gross)}</div>{c.contract ? <div className="muted" style={{ fontSize: 12 }}>{Math.round(fig.gross / c.contract * 1000) / 10}% of the contract</div> : null}</div>
        <div className="tile"><div className="k">This period</div><div className="v mono">{fmt(fig.period_work)}</div><div className="muted" style={{ fontSize: 12 }}>{progressed.length} line{progressed.length === 1 ? '' : 's'} progressed</div></div>
        <div className="tile"><div className="k">Retention {c.retention_pct}% held by the client</div><div className="v mono">{fmt(fig.retention)}</div></div>
        <div className="tile"><div className="k">Due now</div><div className="v mono">{fmt(fig.net)}</div><div className="muted" style={{ fontSize: 12 }}>work {fmt(fig.period_work)} less retention {fmt(fig.period_retention)} and advance {fmt(fig.advance)}</div></div>
      </div>
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>Item</th><th>Description</th><th className="hide-sm">Unit</th><th className="num hide-sm">Qty</th><th className="num">BOQ amount</th><th className="num hide-sm">Previous %</th><th className="num">% done</th><th className="num">Certified to date</th><th className="num hide-sm">This period</th></tr></thead>
        <tbody>{lines.map(l => <tr key={l.id} style={l.pct > l.prev_pct ? { fontWeight: 600 } : undefined}><td className="mono">{l.item_no}{l.vo_no ? <span className="pill pending" style={{ marginLeft: 4 }}>{l.vo_no}</span> : null}</td><td dir="auto">{l.description}</td><td className="hide-sm">{l.unit}</td><td className="num mono hide-sm">{l.qty}</td>
          <td className="num mono">{fmt(l.amount)}</td><td className="num mono hide-sm">{l.prev_pct}%</td><td className="num mono">{l.pct}%</td><td className="num mono">{fmt(r2(l.pct / 100 * l.amount))}</td><td className="num mono hide-sm">{fmt(r2((l.pct - l.prev_pct) / 100 * l.amount))}</td></tr>)}
          <tr className="tot"><td colSpan={7}><b>Total certified to date</b></td><td className="num mono"><b>{fmt(fig.gross)}</b></td><td className="num mono hide-sm"><b>{fmt(fig.period_work)}</b></td></tr>
          <tr><td colSpan={7}>Less previously certified{prev.claimId ? '' : ' (first claim)'}</td><td className="num mono">{fmt(fig.previously_paid)}</td><td className="hide-sm"></td></tr>
          <tr><td colSpan={7}>Less advance recovered <span className="muted">· {fmt(fig.advance)} on this claim, {fmt(fig.advance_cum)} to date</span></td><td className="num mono">{fmt(fig.advance_cum)}</td><td className="hide-sm"></td></tr>
          <tr><td colSpan={7}>Less retention {c.retention_pct}% on the cumulative work</td><td className="num mono">{fmt(fig.retention)}</td><td className="hide-sm"></td></tr>
          <tr className="tot"><td colSpan={7}><b>Due now</b> <span className="muted" style={{ fontWeight: 400 }}>· before VAT</span></td><td className="num mono"><b>{fmt(fig.net)}</b></td><td className="hide-sm"></td></tr>
        </tbody></table></div>
      {c.status === 'certified' && finance && (
        <form action={invoiceClientAction.bind(null, id)} className="card">
          <h2 style={{ marginTop: 0 }}>Invoice the client (Finance)</h2>
          <p className="muted" style={{ fontSize: 13 }}>A draft sales invoice for this period&apos;s work, {fmt(fig.period_work)} before VAT, on the revenue code of the type chosen. The retention and the advance stay open on it until the client settles them.</p>
          <div className="grid g3" style={{ alignItems: 'end' }}>
            <label className="f"><span>Type</span><select className="inp" name="category" defaultValue={types.find(t => t.id === 'fitout')?.id ?? types[0]?.id ?? ''}>{types.map(t => <option key={t.id} value={t.id}>{t.name} · {t.account}</option>)}</select></label>
            <label className="f"><span>VAT</span><select className="inp" name="vat_rate" defaultValue="14"><option value="14">14%</option><option value="0">0%</option></select></label>
            <label className="f"><span>Invoice date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Invoice the client</button></div>
        </form>)}
      {c.status === 'certified' && !finance && <div className="msg">With Finance to invoice {fmt(fig.period_work)} before VAT.</div>}
      {c.invoice_id && <div className="msg good">Sales invoice <Link href={`/sales-invoices/${c.invoice_id}`}>{c.invoice_no}</Link> · {c.invoice_status}{c.invoice_total != null ? ` · ${fmt(c.invoice_total)} with VAT` : ''}{c.collected ? ` · ${fmt(c.collected)} collected` : ''}.</div>}
      <div className="card"><h2>History</h2><div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? '—'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
