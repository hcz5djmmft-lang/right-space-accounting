import 'server-only';
import { sql, type Tx } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ, today } from './dates';
import { holdersOf } from './org';
import { movePhase } from './projects';
import { DEFAULT_DRAWINGS, EDITABLE, KINDS, OPEN_STATUSES, STEPS, type Kind, type Step, daysWaiting, isStep, kindLabel, statusLabel, stepLabel } from './design-calc';

// The design phase: a designer prepares a drawing set (Main Concept 2D, Main Concept 3D, Shop drawings) and submits it;
// the head of design, the technical office head and the director of engineering sign in turn (positions from Settings > Org chart,
// a missing holder falling back to the department head, then Management); a concept goes to the client; shop drawings are
// issued for construction, which moves the project on to QS and pricing. Each set has a group chat.

/** Designers and engineers prepare sets; Finance may look and file. */
export const canDesign = (u: User) => hasRole(u, 'engineering', 'projects');
const needDesign = (u: User, what: string) => { if (!canDesign(u)) throw new RuleError(`Only the engineers can ${what}.`); };

export type DrawingSet = {
  id: string; project_id: string; project_code: string; project_name: string; project_phase: string | null; kind: Kind; kind_label: string; version: number;
  status: string; status_label: string; designer_id: string | null; designer: string | null; created_at: string; submitted_at: string | null; step_at: string; step_at_raw: Date;
  design_head_signer: string | null; design_head_at: string | null; to_head_signer: string | null; to_head_at: string | null; director_signer: string | null; director_at: string | null;
  decision_note: string; client_sent_at: string | null; client_note: string; client_at: string | null; client_by_name: string | null; ifc_at: string | null; ifc_by_name: string | null;
  drawings: number; files: number; messages: number;
};
const select = (tx: Tx, where = sql``) => tx<DrawingSet[]>`
  select s.id, s.project_id, p.code project_code, p.name project_name, p.phase project_phase, s.kind, s.kind kind_label, s.version, s.status, s.status status_label,
    s.designer_id, d.name designer, to_char(s.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at, to_char(s.submitted_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') submitted_at,
    to_char(s.step_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') step_at, s.step_at step_at_raw,
    h1.name design_head_signer, to_char(s.design_head_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') design_head_at,
    h2.name to_head_signer, to_char(s.to_head_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') to_head_at,
    h3.name director_signer, to_char(s.director_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') director_at,
    s.decision_note, to_char(s.client_sent_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') client_sent_at, s.client_note, to_char(s.client_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') client_at, cb.name client_by_name,
    to_char(s.ifc_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') ifc_at, ib.name ifc_by_name,
    (select count(*)::int from drawings w where w.set_id = s.id and not w.superseded) drawings,
    (select count(*)::int from attachments a join drawings w on w.id = a.entity_id where a.entity = 'drawing' and w.set_id = s.id and not w.superseded) files,
    (select count(*)::int from set_messages m where m.set_id = s.id) messages
  from drawing_sets s join projects p on p.id = s.project_id left join users d on d.id = s.designer_id
  left join users h1 on h1.id = s.design_head_by left join users h2 on h2.id = s.to_head_by left join users h3 on h3.id = s.director_by
  left join users cb on cb.id = s.client_by left join users ib on ib.id = s.ifc_by
  ${where} order by p.code, s.kind, s.version desc`;
const label = (rows: DrawingSet[]) => rows.map(r => ({ ...r, kind_label: kindLabel(r.kind), status_label: statusLabel(r.status) }));

export const listSets = async (opts: { project?: string; open?: boolean } = {}) => label(await select(sql, sql`where true
  ${opts.project ? sql`and s.project_id = ${opts.project}` : sql``} ${opts.open ? sql`and s.status in ${sql(OPEN_STATUSES)}` : sql``}`));
export const getSet = async (id: string, tx: Tx = sql) => label(await select(tx, sql`where s.id = ${id}`))[0];

