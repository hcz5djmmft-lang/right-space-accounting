import 'server-only';
import { sql, type Tx } from './db';
import { audit, nextNo } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ, today } from './dates';
import { movePhase, phaseLabel } from './projects';
import { canPlan, listActivities, onSiteTeam } from './planning';
import { categoryTitle } from './planning-calc';
import { holdersOf } from './org';

// Site execution (Adel's update 15, the second Engineering section): the site engineer sends a daily site report from the
// phone (work done, manpower per trade, materials received, issues, photos), asks for an inspection before a work is covered
// (a task for the inspector, whose Failed result lands on the snag list), keeps the snag list (open > fixed > verified) and,
// at the end, drafts and signs the handover certificate, which moves the project to Handover.

export const TRADES = ['Demolition', 'Masonry', 'Plumbing', 'Electrical', 'Plastering', 'Tiling', 'Gypsum & ceilings', 'Painting', 'Carpentry', 'Marble', 'Aluminium & glass', 'HVAC', 'Labour', 'Cleaning'];
export const WEATHER = ['Clear', 'Hot', 'Windy', 'Dusty', 'Rain'];
export const MANPOWER_ROWS = 6;
export const REPORT_STATUSES = [['draft', 'Draft'], ['submitted', 'Sent'], ['reviewed', 'Reviewed']] as const;
export const INSPECTION_STATUSES = [['open', 'Waiting for inspection'], ['passed', 'Passed'], ['failed', 'Failed'], ['cancelled', 'Cancelled']] as const;
export const SNAG_STATUSES = [['open', 'Open'], ['fixed', 'Fixed'], ['verified', 'Verified'], ['cancelled', 'Cancelled']] as const;
export const SNAG_PRIORITIES = ['low', 'normal', 'high'] as const;
export const label = (list: readonly (readonly [string, string])[], k: string) => list.find(x => x[0] === k)?.[1] ?? k;

const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d\d-\d\d$/.test(s);
/** The project's site engineer, its manager (their employee files carry the login) or anyone with the engineering or projects roles. */
export const canSite = async (u: User, projectId: string, tx: Tx = sql) => canPlan(u) || (await onSiteTeam(projectId, u.id, tx));
async function needSite(u: User, projectId: string, what: string, tx: Tx) {
  if (!(await canSite(u, projectId, tx))) throw new RuleError(`Only the site engineer, the project manager or the engineers ${what}.`);
}
async function project(tx: Tx, id: string, lock = false) {
  const [p] = await tx<{ id: string; code: string; name: string; phase: string | null; is_office: boolean }[]>`select id, code, name, phase, is_office from projects where id = ${id} ${lock ? sql`for update` : sql``}`;
  if (!p || p.is_office) throw new RuleError('Project not found.');
  return p;
}
/** The logins of the project's site engineer and manager (through their employee files). */
export const siteTeam = async (projectId: string, tx: Tx = sql) => (await tx<{ site_user: string | null; manager_user: string | null; site_emp: string | null }[]>`
  select se.user_id site_user, me.user_id manager_user, p.site_eng_id site_emp from projects p left join employees se on se.id = p.site_eng_id left join employees me on me.id = p.manager_id where p.id = ${projectId}`)[0]
  ?? { site_user: null, manager_user: null, site_emp: null };
const employeeOf = async (tx: Tx, userId: string | null) => userId ? (await tx<{ id: string }[]>`select id from employees where user_id = ${userId} and active limit 1`)[0]?.id ?? null : null;

// ---- daily site reports --------------------------------------------------------------------------------------------------

export type SiteReport = {
  id: string; no: string; project_id: string; code: string; project_name: string; day: string; status: string; weather: string; work_done: string; materials: string; issues: string; visitors: string;
  created_by: string | null; created_by_name: string | null; submitted_by_name: string | null; submitted_at: string | null; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string; created_at: string; photos: number; headcount: number;
};
const reportSelect = sql`
  select r.id, r.no, r.project_id, p.code, p.name project_name, to_char(r.day,'YYYY-MM-DD') as day, r.status, r.weather, r.work_done, r.materials, r.issues, r.visitors, r.created_by, cu.name created_by_name,
    su.name submitted_by_name, to_char(r.submitted_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') submitted_at, ru.name reviewed_by_name, to_char(r.reviewed_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') reviewed_at, r.review_note,
    to_char(r.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at,
    (select count(*)::int from attachments a where a.entity = 'site-report' and a.entity_id = r.id) photos,
    coalesce((select sum(m.headcount)::int from site_report_manpower m where m.report_id = r.id), 0) headcount
  from site_reports r join projects p on p.id = r.project_id left join users cu on cu.id = r.created_by left join users su on su.id = r.submitted_by left join users ru on ru.id = r.reviewed_by`;
