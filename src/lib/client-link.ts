import 'server-only';
import crypto from 'node:crypto';
import { sql } from './db';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit } from './books';
import { TZ } from './dates';
import { appUrl } from './mail';
import { storage } from './storage';
import { listClientClaims, clientClaimState, getVariationLines, decideVariationByClient } from './claims';
import { listSets, listDrawings, clientDecisionByClient } from './design';
import { getHandover, snagCounts } from './site';
import { kindLabel } from './design-calc';
import { pushTo } from './push';

// Client link (improvement 2). Each project can have one live secret link; whoever holds it sees the client page
// (/c/<token>) with no login: invoices and what is still to pay, progress claims, the variation orders and design
// concepts sent to them (Approve or ask for changes), and the handover certificate, which they sign by drawing.
// Staff keep the "Client approved" buttons on each record as the manual path.

export const canLink = (u: User) => hasRole(u, 'finance', 'engineering', 'projects');
const clientUrl = (token: string) => appUrl(`/c/${token}`);

export type LinkInfo = { url: string; created_at: string; created_by: string | null; last_seen_at: string | null } | null;
export async function linkFor(projectId: string): Promise<LinkInfo> {
  const [l] = await sql<{ token: string; created_at: string; created_by: string | null; last_seen_at: string | null }[]>`
    select l.token, to_char(l.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at, u.name created_by, to_char(l.last_seen_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') last_seen_at
    from client_links l left join users u on u.id = l.created_by where l.project_id = ${projectId} and l.revoked_at is null`;
  return l ? { url: clientUrl(l.token), created_at: l.created_at, created_by: l.created_by, last_seen_at: l.last_seen_at } : null;
}

/** Makes the project's client link (a new secret; an older live link stops working). */
export async function makeLink(user: User, projectId: string) {
  if (!canLink(user)) throw new RuleError('Only Finance or the engineers make client links.');
  const [p] = await sql<{ code: string; is_office: boolean }[]>`select code, is_office from projects where id = ${projectId}`;
  if (!p || p.is_office) throw new RuleError('Client links are for client projects.');
  const token = crypto.randomBytes(24).toString('base64url');
  await sql.begin(async tx => {
    await tx`update client_links set revoked_at = now(), revoked_by = ${user.id} where project_id = ${projectId} and revoked_at is null`;
    await tx`insert into client_links (token, project_id, created_by) values (${token}, ${projectId}, ${user.id})`;
    await audit(tx, user, 'project', projectId, 'Client link made');
  });
  return clientUrl(token);
}
export async function revokeLink(user: User, projectId: string) {
  if (!canLink(user)) throw new RuleError('Only Finance or the engineers revoke client links.');
  await sql.begin(async tx => {
    const r = await tx`update client_links set revoked_at = now(), revoked_by = ${user.id} where project_id = ${projectId} and revoked_at is null`;
    if (r.count) await audit(tx, user, 'project', projectId, 'Client link revoked');
  });
}

/** The project a live link opens, or null. */
export async function projectForToken(token: string, seen = false) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [l] = await sql<{ project_id: string }[]>`select project_id from client_links where token = ${token} and revoked_at is null`;
  if (l && seen) await sql`update client_links set last_seen_at = now() where token = ${token}`;
  return l?.project_id ?? null;
}
export async function requireToken(token: string) {
  const p = await projectForToken(token);
  if (!p) throw new RuleError('This link is no longer valid. Ask Right Space for a new one.');
  return p;
}

/** Everything the client page shows. */
export async function clientView(projectId: string) {
  const [p] = await sql<{ id: string; code: string; name: string; client: string | null; contract: number | null; phase: string | null }[]>`
    select p.id, p.code, p.name, coalesce(c.full_name, c.name) client, p.contract::float contract, p.phase from projects p left join parties c on c.id = p.client_id where p.id = ${projectId}`;
  const [invoices, bank, claims, vos, sets, handover, snags] = await Promise.all([
    sql<{ id: string; no: string; date: string; due: string | null; type: string | null; total: number; paid: number }[]>`
      select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, to_char(i.due_date,'YYYY-MM-DD') due, t.name type, i.total::float total, invoice_paid(i.id)::float paid
      from invoices i left join collection_types t on t.id = i.category where i.kind = 'sales' and i.status = 'posted' and i.project_id = ${projectId} order by i.date, i.no`,
    sql<{ bank_name: string | null; branch: string | null; account_no: string | null; iban: string | null; swift: string | null; holder: string | null }[]>`
      select bank_name, branch, account_no, iban, swift, holder from bank_accounts where show_on_invoices limit 1`,
    listClientClaims({ project: projectId }),
    sql<{ id: string; no: string; title: string; date: string; status: string; total: number; notes: string }[]>`
      select v.id, v.no, v.title, to_char(v.date,'YYYY-MM-DD') date, v.status, v.notes, coalesce((select sum(round(l.qty * l.rate, 2)) from variation_lines l where l.vo_id = v.id), 0)::float total
      from variation_orders v where v.project_id = ${projectId} and v.status in ('sent', 'approved', 'rejected') order by v.date desc, v.no desc`,
    listSets({ project: projectId }),
    getHandover(projectId),
    snagCounts(projectId),
  ]);
  const voLines = Object.fromEntries(await Promise.all(vos.filter(v => v.status === 'sent').map(async v => [v.id, await getVariationLines(v.id)] as const)));
  const concepts = sets.filter(s => s.kind !== 'shop' && ['client', 'client_approved'].includes(s.status));
  const drawings = Object.fromEntries(await Promise.all(concepts.map(async s => {
    const list = await listDrawings(s.id);
    const files = list.length ? await sql<{ id: string; entity_id: string; file_name: string; mime_type: string }[]>`
      select id, entity_id, file_name, mime_type from attachments where entity = 'drawing' and entity_id in ${sql(list.map(d => d.id))} order by uploaded_at` : [];
    return [s.id, list.map(d => ({ ...d, attachments: files.filter(f => f.entity_id === d.id) }))] as const;
  })));
  return {
    project: p, bank: bank[0] ?? null,
    invoices: invoices.map(i => ({ ...i, open: Math.max(0, Math.round((i.total - i.paid) * 100) / 100) })),
    claims: claims.filter(c => ['certified', 'invoiced'].includes(c.status)).map(c => ({ ...c, state: clientClaimState(c) })),
    vos, voLines,
    concepts: concepts.map(s => ({ id: s.id, kind_label: kindLabel(s.kind), version: s.version, status: s.status, drawings: drawings[s.id] ?? [] })),
    handover, snags,
  };
}