/** Who signs a step: the position's holders; with nobody named, the head of the Technical Office or of Engineering; else Management alone. */
export async function signersFor(step: Step, tx: Tx = sql): Promise<string[]> {
  const pos = STEPS.find(s => s.status === step)!.position;
  const ids = await holdersOf(pos, tx);
  if (ids.length) return ids;
  const fallback = step === 'design_head' ? [] : step === 'to_head' ? ['to', 'eng'] : ['eng'];
  for (const dept of fallback) {
    const [d] = await tx<{ head: string }[]>`select u.id head from departments d join users u on u.id = d.head_user_id and u.active where d.id = ${dept}`;
    if (d) return [d.head];
  }
  return [];
}
export async function canSign(user: User, set: Pick<DrawingSet, 'status'>, tx: Tx = sql) {
  if (!isStep(set.status)) return false;
  if (hasRole(user, 'management')) return true;
  return (await signersFor(set.status, tx)).includes(user.id);
}

/** A new set of a kind for a project, prefilled with the default drawings; one moving set per kind at a time. */
export async function createSet(user: User, projectId: string, kind: Kind) {
  needDesign(user, 'start a drawing set');
  if (!KINDS.some(k => k[0] === kind)) throw new RuleError('Choose the kind of set.');
  return sql.begin(async tx => {
    const [p] = await tx<{ id: string }[]>`select id from projects where id = ${projectId} and not is_office`;
    if (!p) throw new RuleError('Project not found.');
    const [open] = await tx<{ version: number }[]>`select version from drawing_sets where project_id = ${projectId} and kind = ${kind} and status in ${sql(OPEN_STATUSES)}`;
    if (open) throw new RuleError(`A ${kindLabel(kind)} set (v${open.version}) is already in progress for this project.`);
    // the designer named on the project form (an employee with a login) owns the set; otherwise whoever starts it
    const [d] = await tx<{ user_id: string | null }[]>`select u.id user_id from project_info i join employees e on e.id = i.data->>'designer_emp' and e.active join users u on u.id = e.user_id and u.active where i.project_id = ${projectId}`;
    const [s] = await tx<{ id: string }[]>`insert into drawing_sets (project_id, kind, designer_id, created_by) values (${projectId}, ${kind}, ${d?.user_id ?? user.id}, ${user.id}) returning id`;
    for (const [no, title] of DEFAULT_DRAWINGS[kind]) await tx`insert into drawings (set_id, project_id, no, title, created_by) values (${s.id}, ${projectId}, ${no}, ${title}, ${user.id})`;
    await audit(tx, user, 'drawing_set', s.id, 'Started', `${kindLabel(kind)} for ${projectId}`);
    await audit(tx, user, 'project', projectId, 'Drawing set started', kindLabel(kind));
    return s.id;
  });
}

export type Drawing = { id: string; set_id: string; no: string; title: string; rev: number; superseded: boolean; issued_on: string | null; note: string; files: number; who: string | null; created_at: string };
export const listDrawings = (setId: string, all = false) => sql<Drawing[]>`
  select w.id, w.set_id, w.no, w.title, w.rev, w.superseded, to_char(w.issued_on,'YYYY-MM-DD') issued_on, w.note,
    (select count(*)::int from attachments a where a.entity = 'drawing' and a.entity_id = w.id) files, u.name who, to_char(w.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at
  from drawings w left join users u on u.id = w.created_by where w.set_id = ${setId} ${all ? sql`` : sql`and not w.superseded`} order by w.no, w.rev`;