export const listReports = (f: { project?: string; status?: string; limit?: number } = {}) => sql<SiteReport[]>`${reportSelect} where true
  ${f.project ? sql`and r.project_id = ${f.project}` : sql``} ${f.status ? sql`and r.status = ${f.status}` : sql``} order by r.day desc, p.code limit ${f.limit ?? 200}`;
export const getReport = async (id: string, tx: Tx = sql) => (await tx<SiteReport[]>`${reportSelect} where r.id = ${id}`)[0] ?? null;
export const reportFor = async (projectId: string, day: string) => (await sql<{ id: string; status: string }[]>`select id, status from site_reports where project_id = ${projectId} and day = ${day}`)[0] ?? null;

export type Manpower = { id: number; trade: string; headcount: number; hours: number };
export const listManpower = (reportId: string, tx: Tx = sql) => tx<Manpower[]>`select id, trade, headcount, hours::float hours from site_report_manpower where report_id = ${reportId} order by id`;
export const listWork = (reportId: string, tx: Tx = sql) => tx<{ activity_id: string; name: string; note: string }[]>`
  select w.activity_id, a.name, w.note from site_report_work w join activities a on a.id = w.activity_id where w.report_id = ${reportId} order by a.position, a.name`;

export type ReportInput = {
  id?: string; project: string; day: string; weather?: string; work_done: string; materials?: string; issues?: string; visitors?: string;
  manpower: { trade: string; headcount: string | number; hours?: string | number }[]; activities: string[];
};
/** Creates or edits the day's report (one per project and day). Photos are attached on the report page. */
export async function saveReport(user: User, i: ReportInput): Promise<string> {
  if (!i.project) throw new RuleError('Pick the project.');
  if (!isDate(i.day)) throw new RuleError('Give the day as a date.');
  if (i.day > today()) throw new RuleError('A site report cannot be for a day that has not come yet.');
  return sql.begin(async tx => {
    await needSite(user, i.project, 'write the site report', tx);
    await project(tx, i.project);
    const vals = { weather: (i.weather ?? '').trim(), work_done: i.work_done.trim(), materials: (i.materials ?? '').trim(), issues: (i.issues ?? '').trim(), visitors: (i.visitors ?? '').trim() };
    let id = i.id;
    if (id) {
      const [r] = await tx<{ status: string; project_id: string }[]>`select status, project_id from site_reports where id = ${id} for update`;
      if (!r || r.project_id !== i.project) throw new RuleError('Report not found.');
      if (r.status === 'reviewed') throw new RuleError('This report was reviewed; it cannot change any more.');
      await tx`update site_reports set ${tx(vals)}, day = ${i.day}, updated_at = now() where id = ${id}`;
      await tx`delete from site_report_manpower where report_id = ${id}`;
      await tx`delete from site_report_work where report_id = ${id}`;
    } else {
      const [dup] = await tx<{ no: string }[]>`select no from site_reports where project_id = ${i.project} and day = ${i.day}`;
      if (dup) throw new RuleError(`There is already a site report (${dup.no}) for ${i.day} on this project: open it and add to it.`);
      const no = await nextNo(tx, 'SR-');
      [{ id }] = await tx<{ id: string }[]>`insert into site_reports ${tx({ no, project_id: i.project, day: i.day, ...vals, created_by: user.id })} returning id`;
    }
    for (const m of i.manpower) {
      const trade = (m.trade ?? '').trim(), n = Number(m.headcount), h = m.hours === undefined || m.hours === '' ? 8 : Number(m.hours);
      if (!trade && !n) continue;
      if (!trade) throw new RuleError('Name the trade of every manpower row.');
      if (!Number.isInteger(n) || n < 0 || n > 999) throw new RuleError(`${trade}: the headcount is a whole number.`);
      if (!Number.isFinite(h) || h < 0 || h > 24) throw new RuleError(`${trade}: hours are between 0 and 24.`);
      if (!n) continue;
      await tx`insert into site_report_manpower (report_id, trade, headcount, hours) values (${id}, ${trade}, ${n}, ${h})`;
    }
    const acts = await listActivities(i.project, tx);
    for (const a of new Set(i.activities)) if (acts.some(x => x.id === a)) await tx`insert into site_report_work (report_id, activity_id) values (${id}, ${a})`;
    await audit(tx, user, 'site-report', id!, i.id ? 'Edited' : 'Created', i.day);
    return id!;
  });
}

