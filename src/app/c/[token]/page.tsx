import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { clientView, projectForToken } from '@/lib/client-link';
import { fmt } from '@/lib/money';
import { phaseLabel } from '@/lib/projects';
import { SignaturePad } from '@/components/SignaturePad';
import { answerConceptAction, answerVariationAction, signHandoverAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Right Space · your project', robots: { index: false, follow: false } };

const VO_STATE: Record<string, string> = { sent: 'Waiting for your answer', approved: 'Approved', rejected: 'Declined' };

/** The client's page (improvement 2): opened from the secret link Right Space sends, no login. */
export default async function ClientPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { token } = await params;
  const { ok, error } = await searchParams;
  const projectId = await projectForToken(token, true);
  if (!projectId) notFound();
  const v = await clientView(projectId);
  const p = v.project;
  const due = v.invoices.reduce((t, i) => t + i.open, 0);
  const waiting = v.vos.filter(x => x.status === 'sent').length + v.concepts.filter(c => c.status === 'client').length + (v.handover && !v.handover.client_signed_at ? 1 : 0);
  const nameField = <label className="f"><span>Your name (الاسم)</span><input className="inp" name="name" autoComplete="name" /></label>;
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '16px 16px 48px' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <img src="/logo.svg" alt="Right Space Development" style={{ height: 40 }} />
        <span className="muted" style={{ fontSize: 13 }}>Client page · صفحة العميل</span>
      </div>
      <div className="head"><div><h1 dir="auto">{p.name}</h1><p dir="auto">{p.code}{p.client ? ` · ${p.client}` : ''}{p.phase ? ` · ${phaseLabel(p.phase)}` : ''}</p></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}

      <div className="tiles">
        {p.contract ? <div className="tile"><div className="k">Contract (قيمة العقد)</div><div className="v mono">{fmt(p.contract)}</div></div> : null}
        <div className="tile"><div className="k">Invoiced (الفواتير)</div><div className="v mono">{fmt(v.invoices.reduce((t, i) => t + i.total, 0))}</div></div>
        <div className="tile"><div className="k">Still to pay (المتبقي)</div><div className="v mono">{fmt(due)}</div></div>
        <div className="tile"><div className="k">Waiting for your answer (بانتظار ردك)</div><div className="v">{waiting}</div></div>
      </div>

      <div className="card" id="invoices">
        <h2>Invoices · الفواتير</h2>
        {v.invoices.length === 0 ? <p className="muted">No invoices yet.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Invoice</th><th>Date</th><th className="hide-sm">For</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">To pay</th></tr></thead>
            <tbody>{v.invoices.map(i => <tr key={i.id}><td><a href={`/print/sales-invoice/${i.id}?c=${token}`} target="_blank" rel="noreferrer">{i.no}</a></td><td className="mono">{i.date}{i.due && i.open > 0 ? <div className="muted" style={{ fontSize: 12 }}>due {i.due}</div> : null}</td>
              <td className="hide-sm">{i.type ?? ''}</td><td className="num">{fmt(i.total)}</td><td className="num">{fmt(i.paid)}</td><td className="num">{i.open > 0 ? fmt(i.open) : <span className="pill posted">Paid</span>}</td></tr>)}</tbody>
          </table></div>)}
        {due > 0 && v.bank && <p style={{ fontSize: 13, marginBottom: 0 }}>Pay by bank transfer to {v.bank.holder ?? 'Right Space Development'} · {v.bank.bank_name}{v.bank.branch ? `, ${v.bank.branch}` : ''}<br />
          {v.bank.account_no && <>Account <span className="mono">{v.bank.account_no}</span> · </>}{v.bank.iban && <>IBAN <span className="mono">{v.bank.iban}</span> · </>}{v.bank.swift && <>SWIFT <span className="mono">{v.bank.swift}</span></>}</p>}
      </div>

      {v.claims.length > 0 && (
        <div className="card" id="claims">
          <h2>Progress claims · المستخلصات</h2>
          <div className="tw"><table>
            <thead><tr><th>Claim</th><th>Date</th><th className="num">Work done to date</th><th>State</th></tr></thead>
            <tbody>{v.claims.map(c => <tr key={c.id}><td><a href={`/print/client-claim/${c.id}?c=${token}`} target="_blank" rel="noreferrer">{c.no}</a> <span className="muted">· no. {c.claim_no}</span></td><td className="mono">{c.date}</td><td className="num">{fmt(c.gross)}</td><td>{c.state}</td></tr>)}</tbody>
          </table></div>
        </div>)}

      <div className="card" id="variations">
        <h2>Variation orders · أوامر التغيير</h2>
        {v.vos.length === 0 ? <p className="muted">No variation orders.</p> : v.vos.map(o => (
          <div key={o.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><b dir="auto">{o.no} · {o.title}</b><span><span className={`pill ${o.status === 'approved' ? 'posted' : o.status === 'rejected' ? 'rejected' : 'pending'}`}>{VO_STATE[o.status]}</span> <span className="mono">{fmt(o.total)}</span></span></div>
            {o.status === 'sent' && <>
              <div className="tw"><table style={{ marginTop: 6 }}>
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                <tbody>{(v.voLines[o.id] ?? []).map(l => <tr key={l.id}><td dir="auto">{l.description}</td><td className="num">{l.qty} {l.unit}</td><td className="num">{fmt(l.rate)}</td><td className="num">{fmt(l.qty * l.rate)}</td></tr>)}</tbody>
              </table></div>
              <form action={answerVariationAction.bind(null, token, o.id)} className="grid g2" style={{ alignItems: 'end', marginTop: 8 }}>
                {nameField}
                <label className="f"><span>Comment (ملاحظات) · needed to decline</span><input className="inp" name="note" dir="auto" /></label>
                <div className="row"><button className="btn pri" name="answer" value="approve">Approve · موافقة</button><button className="btn" name="answer" value="decline">Decline · رفض</button></div>
              </form>
            </>}
          </div>))}
      </div>

      {v.concepts.length > 0 && (
        <div className="card" id="design">
          <h2>Design · التصميم</h2>
          {v.concepts.map(c => (
            <div key={c.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{c.kind_label} · version {c.version}</b><span className={`pill ${c.status === 'client' ? 'pending' : 'posted'}`}>{c.status === 'client' ? 'Waiting for your answer' : 'Approved'}</span></div>
              <ul style={{ margin: '6px 0', paddingInlineStart: 18 }}>{c.drawings.map(d => <li key={d.id}><span dir="auto">{d.no} · {d.title}</span>{d.attachments.map(a => <span key={a.id}> · <a href={`/c/${token}/file/${a.id}`} target="_blank" rel="noreferrer" dir="auto">{a.file_name}</a></span>)}</li>)}</ul>
              {c.status === 'client' && (
                <form action={answerConceptAction.bind(null, token, c.id)} className="grid g2" style={{ alignItems: 'end' }}>
                  {nameField}
                  <label className="f"><span>Comments (ملاحظات) · needed to ask for changes</span><input className="inp" name="note" dir="auto" /></label>
                  <div className="row"><button className="btn pri" name="answer" value="approve">Approve · موافقة</button><button className="btn" name="answer" value="changes">Ask for changes · طلب تعديل</button></div>
                </form>)}
            </div>))}
        </div>)}

      {v.handover && (
        <div className="card" id="handover">
          <h2>Handover certificate · شهادة التسليم</h2>
          <p style={{ marginTop: 0 }}>{v.handover.no} · handover date {v.handover.date} · defects liability {v.handover.defects_months} months · snags: {v.snags.verified} done, {v.snags.outstanding} still open.
            {' '}<a href={`/print/handover/${p.id}?c=${token}`} target="_blank" rel="noreferrer">Read the certificate</a></p>
          {v.handover.outstanding && <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}><b>Outstanding works:</b> {v.handover.outstanding}</p>}
          {v.handover.client_signed_at
            ? <p><span className="pill posted">Signed</span> by {v.handover.client_signed_name} on {v.handover.client_signed_at}</p>
            : <form action={signHandoverAction.bind(null, token)} style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
                <span>Sign with your finger in the box (وقّع داخل المربع):</span>
                <SignaturePad />
                {nameField}
                <div><button className="btn pri">Sign the certificate · توقيع</button></div>
              </form>}
        </div>)}

      <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>This page is private to you. Please do not share the link. · Right Space Development</p>
    </div>
  );
}