async function editableSet(tx: Tx, setId: string) {
  const [s] = await tx<{ id: string; status: string; project_id: string; kind: Kind }[]>`select id, status, project_id, kind from drawing_sets where id = ${setId} for update`;
  if (!s) throw new RuleError('Drawing set not found.');
  if (!EDITABLE.includes(s.status)) throw new RuleError(`The set is ${statusLabel(s.status).toLowerCase()}; reopen it for revision to change its drawings.`);
  return s;
}
export async function addDrawing(user: User, setId: string, i: { no: string; title: string; note?: string }) {
  needDesign(user, 'add drawings');
  const no = i.no.trim().toUpperCase(), title = i.title.trim();
  if (!no || !title) throw new RuleError('Give the drawing a number and a title.');
  return sql.begin(async tx => {
    const s = await editableSet(tx, setId);
    const [dup] = await tx`select 1 from drawings where set_id = ${setId} and no = ${no} and not superseded`;
    if (dup) throw new RuleError(`Drawing ${no} is already on this set.`);
    const [w] = await tx<{ id: string }[]>`insert into drawings (set_id, project_id, no, title, note, created_by) values (${setId}, ${s.project_id}, ${no}, ${title}, ${(i.note ?? '').trim()}, ${user.id}) returning id`;
    await audit(tx, user, 'drawing_set', setId, 'Drawing added', `${no} ${title}`);
    return w.id;
  });
}
export async function removeDrawing(user: User, drawingId: string) {
  needDesign(user, 'remove drawings');
  await sql.begin(async tx => {
    const [w] = await tx<{ set_id: string; no: string; files: number }[]>`select set_id, no, (select count(*)::int from attachments a where a.entity = 'drawing' and a.entity_id = drawings.id) files from drawings where id = ${drawingId}`;
    if (!w) return;
    await editableSet(tx, w.set_id);
    if (w.files) throw new RuleError('Remove its files first.');
    await tx`delete from drawings where id = ${drawingId}`;
    await audit(tx, user, 'drawing_set', w.set_id, 'Drawing removed', w.no);
  });
}
/** A new revision of a drawing on a set being revised: the old row stays in the register as superseded. */
export async function newRevision(user: User, drawingId: string, note = '') {
  needDesign(user, 'revise drawings');
  return sql.begin(async tx => {
    const [w] = await tx<{ set_id: string; project_id: string; no: string; title: string; rev: number; superseded: boolean }[]>`select set_id, project_id, no, title, rev, superseded from drawings where id = ${drawingId} for update`;
    if (!w) throw new RuleError('Drawing not found.');
    if (w.superseded) throw new RuleError('This revision is already superseded.');
    await editableSet(tx, w.set_id);
    await tx`update drawings set superseded = true where id = ${drawingId}`;
    const [n] = await tx<{ id: string }[]>`insert into drawings (set_id, project_id, no, title, rev, note, created_by) values (${w.set_id}, ${w.project_id}, ${w.no}, ${w.title}, ${w.rev + 1}, ${note.trim()}, ${user.id}) returning id`;
    await audit(tx, user, 'drawing_set', w.set_id, 'New revision', `${w.no} rev ${w.rev + 1}`);
    return n.id;
  });
}

/** The designer sends the set up the line; at least one drawing must carry a file. */
export async function submitSet(user: User, setId: string) {
  needDesign(user, 'submit a drawing set');
  await sql.begin(async tx => {
    const s = await editableSet(tx, setId);
    const [{ files }] = await tx<{ files: number }[]>`select count(*)::int files from attachments a join drawings w on w.id = a.entity_id where a.entity = 'drawing' and w.set_id = ${setId} and not w.superseded`;
    if (!files) throw new RuleError('Upload at least one drawing before submitting the set.');
    await tx`update drawing_sets set status = 'design_head', submitted_at = now(), step_at = now(), decision_note = '',
      design_head_by = null, design_head_at = null, to_head_by = null, to_head_at = null, director_by = null, director_at = null,
      designer_id = coalesce(designer_id, ${user.id}) where id = ${setId}`;
    await audit(tx, user, 'drawing_set', setId, 'Submitted for approval');
    await note(tx, user, setId, `Submitted ${kindLabel(s.kind)} for approval.`);
  });
}

/** One signer's decision at the current step: approved on to the next, or sent back to the designer with a note. */
export async function decideSet(user: User, setId: string, approve: boolean, decisionNote = '') {
  await sql.begin(async tx => {
    const s = await getSet(setId, tx);
    if (!s) throw new RuleError('Drawing set not found.');
    if (!isStep(s.status)) throw new RuleError('This set is not waiting for a signature.');
    if (!(await canSign(user, s, tx))) throw new RuleError(`This set waits for the ${stepLabel(s.status).toLowerCase()}.`);
    const step = s.status as Step;
    const col = { design_head: sql`design_head_by = ${user.id}, design_head_at = now()`, to_head: sql`to_head_by = ${user.id}, to_head_at = now()`, director: sql`director_by = ${user.id}, director_at = now()` }[step];
    if (!approve) {
      if (!decisionNote.trim()) throw new RuleError('Say what must change.');
      await tx`update drawing_sets set status = 'rejected', step_at = now(), decision_note = ${decisionNote.trim()}, ${col} where id = ${setId}`;
      await audit(tx, user, 'drawing_set', setId, `Sent back by the ${stepLabel(step).toLowerCase()}`, decisionNote.trim());
      await note(tx, user, setId, `Sent back: ${decisionNote.trim()}`);
      return;
    }
    const i = STEPS.findIndex(x => x.status === step);
    const next = i + 1 < STEPS.length ? STEPS[i + 1].status : 'approved';
    await tx`update drawing_sets set status = ${next}, step_at = now(), decision_note = ${decisionNote.trim()}, ${col} where id = ${setId}`;
    await audit(tx, user, 'drawing_set', setId, `Approved by the ${stepLabel(step).toLowerCase()}`, decisionNote.trim());
    await note(tx, user, setId, `Approved as ${stepLabel(step).toLowerCase()}${decisionNote.trim() ? `: ${decisionNote.trim()}` : ''}.`);
    if (next === 'approved') await audit(tx, user, 'project', s.project_id, 'Drawing set approved', `${s.kind_label} v${s.version}`);
  });
}