/** Sends the report: the engineers see it under Site execution and on the project page; it needs the work done. */
export async function submitReport(user: User, id: string) {
  await sql.begin(async tx => {
    const [r] = await tx<{ project_id: string; status: string; work_done: string }[]>`select project_id, status, work_done from site_reports where id = ${id} for update`;
    if (!r) throw new RuleError('Report not found.');
    await needSite(user, r.project_id, 'send the site report', tx);
    if (r.status !== 'draft') throw new RuleError('This report was already sent.');
    if (!r.work_done.trim()) throw new RuleError('Say what was done today before sending the report.');
    await tx`update site_reports set status = 'submitted', submitted_by = ${user.id}, submitted_at = now(), updated_at = now() where id = ${id}`;
    await audit(tx, user, 'site-report', id, 'Sent');
  });
}

/** The engineers mark a sent report as reviewed (with a note for the site when needed). */
export async function reviewReport(user: User, id: string, note = '') {
  if (!canPlan(user)) throw new RuleError('Only the engineers review site reports.');
  await sql.begin(async tx => {
    const [r] = await tx<{ status: string }[]>`select status from site_reports where id = ${id} for update`;
    if (!r) throw new RuleError('Report not found.');
    if (r.status !== 'submitted') throw new RuleError(r.status === 'draft' ? 'The report has not been sent yet.' : 'This report was already reviewed.');
    await tx`update site_reports set status = 'reviewed', reviewed_by = ${user.id}, reviewed_at = now(), review_note = ${note.trim()}, updated_at = now() where id = ${id}`;
    await audit(tx, user, 'site-report', id, 'Reviewed', note.trim());
  });
}

export async function deleteReport(user: User, id: string) {
  await sql.begin(async tx => {
    const [r] = await tx<{ project_id: string; status: string; created_by: string | null; no: string }[]>`select project_id, status, created_by, no from site_reports where id = ${id} for update`;
    if (!r) return;
    if (r.status !== 'draft') throw new RuleError('A sent report stays; the engineers can review it.');
    if (r.created_by !== user.id && !canPlan(user)) throw new RuleError('Only the person who wrote the draft, or the engineers, can delete it.');
    await tx`delete from attachments where entity = 'site-report' and entity_id = ${id}`;
    await tx`delete from site_reports where id = ${id}`;
    await audit(tx, user, 'site-report', id, 'Deleted', r.no);
  });
}

// ---- inspection requests ---------------------------------------------------------------------------------------------------

export type Inspection = {
  id: string; no: string; project_id: string; code: string; project_name: string; activity_id: string | null; activity: string | null; title: string; location: string; requested_for: string; status: string;
  inspector_id: string | null; inspector: string | null; task_id: string | null; result_note: string; inspected_by_name: string | null; inspected_at: string | null; requested_by: string | null; requested_by_name: string | null; created_at: string; photos: number; snag_no: number | null;
};
const inspSelect = sql`
  select i.id, i.no, i.project_id, p.code, p.name project_name, i.activity_id, a.name activity, i.title, i.location, to_char(i.requested_for,'YYYY-MM-DD') requested_for, i.status, i.inspector_id, iu.name inspector, i.task_id, i.result_note,
    bu.name inspected_by_name, to_char(i.inspected_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') inspected_at, i.requested_by, ru.name requested_by_name, to_char(i.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at,
    (select count(*)::int from attachments x where x.entity = 'inspection' and x.entity_id = i.id) photos, (select s.snag_no from snags s where s.inspection_id = i.id order by s.snag_no limit 1) snag_no
  from inspection_requests i join projects p on p.id = i.project_id left join activities a on a.id = i.activity_id left join users iu on iu.id = i.inspector_id left join users bu on bu.id = i.inspected_by left join users ru on ru.id = i.requested_by`;
export const listInspections = (f: { project?: string; open?: boolean; limit?: number } = {}) => sql<Inspection[]>`${inspSelect} where true
  ${f.project ? sql`and i.project_id = ${f.project}` : sql``} ${f.open ? sql`and i.status = 'open'` : sql``} order by (i.status = 'open') desc, i.requested_for desc, i.created_at desc limit ${f.limit ?? 200}`;
export const getInspection = async (id: string, tx: Tx = sql) => (await tx<Inspection[]>`${inspSelect} where i.id = ${id}`)[0] ?? null;

