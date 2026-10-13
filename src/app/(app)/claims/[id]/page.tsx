import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { TZ } from '@/lib/dates';
import { listAttachments } from '@/lib/attachments';
import { isProcurement } from '@/lib/purchasing';
import { projectAccounts } from '@/lib/boq';
import { canCertify, claimLineAmount, claimState, cumQty, subClaimFull } from '@/lib/claims';
import { Attachments } from '@/components/Attachments';
import { cancelClaimAction, priceClaimAction, raiseRequestAction, returnClaimAction, submitClaimAction } from '../actions';

const num = (v: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(v);

/** A subcontractor's progress claim in the shape of the company form, with the step it waits on and the actions of that step. */
export default async function ClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const full = await subClaimFull(id);
  if (!full) notFound();
  const { c, lines, prev, fig } = full;
  const [proc, certifier, files, log, codes] = await Promise.all([isProcurement(user), canCertify(user, c.project_id), listAttachments('claim', id),
    sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'claim' and g.entity_id = ${id} order by g.at`,
    projectAccounts(c.project_id)]);
  const finance = hasRole(user, 'finance');
  const open = ['draft', 'returned'].includes(c.status);
  const mayEdit = open && (certifier || c.created_by === user.id);
  const pricing = c.status === 'pricing' && proc;
  const mayCancel = !['requested', 'cancelled'].includes(c.status) && (c.created_by === user.id || proc || finance);
  const lastReturn = [...log].reverse().find(g => g.action === 'Returned for changes');
  const chain = [
    { key: 'engineer', name: 'Site engineer certifies', note: c.certified_at ? `✓ ${c.certified_by_name ?? ''} · ${c.certified_at}` : open ? 'Entering the quantities' : '—', cur: open },
    { key: 'pricing', name: 'Procurement prices', note: c.priced_at ? `✓ ${c.priced_by_name ?? ''} · ${c.priced_at}` : c.status === 'pricing' ? 'Waiting' : '—', cur: c.status === 'pricing' },
    { key: 'finance', name: 'Finance pays', note: c.request_no ? `✓ ${c.request_no} · ${claimState(c)}` : c.status === 'finance' ? 'Waiting for the payment request' : '—', cur: ['finance', 'requested'].includes(c.status) },
  ];
  const pillClass = c.status === 'requested' ? 'posted' : ['returned', 'cancelled'].includes(c.status) ? 'rejected' : c.status === 'draft' ? '' : 'pending';
  const table = (
    <div className="tw" style={{ marginBottom: 14 }}><table>
      <thead><tr><th>#</th><th>Item</th><th>Unit</th><th className="num">Rate</th><th className="num">Current</th><th className="num">Previous</th><th className="num">Cumulative</th><th className="num">Exec. %</th><th className="num">Amount</th><th className="hide-sm">Notes</th></tr></thead>
      <tbody>{lines.map(l => <tr key={l.id}><td className="mono">{l.line_no}</td><td dir="auto">{l.item}</td><td dir="auto">{l.unit}</td>
        <td className="num mono">{pricing ? <input className="inp mono" name={`rate_${l.id}`} inputMode="decimal" defaultValue={l.rate || ''} style={{ width: 95, textAlign: 'right' }} /> : fmt(l.rate)}</td>
        <td className="num mono">{num(l.current_qty)}</td><td className="num mono">{num(l.previous_qty)}</td><td className="num mono">{num(cumQty(l))}</td><td className="num mono">{num(l.pct)}%</td><td className="num mono">{fmt(claimLineAmount(l))}</td><td className="hide-sm" dir="auto">{l.notes}</td></tr>)}
        <tr className="tot"><td colSpan={8}><b>Total (الإجمالي)</b> <span className="muted" style={{ fontWeight: 400 }}>cumulative work certified to date</span></td><td className="num mono"><b>{fmt(fig.gross)}</b></td><td className="hide-sm"></td></tr>
        <tr><td colSpan={8}>Less previously paid (خصم ما سبق صرفه){prev.claimId ? <span className="muted"> · the earlier claims&apos; net</span> : null}</td><td className="num mono">{fmt(fig.previously_paid)}</td><td className="hide-sm"></td></tr>
        <tr><td colSpan={8}>Less advance recovered (خصم دفعة تعاقد) <span className="muted">· {fmt(fig.advance)} on this claim, {fmt(fig.advance_cum)} to date</span></td><td className="num mono">{fmt(fig.advance_cum)}</td><td className="hide-sm"></td></tr>
        <tr><td colSpan={8}>Less retention {c.retention_pct}% (خصم تأمين أعمال) <span className="muted">· held on the cumulative work</span></td><td className="num mono">{fmt(fig.retention)}</td><td className="hide-sm"></td></tr>
        <tr><td colSpan={8}>Total deductions</td><td className="num mono">{fmt(fig.deductions)}</td><td className="hide-sm"></td></tr>
        <tr className="tot"><td colSpan={8}><b>Net payable (المستحق للصرف)</b> <span className="muted" style={{ fontWeight: 400 }}>· this period&apos;s work {fmt(fig.period_work)} less its retention {fmt(fig.period_retention)} and the advance{c.vat_rate ? `; VAT ${c.vat_rate}% is added on the payment request` : ''}</span></td><td className="num mono"><b>{fmt(fig.net)}</b></td><td className="hide-sm"></td></tr>
      </tbody></table></div>
  );
  return (
    <>
      <div className="head">
        <div><h1>{c.no} <span className={'pill ' + pillClass}>{claimState(c)}</span></h1>
          <p dir="auto"><Link href={`/cost-centers/${c.project_id}`}>{c.code}</Link> · {c.vendor} · {c.wo_no ? <Link href={`/purchasing/work-orders/${c.work_order_id}`}>{c.wo_no}</Link> : 'no work order'} · interim claim {c.claim_no} · {c.date}{c.trade ? ` · ${c.trade}` : ''} · raised by {c.created_by_name ?? '—'}</p></div>
        <div className="row">
          {mayEdit && <Link className="btn" href={`/claims/new?edit=${id}`}>Edit</Link>}
          {mayEdit && <form action={submitClaimAction.bind(null, id)}><button className="btn pri">Certify and send to Procurement</button></form>}
          <a className="btn" href={`/print/claim/${id}`} target="_blank" rel="noreferrer">Print</a>
          {mayCancel && <form action={cancelClaimAction.bind(null, id)}><button className="btn bad">Cancel</button></form>}
          <Link className="btn" href="/claims">All claims</Link>
        </div>
      </div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {c.status === 'returned' && lastReturn && <div className="msg bad">Returned by {lastReturn.who}: {lastReturn.note || 'no reason given'}</div>}
      <div className="steps">{chain.map(s => <div key={s.key} className={s.cur ? 'cur' : ''}><b>{s.name}</b><div className="muted" style={{ fontSize: 13 }}>{s.note}</div></div>)}</div>
      {c.notes && <div className="card" dir="auto"><b>Notes:</b> {c.notes}</div>}
      {pricing ? (
        <form action={priceClaimAction.bind(null, id)}>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Pricing (Procurement)</h2>
            <p className="muted" style={{ fontSize: 13 }}>Type the rate of every item done this period (the work order&apos;s rates are filled in), pick the GL code the work posts to, and send the claim to Finance.</p>
            <div className="grid g4">
              <label className="f"><span>GL code (the project&apos;s copy)</span><select className="inp mono" name="account" defaultValue={c.account ?? ''}><option value="">Select…</option>{codes.map(x => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}</select></label>
              <label className="f"><span>Retention %</span><input className="inp mono" name="retention_pct" inputMode="decimal" defaultValue={c.retention_pct} /></label>
              <label className="f"><span>Advance recovered on this claim</span><input className="inp mono" name="advance" inputMode="decimal" defaultValue={c.advance} /></label>
              <label className="f"><span>VAT</span><select className="inp" name="vat_rate" defaultValue={String(c.vat_rate)}><option value="0">0%</option><option value="14">14%</option></select></label>
            </div>
          </div>
          {table}
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}><button className="btn" name="send" value="0">Save rates</button><button className="btn pri" name="send" value="1">Send to Finance</button></div>
        </form>
      ) : table}
      {(pricing || (c.status === 'finance' && finance)) && (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <form action={returnClaimAction.bind(null, id)} className="row" style={{ flex: 1 }}><input className="inp" name="reason" placeholder="Reason, if returning it to the engineer" style={{ flex: 1, minWidth: 180 }} /><button className="btn bad">Return to the engineer</button></form>
          {c.status === 'finance' && finance && <form action={raiseRequestAction.bind(null, id)}><button className="btn pri">Raise the payment request</button></form>}
        </div>)}
      {c.status === 'finance' && !finance && <div className="msg">With Finance: the payment request for {fmt(fig.net)}{c.vat_rate ? ' plus VAT' : ''} is raised from here, then approved by the Engineering head and Management and paid by bank transfer.</div>}
      {c.request_id && <div className="msg good">Payment request <Link href={`/payment-requests/${c.request_id}`}>{c.request_no}</Link>: {claimState(c)}{c.request_paid ? ` · paid ${fmt(c.request_paid)} of ${fmt(c.request_net ?? 0)}` : c.request_net != null ? ` · ${fmt(c.request_net)}` : ''}.</div>}
      <div className="grid g2">
        <div className="card"><h2 style={{ marginTop: 0 }}>Signatures</h2>
          <div className="grid g2"><div><div className="muted" style={{ fontSize: 12 }}>Supervising engineer (المهندس المشرف)</div><b>{c.certified_by_name ?? '—'}</b><div className="muted" style={{ fontSize: 12 }}>{c.certified_at ?? ''}</div></div>
            <div><div className="muted" style={{ fontSize: 12 }}>Contractor (المقاول)</div><b dir="auto">{c.vendor}</b><div className="muted" style={{ fontSize: 12 }}>signs the printed form</div></div></div></div>
        <div className="card"><h2 style={{ marginTop: 0 }}>Files</h2><p className="muted" style={{ fontSize: 13 }}>Photos of the work, the signed form, the subcontractor&apos;s own statement.</p>
          <Attachments entity="claim" id={id} path={`/claims/${id}`} items={files} userId={user.id} canRemove={proc || finance || c.created_by === user.id} locked={c.status === 'requested'} /></div>
      </div>
      <div className="card"><h2>History</h2><div className="log">{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? '—'} · {g.action}{g.note ? ' — ' + g.note : ''}</div>)}</div></div>
    </>
  );
}