/** Back to the designer for a new version (after a rejection, the client's comments, or to change an approved set). */
export async function reopenSet(user: User, setId: string, why = '') {
  needDesign(user, 'reopen a drawing set');
  await sql.begin(async tx => {
    const [s] = await tx<{ status: string; version: number; kind: Kind }[]>`select status, version, kind from drawing_sets where id = ${setId} for update`;
    if (!s) throw new RuleError('Drawing set not found.');
    if (s.status === 'draft') throw new RuleError('The set is already being prepared.');
    if (s.status === 'ifc') throw new RuleError('Issued drawings stay; start a new Shop drawings set for the changes.');
    await tx`update drawing_sets set status = 'draft', version = version + 1, step_at = now(), submitted_at = null, decision_note = '',
      design_head_by = null, design_head_at = null, to_head_by = null, to_head_at = null, director_by = null, director_at = null, client_sent_at = null where id = ${setId}`;
    await audit(tx, user, 'drawing_set', setId, `Reopened as v${s.version + 1}`, why.trim());
    await note(tx, user, setId, `Reopened for revision (v${s.version + 1})${why.trim() ? `: ${why.trim()}` : ''}.`);
  });
}

/** An approved concept goes to the client; their answer is recorded by the engineer who has it. */
export async function sendToClient(user: User, setId: string) {
  needDesign(user, 'send a set to the client');
  await sql.begin(async tx => {
    const [s] = await tx<{ status: string; kind: Kind }[]>`select status, kind from drawing_sets where id = ${setId} for update`;
    if (!s) throw new RuleError('Drawing set not found.');
    if (s.kind === 'shop') throw new RuleError('Shop drawings are issued for construction, not sent to the client.');
    if (s.status !== 'approved') throw new RuleError('The set must be approved by the director of engineering first.');
    await tx`update drawing_sets set status = 'client', client_sent_at = now(), step_at = now() where id = ${setId}`;
    await audit(tx, user, 'drawing_set', setId, 'Sent to the client');
    await note(tx, user, setId, 'Sent to the client.');
  });
}
export async function clientDecision(user: User, setId: string, approve: boolean, clientNote = '') {
  needDesign(user, "record the client's answer");
  await sql.begin(async tx => {
    const s = await getSet(setId, tx);
    if (!s) throw new RuleError('Drawing set not found.');
    if (s.status !== 'client') throw new RuleError('The set is not with the client.');
    if (approve) {
      await tx`update drawing_sets set status = 'client_approved', client_at = now(), client_by = ${user.id}, client_note = ${clientNote.trim()}, step_at = now() where id = ${setId}`;
      await audit(tx, user, 'drawing_set', setId, 'Client approved', clientNote.trim());
      await audit(tx, user, 'project', s.project_id, 'Client approved the concept', `${s.kind_label} v${s.version}`);
      await note(tx, user, setId, `The client approved${clientNote.trim() ? `: ${clientNote.trim()}` : ''}.`);
    } else {
      if (!clientNote.trim()) throw new RuleError("Write the client's comments.");
      await tx`update drawing_sets set status = 'draft', version = version + 1, client_note = ${clientNote.trim()}, client_at = now(), client_by = ${user.id}, step_at = now(), submitted_at = null, client_sent_at = null,
        design_head_by = null, design_head_at = null, to_head_by = null, to_head_at = null, director_by = null, director_at = null where id = ${setId}`;
      await audit(tx, user, 'drawing_set', setId, `Client asked for changes; reopened as v${s.version + 1}`, clientNote.trim());
      await note(tx, user, setId, `The client asked for changes: ${clientNote.trim()}`);
    }
  });
}