/** Who inspects unless the engineer picks someone: the project manager, else the Technical Office head, else the head of site execution, else the Engineering head. */
export async function defaultInspector(projectId: string, tx: Tx = sql): Promise<string | null> {
  const team = await siteTeam(projectId, tx);
  if (team.manager_user) return team.manager_user;
  for (const pos of ['to_head', 'site_head']) { const h = await holdersOf(pos, tx); if (h.length) return h[0]; }
  return (await tx<{ id: string }[]>`select u.id from departments d join users u on u.id = d.head_user_id and u.active where d.code = 'ENG'`)[0]?.id ?? null;
}

export type InspectionInput = { project: string; activity?: string | null; title: string; location?: string; requested_for: string; inspector?: string | null };
/** The site engineer asks for an inspection before a work is covered; the inspector gets a high task due on the day asked for. */
export async function raiseInspection(user: User, i: InspectionInput): Promise<string> {
  const title = i.title.trim();
  if (!i.project) throw new RuleError('Pick the project.');
  if (!title) throw new RuleError('Say what is to be inspected.');
  if (!isDate(i.requested_for)) throw new RuleError('Give the day of the inspection as a date.');
  return sql.begin(async tx => {
    await needSite(user, i.project, 'ask for an inspection', tx);
    const p = await project(tx, i.project);
    const inspector = i.inspector || await defaultInspector(i.project, tx);
    if (!inspector) throw new RuleError('Choose who inspects: the project has no manager and no Technical Office head is set in the org chart.');
    const [u] = await tx<{ id: string; name: string }[]>`select id, name from users where id = ${inspector} and active`;
    if (!u) throw new RuleError('That inspector is not an active login.');
    const activity = i.activity ? (await tx<{ id: string; name: string }[]>`select id, name from activities where id = ${i.activity} and project_id = ${i.project}`)[0] ?? null : null;
    const no = await nextNo(tx, 'IR-');
    const [r] = await tx<{ id: string }[]>`insert into inspection_requests (no, project_id, activity_id, title, location, requested_for, inspector_id, requested_by)
      values (${no}, ${i.project}, ${activity?.id ?? null}, ${title}, ${(i.location ?? '').trim()}, ${i.requested_for}, ${u.id}, ${user.id}) returning id`;
    const [t] = await tx<{ id: string }[]>`insert into tasks (title, details, status, priority, due, assignee_id, assignee_emp_id, link_type, link_id, link_label, created_by)
      values (${`Inspect: ${title} · ${p.code}`}, ${[activity ? activity.name : '', i.location?.trim() ? `at ${i.location.trim()}` : '', `asked by ${user.name} for ${i.requested_for}`].filter(Boolean).join(' · ')}, 'todo', 'high', ${i.requested_for}, ${u.id}, ${await employeeOf(tx, u.id)}, 'inspection', ${r.id}, ${no}, ${user.id}) returning id`;
    await tx`update inspection_requests set task_id = ${t.id} where id = ${r.id}`;
    await audit(tx, user, 'inspection', r.id, 'Requested', `${no} · ${title} · ${u.name}`);
    return r.id;
  });
}

/** The inspector records Passed or Failed; a failed inspection goes straight on the snag list for the site engineer. Returns the snag's id when one was raised. */
export async function decideInspection(user: User, id: string, passed: boolean, note = ''): Promise<string | null> {
  return sql.begin(async tx => {
    const [r] = await tx<{ project_id: string; status: string; inspector_id: string | null; requested_by: string | null; title: string; location: string; activity_id: string | null; no: string }[]>`
      select project_id, status, inspector_id, requested_by, title, location, activity_id, no from inspection_requests where id = ${id} for update`;
    if (!r) throw new RuleError('Inspection request not found.');
    if (r.status !== 'open') throw new RuleError(`This inspection is already ${label(INSPECTION_STATUSES, r.status).toLowerCase()}.`);
    if (r.inspector_id !== user.id && !canPlan(user)) throw new RuleError('Only the inspector or the engineers record the result.');
    if (!passed && !note.trim()) throw new RuleError('Say what failed, so it goes on the snag list.');
    await tx`update inspection_requests set status = ${passed ? 'passed' : 'failed'}, result_note = ${note.trim()}, inspected_by = ${user.id}, inspected_at = now() where id = ${id}`;
    await tx`update tasks set status = 'done', done_at = now(), updated_at = now() where link_type = 'inspection' and link_id = ${id} and status <> 'done'`;
    await audit(tx, user, 'inspection', id, passed ? 'Passed' : 'Failed', note.trim());
    if (passed) return null;
    const cat = r.activity_id ? (await tx<{ category: string }[]>`select category from activities where id = ${r.activity_id}`)[0]?.category : null;
    const team = await siteTeam(r.project_id, tx);
    return insertSnag(tx, user, { project: r.project_id, area: r.location, description: `${r.title}: ${note.trim()}`, trade: cat ? categoryTitle(cat) : '', priority: 'high', assignee: r.requested_by ?? team.site_user, inspection: id, due: null, vendor: null });
  });
}

