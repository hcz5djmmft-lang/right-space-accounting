import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { today } from '@/lib/dates';
import { fmt } from '@/lib/money';
import { getInfo, phaseLabel } from '@/lib/projects';
import { canHandover, getHandover, listSnags, snagCounts } from '@/lib/site';
import { handoverAction, signHandoverAction } from '../../actions';
import { pillOf } from '../../ui';

/** The handover certificate: drafted at the end of the works (the project moves to Handover), signed once every snag is verified. */
export default async function HandoverPage({ params, searchParams }: { params: Promise<{ project: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { project } = await params;
  const { ok, error } = await searchParams;
  const [p] = await sql<{ id: string; code: string; name: string; phase: string | null; contract: number | null; client: string | null }[]>`
    select p.id, p.code, p.name, p.phase, p.contract::float contract, c.name client from projects p left join parties c on c.id = p.client_id where p.id = ${project} and not p.is_office`;
  if (!p) notFound();
  const [h, counts, open, info, users] = await Promise.all([getHandover(project), snagCounts(project), listSnags({ project, open: true }), getInfo(project), sql<{ id: string; name: string }[]>`select id, name from users where active order by name`]);
  const d = (info?.data ?? {}) as Record<string, string | string[] | undefined>;
  const str = (k: string) => { const v = d[k]; return Array.isArray(v) ? v.join(', ') : (v ?? ''); };
  const edit = canHandover(user) && h?.status !== 'signed';
  return (
    <>
      <div className="head"><div><h1>Handover · {p.code}</h1><p dir="auto">{p.name !== p.code ? `${p.name} · ` : ''}{phaseLabel(p.phase)}{h ? <> · certificate {h.no} <span className={'pill ' + pillOf(h.status)}>{h.status}</span></> : ' · no certificate yet'}</p></div>
        <div className="row">{h && <Link className="btn" href={`/print/handover/${project}`} target="_blank">Print the certificate</Link>}<Link className="btn" href={`/site/snags?project=${project}`}>Snag list</Link><Link className="btn" href={`/cost-centers/${project}`}>Project</Link><Link className="btn" href="/site">Site execution</Link></div></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Client</div><div className="v" style={{ fontSize: 16 }} dir="auto">{p.client ?? (str('client_name') || '—')}</div></div>
        <div className="tile"><div className="k">Contract</div><div className="v mono">{fmt(p.contract)}</div></div>
        <div className="tile"><div className="k">Snags open · fixed</div><div className="v mono">{counts.open ? <span className="pill rejected">{counts.open}</span> : 0} · {counts.fixed ? <span className="pill pending">{counts.fixed}</span> : 0}</div></div>
        <div className="tile"><div className="k">Snags verified</div><div className="v mono">{counts.verified}</div></div>
      </div>
      {!canHandover(user) && !h && <div className="card">The engineers or Finance draft the handover certificate when the works are complete.</div>}
      {(edit || h) && (
        <form action={handoverAction.bind(null, project)} className="card">
          <h2 style={{ marginTop: 0 }}>Handover certificate</h2>
          <div className="grid g3">
            <label className="f"><span>Handover date</span><input className="inp" type="date" name="date" defaultValue={h?.date ?? today()} required disabled={!edit} /></label>
            <label className="f"><span>Client representative</span><input className="inp" name="client_rep" dir="auto" defaultValue={h?.client_rep ?? (str('client_supervisor') || str('client_name'))} placeholder="Who receives the unit" disabled={!edit} /></label>
            <label className="f"><span>For Right Space</span><select className="inp" name="company_rep" defaultValue={h?.company_rep_id ?? user.id} disabled={!edit}>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label className="f"><span>Defects liability (months)</span><input className="inp" type="number" inputMode="numeric" min={0} max={60} name="defects_months" defaultValue={h?.defects_months ?? 12} disabled={!edit} /></label>
            <label className="f" style={{ gridColumn: 'span 2' }}><span>Outstanding works accepted by the client (if any)</span><textarea className="inp" name="outstanding" rows={2} dir="auto" defaultValue={h?.outstanding ?? ''} placeholder="Leave empty when every snag is verified" disabled={!edit} /></label>
            <label className="f" style={{ gridColumn: 'span 3' }}><span>Notes (keys handed, meter readings, manuals…)</span><textarea className="inp" name="notes" rows={2} dir="auto" defaultValue={h?.notes ?? ''} disabled={!edit} /></label>
          </div>
          {h?.client_signed_at && <p style={{ margin: '8px 0 0' }}><span className="pill posted">Client signed</span> {h.client_signed_name} on {h.client_signed_at}, on the client link.</p>}
          {h?.status === 'signed' && <p className="muted" style={{ margin: '8px 0 0' }}>Signed by {h.signed_by_name ?? '—'} on {h.signed_at}{h.snags_open ? ` with ${h.snags_open} outstanding snag${h.snags_open === 1 ? '' : 's'} accepted by the client` : ''}. Finance closes the project from its page once the final claim and the retention are settled.</p>}
          {edit && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">{h ? 'Save certificate' : 'Draft the certificate'}</button></div>}
        </form>)}
      {h && h.status === 'draft' && canHandover(user) && (
        <div className="card row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{counts.outstanding ? `${counts.outstanding} snag${counts.outstanding === 1 ? ' is' : 's are'} not verified yet: fix and verify them, or list them under Outstanding works and sign.` : 'Every snag is verified. The certificate can be signed with the client.'}</span>
          <form action={signHandoverAction.bind(null, project)}><button className="btn pri">Sign the certificate</button></form>
        </div>)}
      {open.length > 0 && (
        <div className="card"><h2 style={{ marginTop: 0 }}>Snags not yet verified</h2>
          <div className="tw"><table><thead><tr><th>#</th><th>Snag</th><th className="hide-sm">Who</th><th>Status</th></tr></thead>
            <tbody>{open.map(s => <tr key={s.id}><td className="mono">S-{s.snag_no}</td><td dir="auto">{s.area ? <b>{s.area} · </b> : ''}{s.description}</td><td className="hide-sm">{s.vendor ?? s.assignee ?? ''}</td><td><span className={'pill ' + pillOf(s.status)}>{s.status}</span></td></tr>)}</tbody></table></div>
        </div>)}
    </>
  );
}