/** A drawing file of a concept the client may see, or null. */
export async function clientFile(projectId: string, attachmentId: string) {
  const [a] = await sql<{ file_name: string; mime_type: string; storage_key: string }[]>`
    select a.file_name, a.mime_type, a.storage_key from attachments a join drawings d on d.id = a.entity_id join drawing_sets s on s.id = d.set_id
    where a.id = ${attachmentId} and a.entity = 'drawing' and s.project_id = ${projectId} and s.kind <> 'shop' and s.status in ('client', 'client_approved')`;
  if (!a) return null;
  return { ...a, body: await storage().get(a.storage_key) };
}

/** Who on the team hears about the client's answer: the project's manager and site engineer, the record's maker, and Management. */
async function teamOf(projectId: string, extra: (string | null | undefined)[] = []) {
  const rows = await sql<{ id: string }[]>`
    select e.user_id id from projects p join employees e on e.id in (p.manager_id, p.site_eng_id) where p.id = ${projectId} and e.user_id is not null
    union select id from users where active and 'management' = any(roles)`;
  return [...new Set([...rows.map(r => r.id), ...extra.filter((x): x is string => !!x)])];
}

export async function clientAnswersVariation(token: string, voId: string, approve: boolean, note: string, name: string) {
  const projectId = await requireToken(token);
  await decideVariationByClient(projectId, voId, approve, note, name);
  const [v] = await sql<{ no: string; created_by: string | null; code: string }[]>`select v.no, v.created_by, p.code from variation_orders v join projects p on p.id = v.project_id where v.id = ${voId}`;
  await pushTo(await teamOf(projectId, [v.created_by]), { title: `Client ${approve ? 'approved' : 'declined'} ${v.no}`, body: `${v.code}${note.trim() ? ` · ${note.trim()}` : ''}`, url: `/variations/${voId}` });
}

export async function clientAnswersConcept(token: string, setId: string, approve: boolean, note: string, name: string) {
  const projectId = await requireToken(token);
  await clientDecisionByClient(projectId, setId, approve, note, name);
  const [s] = await sql<{ kind: string; designer_id: string | null; code: string }[]>`select s.kind, s.designer_id, p.code from drawing_sets s join projects p on p.id = s.project_id where s.id = ${setId}`;
  await pushTo(await teamOf(projectId, [s.designer_id]), { title: `Client ${approve ? 'approved' : 'asked for changes on'} the ${kindLabel(s.kind as never)}`, body: `${s.code}${note.trim() ? ` · ${note.trim()}` : ''}`, url: `/design/${setId}` });
}

/** The client signs the handover certificate by drawing on the phone; the drawing is kept with the certificate. */
export async function clientSignsHandover(token: string, name: string, signature: string) {
  const projectId = await requireToken(token);
  if (!name.trim()) throw new RuleError('Write your name under the signature.');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length < 400) throw new RuleError('Sign in the box first.');
  if (signature.length > 400_000) throw new RuleError('The signature is too large. Clear it and sign again.');
  const h = await sql.begin(async tx => {
    const [h] = await tx<{ no: string; client_signed_at: Date | null; created_by: string | null }[]>`select no, client_signed_at, created_by from handovers where project_id = ${projectId} for update`;
    if (!h) throw new RuleError('There is no handover certificate to sign yet.');
    if (h.client_signed_at) throw new RuleError('The certificate is already signed by the client.');
    await tx`update handovers set client_signature = ${signature}, client_signed_name = ${name.trim()}, client_signed_at = now(), client_rep = case when client_rep = '' then ${name.trim()} else client_rep end, updated_at = now() where project_id = ${projectId}`;
    await audit(tx, null, 'handover', projectId, 'Signed by the client on the client link', name.trim());
    return h;
  });
  await pushTo(await teamOf(projectId, [h.created_by]), { title: `Client signed handover ${h.no}`, body: name.trim(), url: `/site/handover/${projectId}` });
}