export async function cancelInspection(user: User, id: string) {
  await sql.begin(async tx => {
    const [r] = await tx<{ project_id: string; status: string }[]>`select project_id, status from inspection_requests where id = ${id} for update`;
    if (!r) throw new RuleError('Inspection request not found.');
    await needSite(user, r.project_id, 'cancel an inspection request', tx);
    if (r.status !== 'open') throw new RuleError('Only a waiting inspection can be cancelled.');
    await tx`update inspection_requests set status = 'cancelled' where id = ${id}`;
    await tx`delete from tasks where link_type = 'inspection' and link_id = ${id} and status <> 'done'`;
    await audit(tx, user, 'inspection', id, 'Cancelled');
  });
}

// ---- snag list -------------------------------------------------------------------------------------------------------------

export type Snag = {
  id: string; project_id: string; code: string; snag_no: number; area: string; description: string; trade: string; priority: string; status: string; vendor_id: string | null; vendor: string | null; assignee_id: string | null; assignee: string | null;
  due: string | null; inspection_id: string | null; inspection_no: string | null; found_by_name: string | null; found_at: string; fixed_by_name: string | null; fixed_at: string | null; fixed_note: string; verified_by_name: string | null; verified_at: string | null; photos: number;
};
const snagSelect = sql`
  select s.id, s.project_id, p.code, s.snag_no, s.area, s.description, s.trade, s.priority, s.status, s.vendor_id, v.name vendor, s.assignee_id, au.name assignee, to_char(s.due,'YYYY-MM-DD') due, s.inspection_id, i.no inspection_no,
    fu.name found_by_name, to_char(s.found_at at time zone ${TZ},'YYYY-MM-DD') found_at, xu.name fixed_by_name, to_char(s.fixed_at at time zone ${TZ},'YYYY-MM-DD') fixed_at, s.fixed_note, vu.name verified_by_name, to_char(s.verified_at at time zone ${TZ},'YYYY-MM-DD') verified_at,
    (select count(*)::int from attachments x where x.entity = 'snag' and x.entity_id = s.id) photos
  from snags s join projects p on p.id = s.project_id left join parties v on v.id = s.vendor_id left join users au on au.id = s.assignee_id left join inspection_requests i on i.id = s.inspection_id
  left join users fu on fu.id = s.found_by left join users xu on xu.id = s.fixed_by left join users vu on vu.id = s.verified_by`;
export const listSnags = (f: { project?: string; open?: boolean; assignee?: string } = {}) => sql<Snag[]>`${snagSelect} where true
  ${f.project ? sql`and s.project_id = ${f.project}` : sql``} ${f.open ? sql`and s.status in ('open','fixed')` : sql``} ${f.assignee ? sql`and s.assignee_id = ${f.assignee}` : sql``}
  order by p.code, (s.status in ('open','fixed')) desc, s.snag_no`;
export const getSnag = async (id: string, tx: Tx = sql) => (await tx<Snag[]>`${snagSelect} where s.id = ${id}`)[0] ?? null;
export const snagCounts = async (projectId: string, tx: Tx = sql) => {
  const rows = await tx<{ status: string; n: number }[]>`select status, count(*)::int n from snags where project_id = ${projectId} group by status`;
  const n = (s: string) => rows.find(r => r.status === s)?.n ?? 0;
  return { open: n('open'), fixed: n('fixed'), verified: n('verified'), cancelled: n('cancelled'), outstanding: n('open') + n('fixed') };
};