/** The IFC stamp on an approved Shop drawings set: the site sees these revisions, and a project still in design moves on to QS and pricing. */
export async function issueForConstruction(user: User, setId: string) {
  await sql.begin(async tx => {
    const s = await getSet(setId, tx);
    if (!s) throw new RuleError('Drawing set not found.');
    if (s.kind !== 'shop') throw new RuleError('Only shop drawings are issued for construction.');
    if (s.status !== 'approved') throw new RuleError('The set must be approved by the director of engineering first.');
    const allowed = hasRole(user, 'management') || (await signersFor('to_head', tx)).includes(user.id) || (await signersFor('director', tx)).includes(user.id);
    if (!allowed) throw new RuleError('The technical office head or the director of engineering issues drawings for construction.');
    await tx`update drawing_sets set status = 'ifc', ifc_at = now(), ifc_by = ${user.id}, step_at = now() where id = ${setId}`;
    await tx`update drawings set issued_on = ${today()} where set_id = ${setId} and not superseded`;
    await audit(tx, user, 'drawing_set', setId, 'Issued for construction');
    await note(tx, user, setId, 'Issued for construction.');
    if (s.project_phase === 'design') await movePhase(tx, user, s.project_id, 'qs', `Shop drawings v${s.version} issued for construction`);
  });
}

// The group chat of a set: the designer, the three signers and Management write; every engineer reads.
export type Message = { id: number; who: string | null; user_id: string | null; at: string; text: string };
export const listMessages = (setId: string) => sql<Message[]>`
  select m.id, u.name who, m.user_id, to_char(m.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, m.text from set_messages m left join users u on u.id = m.user_id where m.set_id = ${setId} order by m.at`;
async function note(tx: Tx, user: User, setId: string, text: string) {
  await tx`insert into set_messages (set_id, user_id, text) values (${setId}, ${user.id}, ${text})`;
}
export async function canChat(user: User, set: Pick<DrawingSet, 'designer_id'>, tx: Tx = sql) {
  if (hasRole(user, 'management') || set.designer_id === user.id) return true;
  for (const st of STEPS) if ((await signersFor(st.status, tx)).includes(user.id)) return true;
  return false;
}
export async function postMessage(user: User, setId: string, text: string) {
  text = text.trim();
  if (!text) return;
  await sql.begin(async tx => {
    const s = await getSet(setId, tx);
    if (!s) throw new RuleError('Drawing set not found.');
    if (!(await canChat(user, s, tx))) throw new RuleError('This chat is for the designer, the head of design, the technical office head and the director of engineering.');
    await tx`insert into set_messages (set_id, user_id, text) values (${setId}, ${user.id}, ${text.slice(0, 2000)})`;
  });
}

/** Sets waiting for this user's signature, for the Approvals page. */
export async function designWaitingFor(user: User) {
  const rows = label(await select(sql, sql`where s.status in ('design_head','to_head','director')`));
  const out: DrawingSet[] = [];
  for (const r of rows) if (await canSign(user, r)) out.push(r);
  return out;
}

// The drawing register per project, and what the site sees.
export type RegisterRow = Drawing & { kind: Kind; kind_label: string; version: number; set_status: string; set_status_label: string; ifc: boolean };
export const register = async (projectId: string, onlyIfc = false): Promise<RegisterRow[]> => (await sql<(Drawing & { kind: Kind; version: number; set_status: string })[]>`
  select w.id, w.set_id, w.no, w.title, w.rev, w.superseded, to_char(w.issued_on,'YYYY-MM-DD') issued_on, w.note,
    (select count(*)::int from attachments a where a.entity = 'drawing' and a.entity_id = w.id) files, u.name who, to_char(w.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at,
    s.kind, s.version, s.status set_status
  from drawings w join drawing_sets s on s.id = w.set_id left join users u on u.id = w.created_by
  where w.project_id = ${projectId} ${onlyIfc ? sql`and s.status = 'ifc' and not w.superseded` : sql``} order by s.kind, w.no, w.rev desc`)
  .map(r => ({ ...r, kind_label: kindLabel(r.kind), set_status_label: statusLabel(r.set_status), ifc: r.set_status === 'ifc' && !r.superseded }));