export type SnagInput = { project: string; area?: string; description: string; trade?: string; priority?: string; vendor?: string | null; assignee?: string | null; due?: string | null; inspection?: string | null };
async function insertSnag(tx: Tx, user: User, i: SnagInput): Promise<string> {
  const description = i.description.trim();
  if (!description) throw new RuleError('Describe the snag.');
  const priority = i.priority && (SNAG_PRIORITIES as readonly string[]).includes(i.priority) ? i.priority : 'normal';
  if (i.due && !isDate(i.due)) throw new RuleError('Give the due date as a date.');
  await project(tx, i.project, true);
  const team = await siteTeam(i.project, tx);
  const assignee = i.assignee || team.site_user || user.id;
  const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(snag_no), 0)::int + 1 n from snags where project_id = ${i.project}`;
  const [s] = await tx<{ id: string }[]>`insert into snags (project_id, snag_no, area, description, trade, priority, vendor_id, assignee_id, due, inspection_id, found_by)
    values (${i.project}, ${n}, ${(i.area ?? '').trim()}, ${description}, ${(i.trade ?? '').trim()}, ${priority}, ${i.vendor || null}, ${assignee}, ${i.due || null}, ${i.inspection || null}, ${user.id}) returning id`;
  await audit(tx, user, 'snag', s.id, 'Found', `S-${n} · ${description.slice(0, 80)}`);
  return s.id;
}
/** A defect found on site or at the handover walk, for the site engineer (or the subcontractor named) to fix. */
export async function addSnag(user: User, i: SnagInput): Promise<string> {
  if (!i.project) throw new RuleError('Pick the project.');
  return sql.begin(async tx => { await needSite(user, i.project, 'add to the snag list', tx); return insertSnag(tx, user, i); });
}

/** open > fixed (the site), fixed > verified (the engineers or the site team), fixed or verified > open again, open or fixed > cancelled. */
export async function setSnagStatus(user: User, id: string, status: string, note = '') {
  await sql.begin(async tx => {
    const [s] = await tx<{ project_id: string; status: string; snag_no: number }[]>`select project_id, status, snag_no from snags where id = ${id} for update`;
    if (!s) throw new RuleError('Snag not found.');
    await needSite(user, s.project_id, 'change the snag list', tx);
    const ok: Record<string, string[]> = { fixed: ['open'], verified: ['fixed'], open: ['fixed', 'verified'], cancelled: ['open', 'fixed'] };
    if (!ok[status]) throw new RuleError('Unknown status.');
    if (!ok[status].includes(s.status)) throw new RuleError(`S-${s.snag_no} is ${label(SNAG_STATUSES, s.status).toLowerCase()}; it cannot be marked ${label(SNAG_STATUSES, status).toLowerCase()} from there.`);
    if ((status === 'verified' || status === 'cancelled') && !canPlan(user) && !(await onSiteTeam(s.project_id, user.id, tx))) throw new RuleError('Only the engineers verify or cancel snags.');
    if (status === 'fixed') await tx`update snags set status = 'fixed', fixed_by = ${user.id}, fixed_at = now(), fixed_note = ${note.trim()} where id = ${id}`;
    else if (status === 'verified') await tx`update snags set status = 'verified', verified_by = ${user.id}, verified_at = now() where id = ${id}`;
    else if (status === 'open') await tx`update snags set status = 'open', fixed_by = null, fixed_at = null, fixed_note = '', verified_by = null, verified_at = null where id = ${id}`;
    else await tx`update snags set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'snag', id, label(SNAG_STATUSES, status), note.trim());
  });
}

// ---- handover certificate --------------------------------------------------------------------------------------------------

export type Handover = {
  project_id: string; no: string; date: string; status: string; client_rep: string; company_rep_id: string | null; company_rep: string | null; defects_months: number; outstanding: string; notes: string; snags_open: number;
  signed_by_name: string | null; signed_at: string | null; created_by_name: string | null; created_at: string;
};
export const getHandover = async (projectId: string, tx: Tx = sql) => (await tx<Handover[]>`
  select h.project_id, h.no, to_char(h.date,'YYYY-MM-DD') date, h.status, h.client_rep, h.company_rep_id, cu.name company_rep, h.defects_months, h.outstanding, h.notes, h.snags_open,
    su.name signed_by_name, to_char(h.signed_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') signed_at, bu.name created_by_name, to_char(h.created_at at time zone ${TZ},'YYYY-MM-DD') created_at
  from handovers h left join users cu on cu.id = h.company_rep_id left join users su on su.id = h.signed_by left join users bu on bu.id = h.created_by where h.project_id = ${projectId}`)[0] ?? null;

export const canHandover = (u: User) => canPlan(u) || hasRole(u, 'finance');
export type HandoverInput = { date: string; client_rep: string; company_rep?: string | null; defects_months: string | number; outstanding?: string; notes?: string };
/** Drafts (or edits) the certificate; the first draft moves a project at Execution to Handover. */
export async function saveHandover(user: User, projectId: string, i: HandoverInput) {
  if (!canHandover(user)) throw new RuleError('Only the engineers or Finance prepare the handover certificate.');
  if (!isDate(i.date)) throw new RuleError('Give the handover date as a date.');
  const months = Number(i.defects_months);
  if (!Number.isInteger(months) || months < 0 || months > 60) throw new RuleError('The defects liability period is a number of months (0 to 60).');
  await sql.begin(async tx => {
    const p = await project(tx, projectId, true);
    if (!['execution', 'handover', 'closed'].includes(p.phase ?? '')) throw new RuleError(`${p.code} is at ${phaseLabel(p.phase) || 'the start'}; the handover comes after Execution.`);
    const [h] = await tx<{ status: string }[]>`select status from handovers where project_id = ${projectId} for update`;
    if (h?.status === 'signed') throw new RuleError('The certificate is signed; it cannot change any more.');
    const vals = { date: i.date, client_rep: i.client_rep.trim(), company_rep_id: i.company_rep || user.id, defects_months: months, outstanding: (i.outstanding ?? '').trim(), notes: (i.notes ?? '').trim(), updated_at: new Date() };
    if (h) await tx`update handovers set ${tx(vals)} where project_id = ${projectId}`;
    else await tx`insert into handovers ${tx({ project_id: projectId, no: await nextNo(tx, 'HO-'), ...vals, created_by: user.id })}`;
    await audit(tx, user, 'handover', projectId, h ? 'Certificate edited' : 'Certificate drafted', i.date);
    if (p.phase === 'execution') await movePhase(tx, user, projectId, 'handover', 'Handover started: certificate drafted');
  });
}

/** Signs the certificate: every snag must be verified (or the outstanding ones listed and accepted by the client). */
export async function signHandover(user: User, projectId: string) {
  if (!canHandover(user)) throw new RuleError('Only the engineers or Finance sign the handover certificate.');
  await sql.begin(async tx => {
    const [h] = await tx<{ status: string; outstanding: string; no: string }[]>`select status, outstanding, no from handovers where project_id = ${projectId} for update`;
    if (!h) throw new RuleError('Draft the certificate first.');
    if (h.status === 'signed') throw new RuleError('The certificate is already signed.');
    const c = await snagCounts(projectId, tx);
    if (c.outstanding && !h.outstanding.trim()) throw new RuleError(`${c.outstanding} snag${c.outstanding === 1 ? ' is' : 's are'} not verified yet: fix and verify them, or list them under "Outstanding works accepted by the client" and sign.`);
    await tx`update handovers set status = 'signed', signed_by = ${user.id}, signed_at = now(), snags_open = ${c.outstanding}, updated_at = now() where project_id = ${projectId}`;
    await audit(tx, user, 'handover', projectId, 'Certificate signed', `${h.no}${c.outstanding ? ` · ${c.outstanding} outstanding` : ''}`);
  });
}

// ---- the Site execution page, pending steps and the summary ----------------------------------------------------------------

export type SiteRow = {
  id: string; code: string; name: string; phase: string | null; site_eng: string | null; manager: string | null; mine: boolean; last_report: string | null; today_id: string | null; today_status: string | null;
  reports: number; open_inspections: number; open_snags: number; fixed_snags: number; handover_status: string | null;
};
/** Every Active project in Execution or Handover with today's report, the waiting inspections and the open snags; site staff without the roles see their own projects. */
export async function siteRows(user: User, now = today()): Promise<SiteRow[]> {
  const rows = await sql<SiteRow[]>`
    select p.id, p.code, p.name, p.phase, se.name site_eng, me.name manager, (se.user_id = ${user.id} or me.user_id = ${user.id}) mine,
      (select to_char(max(r.day),'YYYY-MM-DD') from site_reports r where r.project_id = p.id and r.status <> 'draft') last_report,
      (select r.id from site_reports r where r.project_id = p.id and r.day = ${now}::date) today_id, (select r.status from site_reports r where r.project_id = p.id and r.day = ${now}::date) today_status,
      (select count(*)::int from site_reports r where r.project_id = p.id) reports,
      (select count(*)::int from inspection_requests i where i.project_id = p.id and i.status = 'open') open_inspections,
      (select count(*)::int from snags s where s.project_id = p.id and s.status = 'open') open_snags, (select count(*)::int from snags s where s.project_id = p.id and s.status = 'fixed') fixed_snags,
      (select h.status from handovers h where h.project_id = p.id) handover_status
    from projects p left join employees se on se.id = p.site_eng_id left join employees me on me.id = p.manager_id
    where not p.is_office and p.status = 'Active' and (p.phase in ('execution', 'handover') or exists (select 1 from site_reports r where r.project_id = p.id))
    order by (se.user_id = ${user.id} or me.user_id = ${user.id}) desc, p.code`;
  return canPlan(user) || hasRole(user, 'finance') ? rows : rows.filter(r => r.mine);
}