// Finishes and materials chosen with the client.
export type Finish = { id: string; project_id: string; area: string; item: string; material: string; ref: string; status: string; note: string; who: string | null; created_at: string; decided_by_name: string | null; decided_at: string | null };
export const listFinishes = (projectId: string) => sql<Finish[]>`
  select f.id, f.project_id, f.area, f.item, f.material, f.ref, f.status, f.note, u.name who, to_char(f.created_at at time zone ${TZ},'YYYY-MM-DD') created_at, d.name decided_by_name, to_char(f.decided_at at time zone ${TZ},'YYYY-MM-DD') decided_at
  from finishes f left join users u on u.id = f.created_by left join users d on d.id = f.decided_by where f.project_id = ${projectId} order by f.area, f.item, f.created_at`;
export async function addFinish(user: User, projectId: string, i: { area: string; item: string; material?: string; ref?: string; note?: string }) {
  needDesign(user, 'add finishes');
  if (!i.area.trim() || !i.item.trim()) throw new RuleError('Give the area and the item (floor, wall, ceiling…).');
  const [f] = await sql<{ id: string }[]>`insert into finishes (project_id, area, item, material, ref, note, created_by) values (${projectId}, ${i.area.trim()}, ${i.item.trim()}, ${(i.material ?? '').trim()}, ${(i.ref ?? '').trim()}, ${(i.note ?? '').trim()}, ${user.id}) returning id`;
  await audit(sql, user, 'project', projectId, 'Finish proposed', `${i.area.trim()} · ${i.item.trim()}`);
  return f.id;
}
export async function decideFinish(user: User, id: string, approve: boolean, noteText = '') {
  needDesign(user, "record the client's choice");
  const [f] = await sql<{ project_id: string; area: string; item: string }[]>`update finishes set status = ${approve ? 'approved' : 'rejected'}, decided_by = ${user.id}, decided_at = now(), note = case when ${noteText.trim()} = '' then note else ${noteText.trim()} end where id = ${id} returning project_id, area, item`;
  if (f) await audit(sql, user, 'project', f.project_id, approve ? 'Finish approved by the client' : 'Finish rejected by the client', `${f.area} · ${f.item}`);
}
export async function removeFinish(user: User, id: string) {
  needDesign(user, 'remove finishes');
  await sql`delete from finishes where id = ${id} and status = 'proposed'`;
}

// Reports.
export type StatusRow = DrawingSet & { step: string; waiting_days: number; signers: string };
/** Every moving set: where it stands, who it waits for and for how many days. */
export async function designStatus(now = new Date()): Promise<StatusRow[]> {
  const sets = await listSets({ open: true });
  const names = new Map<string, string>((await sql<{ id: string; name: string }[]>`select id, name from users where active`).map(u => [u.id, u.name]));
  const out: StatusRow[] = [];
  for (const s of sets) {
    const signers = isStep(s.status) ? (await signersFor(s.status)).map(id => names.get(id) ?? '').filter(Boolean) : [];
    out.push({ ...s, step: s.status_label, waiting_days: daysWaiting(s.step_at_raw, now), signers: signers.join(', ') || (isStep(s.status) ? 'Management' : '') });
  }
  return out.sort((a, b) => b.waiting_days - a.waiting_days);
}
/** Design hours and their cost per project against the design fee. */
export const designHoursVsFee = () => sql<{ project_id: string; code: string; name: string; phase: string | null; design_fee: number | null; minutes: number; cost: number; people: number }[]>`
  select p.id project_id, p.code, p.name, p.phase, p.design_fee,
    coalesce(sum(s.minutes),0)::int minutes, coalesce(sum(s.cost),0)::float cost, count(distinct s.employee_id)::int people
  from projects p left join design_sessions s on s.project_id = p.id and s.end_at is not null
  where not p.is_office and (p.phase = 'design' or p.design_fee is not null or exists (select 1 from design_sessions x where x.project_id = p.id))
  group by p.id order by p.code`;