/** For the Tasks page's pending steps: today's report for the site team, snags to fix, fixed snags for the engineers to verify. */
export async function siteSteps(user: User, now = today()): Promise<{ kind: string; title: string; href: string; since?: string | null }[]> {
  const out: { kind: string; title: string; href: string; since?: string | null }[] = [];
  const [due, mine, toVerify] = await Promise.all([
    sql<{ id: string; code: string }[]>`select p.id, p.code from projects p left join employees se on se.id = p.site_eng_id left join employees me on me.id = p.manager_id
      where not p.is_office and p.status = 'Active' and p.phase = 'execution' and (se.user_id = ${user.id} or me.user_id = ${user.id})
      and not exists (select 1 from site_reports r where r.project_id = p.id and r.day = ${now}::date and r.status <> 'draft') order by p.code`,
    sql<{ id: string; code: string; n: number; since: string }[]>`select p.id, p.code, count(*)::int n, to_char(min(s.found_at),'YYYY-MM-DD') since from snags s join projects p on p.id = s.project_id where s.status = 'open' and s.assignee_id = ${user.id} group by p.id, p.code order by p.code`,
    canPlan(user) ? sql<{ id: string; code: string; n: number; since: string }[]>`select p.id, p.code, count(*)::int n, to_char(min(s.fixed_at),'YYYY-MM-DD') since from snags s join projects p on p.id = s.project_id where s.status = 'fixed' group by p.id, p.code order by p.code` : [],
  ]);
  for (const p of due) out.push({ kind: 'site', title: `Send today's site report for ${p.code}`, href: `/site/reports/new?project=${p.id}` });
  for (const s of mine) out.push({ kind: 'snag', title: `Fix ${s.n} snag${s.n === 1 ? '' : 's'} on ${s.code}`, href: `/site/snags?project=${s.id}`, since: s.since });
  for (const s of toVerify) out.push({ kind: 'snag', title: `Verify ${s.n} fixed snag${s.n === 1 ? '' : 's'} on ${s.code}`, href: `/site/snags?project=${s.id}`, since: s.since });
  return out;
}

export type SummaryRow = { id: string; code: string; name: string; reports: number; man_days: number; hours: number; inspections: number; passed: number; failed: number; snags: number; open_snags: number; verified_snags: number; handover: string | null };
/** Site summary per project for a month (YYYY-MM): reports sent, man-days and hours, inspections and their results, snags. */
export const siteSummary = (month: string) => sql<SummaryRow[]>`
  with r as (select project_id, count(*)::int reports, coalesce(sum((select sum(m.headcount) from site_report_manpower m where m.report_id = r.id)), 0)::int man_days,
      coalesce(sum((select sum(m.headcount * m.hours) from site_report_manpower m where m.report_id = r.id)), 0)::float hours from site_reports r where r.status <> 'draft' and to_char(r.day,'YYYY-MM') = ${month} group by project_id),
    i as (select project_id, count(*)::int inspections, count(*) filter (where status = 'passed')::int passed, count(*) filter (where status = 'failed')::int failed from inspection_requests where to_char(created_at at time zone ${TZ},'YYYY-MM') <= ${month} group by project_id),
    s as (select project_id, count(*)::int snags, count(*) filter (where status in ('open','fixed'))::int open_snags, count(*) filter (where status = 'verified')::int verified_snags from snags group by project_id)
  select p.id, p.code, p.name, coalesce(r.reports, 0) reports, coalesce(r.man_days, 0) man_days, coalesce(r.hours, 0) hours, coalesce(i.inspections, 0) inspections, coalesce(i.passed, 0) passed, coalesce(i.failed, 0) failed,
    coalesce(s.snags, 0) snags, coalesce(s.open_snags, 0) open_snags, coalesce(s.verified_snags, 0) verified_snags, h.status handover
  from projects p left join r on r.project_id = p.id left join i on i.project_id = p.id left join s on s.project_id = p.id left join handovers h on h.project_id = p.id
  where not p.is_office and (r.project_id is not null or i.project_id is not null or s.project_id is not null or h.project_id is not null or p.phase in ('execution','handover')) order by p.code`;

/** Manpower by trade across a project's sent reports (the project page and the print). */
export const manpowerByTrade = (projectId: string) => sql<{ trade: string; man_days: number; hours: number }[]>`
  select m.trade, sum(m.headcount)::int man_days, sum(m.headcount * m.hours)::float hours from site_report_manpower m join site_reports r on r.id = m.report_id
  where r.project_id = ${projectId} and r.status <> 'draft' group by m.trade order by man_days desc, m.trade`;
