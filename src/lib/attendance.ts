import 'server-only';
import { sql, type Tx } from './db';
import { audit, getSettings } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ } from './dates';
import { addAttachment } from './attachments';
import { appUrl, sendMail } from './mail';
import { startOnClockIn } from './tasks';
import { type HrSettings, type Pin, LOCATION_HELP, hourlyRate, hrSettings, lateMinutes, localParts, officeSet, placeOf, timesheetAmounts, whereText, workedAndOvertime } from './attendance-calc';
import { CATEGORIES, type Category, type Pick, categoryOf, clockCategories, defaultPick, offeredCategories, whatLabel, whatPhrase } from './clock-categories';

// Clock in and out, timesheets and the work sessions (what the person is doing: Office, Site or Design on a project, switched during the day).
// The employee's own phone writes the records; HR reads and checks them.

export const getHr = async (tx: Tx = sql) => hrSettings((await getSettings(tx)).hr);
export async function saveHr(user: User, s: HrSettings) {
  if (!hasRole(user, 'hr')) throw new RuleError('Only HR or Management can change attendance settings.');
  await sql.begin(async tx => {
    await tx`update settings set hr = ${tx.json(s as never)} where id = 1`;
    await audit(tx, user, 'settings', 'hr', 'Changed attendance settings', officeSet(s) ? `office at ${s.office_lat}, ${s.office_lng} ± ${s.office_radius_m} m` : 'office location not set');
  });
}

export type Me = { id: string; name: string; work_location: 'office' | 'site'; basic: number; allowances: number; dept_id: string | null; dept_name: string | null; project_id: string | null };
/** The employee file behind a login, or null when the login has none (then there is nothing to clock). */
export async function employeeOf(userId: string, tx: Tx = sql): Promise<Me | null> {
  const [e] = await tx<Me[]>`select e.id, e.name, e.work_location, e.basic, e.allowances, e.dept_id, d.name dept_name, e.project_id
    from employees e left join departments d on d.id = e.dept_id where e.user_id = ${userId} and e.active`;
  return e ?? null;
}

export type Pos = { lat: number; lng: number; acc: number | null } | null;
export type Record_ = {
  id: string; employee_id: string; name: string; day: string; in_at: string; out_at: string | null; in_time: string; out_time: string | null;
  category: string; project_id: string | null; project_code: string | null;
  in_lat: number | null; in_lng: number | null; in_acc: number | null; in_place: string; out_lat: number | null; out_lng: number | null; out_acc: number | null; out_place: string | null;
  late_min: number; overtime_min: number; worked_min: number; checked_by: string | null; checked_at: string | null; checker: string | null; hr_note: string;
};
const recSelect = (tx: Tx, where = sql``, limit = 0) => tx<Record_[]>`
  select a.id, a.employee_id, e.name, to_char(a.day,'YYYY-MM-DD') as day, a.in_at::text in_at, a.out_at::text out_at,
    to_char(a.in_at at time zone ${TZ},'HH24:MI') in_time, to_char(a.out_at at time zone ${TZ},'HH24:MI') out_time,
    a.category, a.project_id, p.code project_code,
    a.in_lat, a.in_lng, a.in_acc, a.in_place, a.out_lat, a.out_lng, a.out_acc, a.out_place, a.late_min, a.overtime_min, a.worked_min,
    a.checked_by, to_char(a.checked_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') checked_at, u.name checker, a.hr_note
  from attendance a join employees e on e.id = a.employee_id left join projects p on p.id = a.project_id left join users u on u.id = a.checked_by
  ${where} order by a.in_at desc ${limit ? sql`limit ${limit}` : sql``}`;

export const openRecord = async (employeeId: string, tx: Tx = sql) => (await recSelect(tx, sql`where a.employee_id = ${employeeId} and a.out_at is null`))[0] ?? null;
/** The person's latest clock-in, open or closed: what they did last time is what the phone preselects. */
export const lastRecord = async (employeeId: string, tx: Tx = sql) => (await recSelect(tx, sql`where a.employee_id = ${employeeId}`, 1))[0] ?? null;

// ---- Projects as the clock sees them: code, and the location pin when one is set.

export type ProjectPin = { id: string; code: string; name: string; pin: Pin; radius_m: number };
const pinOf = (p: { site_lat: number | null; site_lng: number | null; site_radius_m: number }): Pin =>
  p.site_lat !== null && p.site_lng !== null ? { lat: +p.site_lat, lng: +p.site_lng, radius_m: +p.site_radius_m } : null;
async function projectFor(tx: Tx, projectId: string | null, activeOnly = false): Promise<ProjectPin | null> {
  if (!projectId) return null;
  const [p] = await tx<{ id: string; code: string; name: string; site_lat: number | null; site_lng: number | null; site_radius_m: number }[]>`
    select id, code, name, site_lat, site_lng, site_radius_m from projects where id = ${projectId} and not is_office ${activeOnly ? sql`and status = 'Active'` : sql``}`;
  return p ? { id: p.id, code: p.code, name: p.name, pin: pinOf(p), radius_m: +p.site_radius_m } : null;
}
/** The projects the phone offers at a clock-in or a switch, with whether each has its pin yet. */
export const projectPins = () => sql<{ id: string; code: string; name: string; pinned: boolean; radius: number }[]>`
  select id, code, name, (site_lat is not null and site_lng is not null) pinned, site_radius_m radius from projects where not is_office and status = 'Active' order by code`;

/** Engineers, HR or Finance drop the project's location pin (standing on the site, or typed from the Maps app): site clock-ins on it must then be within the allowed distance. */
export async function savePin(user: User, projectId: string, lat: number | null, lng: number | null, radiusM: number) {
  if (!hasRole(user, 'finance', 'engineering', 'projects', 'hr')) throw new RuleError('Only Engineering, Projects, HR or Finance can set a project location.');
  if ((lat === null) !== (lng === null)) throw new RuleError('Enter both the latitude and the longitude, or clear both.');
  if (lat !== null && (isNaN(lat) || isNaN(lng!) || Math.abs(lat) > 90 || Math.abs(lng!) > 180)) throw new RuleError('That is not a valid position.');
  if (!(radiusM > 0) || isNaN(radiusM)) throw new RuleError('Type the allowed distance in metres.');
  await sql.begin(async tx => {
    const n = await tx`update projects set site_lat = ${lat}, site_lng = ${lng}, site_radius_m = ${Math.round(radiusM)} where id = ${projectId} and not is_office`;
    if (!n.count) throw new RuleError('Project not found.');
    await audit(tx, user, 'project', projectId, lat !== null ? 'Site location set' : 'Site location cleared', lat !== null ? `${lat}, ${lng} ± ${Math.round(radiusM)} m` : '');
  });
}

/** What the clock-in or switch is for, checked: a category the person may pick, and a real project when the category needs one. */
async function resolve(tx: Tx, me: Me, user: User, pick: Pick | undefined): Promise<{ cat: Category; project: ProjectPin | null; note: string }> {
  const p = pick ?? defaultPick(me, null);
  const cat = categoryOf(p.category);
  // the Clock in page offers Office and Site on a project; design work is started from the project's Design page
  const allowed = cat?.key === 'design' ? offeredCategories(me, user).some(c => c.key === 'design') : !!cat?.clock;
  if (!cat || !allowed) throw new RuleError('Choose what you are clocking in for.');
  const project = cat.project ? await projectFor(tx, p.projectId, true) : null;   // only a project still Active, as the phone offers
  if (cat.project && !project) throw new RuleError('Choose the project.');
  return { cat, project, note: (p.note ?? '').trim() };
}

/** The person clocks in: a selfie is required, the position is kept, and it is checked against the office (Office, Design…) or the project's pin (Site) when one is set. */
export async function clockIn(user: User, pos: Pos, photo: { name: string; body: Buffer } | null, now = new Date(), pick?: Pick) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  if (!photo) throw new RuleError('Take a selfie first: the camera opens when you tap Clock in.');
  const s = await getHr();
  const { cat, project, note } = await resolve(sql, me, user, pick);
  if (!cat.clock) throw new RuleError('Clock in for Office or Site on a project. Design work is started from the project\'s Design page.');
  const pin = project?.pin ?? null;
  const { place, distance } = placeOf(cat.rule, pos, s, pin);
  const compared = cat.rule === 'site' ? !!pin : officeSet(s);
  if (compared) {
    const at = cat.rule === 'site' ? `the ${project!.code} site` : 'the office';
    if (!pos) throw new RuleError(`Your phone gave no location, so the system cannot see you are at ${at}. ${LOCATION_HELP} Then try again.`);
    if (place === 'away') throw new RuleError(`You are about ${distance} m from ${at} (allowed ${cat.rule === 'site' ? pin!.radius_m : s.office_radius_m} m). Clock in at ${at}.`);
  }
  let moved = 0;
  const id = await sql.begin(async tx => {
    const open = await openRecord(me.id, tx);
    if (open) throw new RuleError(`You are already clocked in since ${open.in_time}. Clock out first.`);
    const [r] = await tx<{ id: string }[]>`insert into attendance (employee_id, day, in_at, in_lat, in_lng, in_acc, in_place, late_min, category, project_id)
      values (${me.id}, ${localParts(now, TZ).day}, ${now}, ${pos?.lat ?? null}, ${pos?.lng ?? null}, ${pos?.acc ?? null}, ${place}, ${lateMinutes(now, TZ, s)}, ${cat.key}, ${project?.id ?? null}) returning id`;
    await closeStale(tx, me.id);            // a design clock left running from before this update: closed unfinished, not charged until now
    await openNewSession(tx, me, cat, project, note, r.id, now);
    if (project) moved = await startOnClockIn(tx, me.id, user.id, project.id);   // update 18: the project's tasks start
    await audit(tx, user, 'attendance', r.id, 'Clocked in', `${whatLabel(cat, project?.code)} · ${place}${distance !== null ? ` · ${distance} m` : ''}`);
    return r.id;
  });
  await addAttachment(user, 'attendance', id, photo.name, photo.body, 'in');
  if (cat.key === 'site') await emailSiteClockIn(s, me.name, project!.code, now, pos, place, distance).catch(e => console.error('site clock-in email', e));
  return { id, message: whereText('in', whatPhrase(cat, project?.code), { place, distance, acc: pos?.acc ?? null, hasPos: !!pos, rule: cat.rule, compared }) + movedText(moved) };
}

/** Who hears of a site clock-in: the address in HR's attendance settings, else everyone given HR who is not Management. */
export async function hrEmails(s: HrSettings, tx: Tx = sql) {
  if (s.hr_email) return [s.hr_email];
  return (await tx<{ email: string }[]>`select email from users where active and 'hr' = any(coalesce(access, '{}')) and not ('management' = any(roles)) order by name`).map(u => u.email);
}

/** Item 4 of update 20: a clock-in on site emails HR where the phone was, with a map link. HR also sees it under Attendance. */
async function emailSiteClockIn(s: HrSettings, name: string, code: string, at: Date, pos: Pos, place: string | null, distance: number | null) {
  const to = await hrEmails(s);
  if (!to.length) return;
  const time = at.toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const where = pos ? `Location: https://maps.google.com/?q=${pos.lat},${pos.lng}${pos.acc ? ` (accurate to about ${pos.acc} m)` : ''}` : 'The phone gave no location.';
  const vs = distance !== null ? `\nDistance from the ${code} site pin: about ${distance} m${place === 'away' ? ' (outside the allowed distance)' : ''}.` : '';
  await sendMail({ to, subject: `${name} clocked in on site ${code}`, text: `${name} clocked in on site ${code} at ${time} (Cairo time).\n${where}${vs}\n\nAttendance: ${appUrl('/attendance')}\n\nRight Space` });
}

/** The person clocks out: the same selfie and position, the open stretch is closed, then the day's worked and overtime minutes are fixed. */
export async function clockOut(user: User, pos: Pos, photo: { name: string; body: Buffer } | null, now = new Date()) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  if (!photo) throw new RuleError('Take a selfie first: the camera opens when you tap Clock out.');
  const s = await getHr();
  const out = await sql.begin(async tx => {
    const open = await openRecord(me.id, tx);
    if (!open) throw new RuleError('You are not clocked in.');
    const inAt = new Date(open.in_at);
    if (now <= inAt) throw new RuleError('The clock-out time is before the clock-in.');
    const cur = await openSession(me.id, tx);   // the position is checked against what the person is on now, not what the day started as
    const cat = categoryOf(cur?.category ?? open.category) ?? CATEGORIES[0];
    const project = await projectFor(tx, cur ? cur.project_id : open.project_id);
    const pin = project?.pin ?? null;
    const { place, distance } = placeOf(cat.rule, pos, s, pin);
    const { worked, overtime } = workedAndOvertime(inAt, now, TZ, s);
    await tx`update attendance set out_at = ${now}, out_lat = ${pos?.lat ?? null}, out_lng = ${pos?.lng ?? null}, out_acc = ${pos?.acc ?? null}, out_place = ${place},
      worked_min = ${worked}, overtime_min = ${overtime} where id = ${open.id}`;
    await endOpenSession(tx, me, now, s);
    await audit(tx, user, 'attendance', open.id, 'Clocked out', `${worked} min worked, ${overtime} min overtime · ${place}`);
    const compared = cat.rule === 'site' ? !!pin : officeSet(s);
    return { id: open.id, message: whereText('out', whatPhrase(cat, project?.code), { place, distance, acc: pos?.acc ?? null, hasPos: !!pos, rule: cat.rule, compared }) };
  });
  await addAttachment(user, 'attendance', out.id, photo.name, photo.body, 'out');
  return out;
}

/** During the day the person changes what they are doing: the current stretch is closed and a new one opens; no selfie or position for a switch. */
export async function switchTo(user: User, pick: Pick, now = new Date()) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  const s = await getHr();
  return sql.begin(async tx => {
    const open = await openRecord(me.id, tx);
    if (!open) throw new RuleError('Clock in first, then switch.');
    const { cat, project, note } = await resolve(tx, me, user, pick);
    const cur = await openSession(me.id, tx);
    if (cur && cur.category === cat.key && (cur.project_id ?? null) === (project?.id ?? null)) throw new RuleError(`You are already on ${whatLabel(cat, project?.code)} since ${cur.start_time}.`);
    await endOpenSession(tx, me, now, s);
    const id = await openNewSession(tx, me, cat, project, note, open.id, now);
    if (project) await startOnClockIn(tx, me.id, user.id, project.id);
    await audit(tx, user, 'attendance', open.id, 'Switched', whatLabel(cat, project?.code));
    if (project) await audit(tx, user, 'project', project.id, `${cat.short} work started`, me.name);
    return id;
  });
}

/** The design clock (update 20): on the project's Design page the designer starts design work on that project, while clocked in;
 *  its hours and their cost go to the project. Stop goes back to what the day was clocked in for. */
export async function startDesign(user: User, projectId: string, note = '', now = new Date()) {
  return switchTo(user, { category: 'design', projectId, note }, now);
}
export async function stopDesign(user: User, now = new Date()) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  const open = await openRecord(me.id);
  const cur = await openSession(me.id);
  if (!open || cur?.category !== 'design') throw new RuleError('The design clock is not running.');
  const back = categoryOf(open.category)?.clock ? { category: open.category, projectId: open.project_id } : { category: 'office', projectId: null };
  return switchTo(user, back, now);
}

/** HR looked at the selfies and the place; a note can say what was wrong. */
export async function checkRecord(user: User, id: string, note: string) {
  if (!hasRole(user, 'hr')) throw new RuleError('Only HR can check attendance.');
  await sql.begin(async tx => {
    const n = await tx`update attendance set checked_by = ${user.id}, checked_at = now(), hr_note = ${note.trim()} where id = ${id}`;
    if (!n.count) throw new RuleError('Record not found.');
    await audit(tx, user, 'attendance', id, 'Checked', note.trim());
  });
}

/** HR fixes a forgotten clock-out (the person left without tapping): the day, and the stretch still running, are closed at the time HR types. */
export async function closeRecord(user: User, id: string, outAt: Date, note: string) {
  if (!hasRole(user, 'hr')) throw new RuleError('Only HR can close a day.');
  const s = await getHr();
  await sql.begin(async tx => {
    const [r] = await tx<{ employee_id: string; in_at: string; out_at: string | null; basic: number; allowances: number }[]>`
      select a.employee_id, a.in_at::text, a.out_at::text, e.basic, e.allowances from attendance a join employees e on e.id = a.employee_id where a.id = ${id} for update of a`;
    if (!r) throw new RuleError('Record not found.');
    if (r.out_at) throw new RuleError('This day is already closed.');
    const inAt = new Date(r.in_at);
    if (outAt <= inAt) throw new RuleError('The clock-out time must be after the clock-in.');
    const { worked, overtime } = workedAndOvertime(inAt, outAt, TZ, s);
    await tx`update attendance set out_at = ${outAt}, out_place = 'unknown', worked_min = ${worked}, overtime_min = ${overtime}, hr_note = ${note.trim()}, checked_by = ${user.id}, checked_at = now() where id = ${id}`;
    await endOpenSession(tx, { id: r.employee_id, basic: r.basic, allowances: r.allowances }, outAt, s, id);
    await audit(tx, user, 'attendance', id, 'Closed by HR', note.trim());
  });
}

export const listRecords = (opts: { employee?: string; period?: string; day?: string } = {}) => recSelect(sql, sql`where true
  ${opts.employee ? sql`and a.employee_id = ${opts.employee}` : sql``}
  ${opts.period ? sql`and to_char(a.day,'YYYY-MM') = ${opts.period}` : sql``}
  ${opts.day ? sql`and a.day = ${opts.day}` : sql``}`);

export type MonthRow = { employee_id: string; code: string | null; name: string; work_location: string; days: number; late_days: number; late_min: number; overtime_min: number; worked_min: number; unchecked: number; open: number; away: number };
/** The month per employee: days present, lateness, overtime, selfies not yet checked, days still open, clock-ins away from the office or the site pin. */
export const monthSummary = (period: string) => sql<MonthRow[]>`
  select e.id employee_id, e.code, e.name, e.work_location,
    count(a.id)::int days, count(a.id) filter (where a.late_min > 0)::int late_days,
    coalesce(sum(a.late_min),0)::int late_min, coalesce(sum(a.overtime_min),0)::int overtime_min, coalesce(sum(a.worked_min),0)::int worked_min,
    count(a.id) filter (where a.checked_by is null)::int unchecked, count(a.id) filter (where a.out_at is null)::int open,
    count(a.id) filter (where a.in_place = 'away' or a.out_place = 'away')::int away
  from employees e left join attendance a on a.employee_id = e.id and to_char(a.day,'YYYY-MM') = ${period}
  where e.active or a.id is not null
  group by e.id order by e.code, e.name`;

/** What the timesheet gives payroll for the month: overtime pay and the lateness deduction per employee, at each person's hourly cost. */
export async function timesheetFeed(period: string, tx: Tx = sql) {
  const s = await getHr(tx);
  const rows = await tx<{ employee_id: string; basic: number; allowances: number; late_min: number; overtime_min: number }[]>`
    select e.id employee_id, e.basic, e.allowances, coalesce(sum(a.late_min),0)::int late_min, coalesce(sum(a.overtime_min),0)::int overtime_min
    from employees e join attendance a on a.employee_id = e.id and to_char(a.day,'YYYY-MM') = ${period} group by e.id`;
  return new Map(rows.map(r => [r.employee_id, timesheetAmounts(r, hourlyRate(r.basic, r.allowances, s), s)]));
}

// ---- Work sessions: one stretch per category (and project) during a clocked-in day. Design stretches carry their cost to the project.

export type Session = { id: string; employee_id: string; name: string; category: string; project_id: string | null; project_code: string | null; attendance_id: string | null; start_at: string; end_at: string | null; start_time: string; end_time: string | null; day: string; minutes: number; rate: number; cost: number; note: string };
const sesSelect = (tx: Tx, where = sql``) => tx<Session[]>`
  select w.id, w.employee_id, e.name, w.category, w.project_id, p.code project_code, w.attendance_id, w.start_at::text start_at, w.end_at::text end_at,
    to_char(w.start_at at time zone ${TZ},'HH24:MI') start_time, to_char(w.end_at at time zone ${TZ},'HH24:MI') end_time, to_char(w.start_at at time zone ${TZ},'YYYY-MM-DD') as day,
    w.minutes, w.rate, w.cost, w.note
  from work_sessions w join employees e on e.id = w.employee_id left join projects p on p.id = w.project_id ${where} order by w.start_at desc`;
export const openSession = async (employeeId: string, tx: Tx = sql) => (await sesSelect(tx, sql`where w.employee_id = ${employeeId} and w.end_at is null`))[0] ?? null;

/** Closes the stretch still running, if any (only the given day's when HR closes a day): minutes and cost (the person's hourly cost from the
 *  salary, as HR set the standard hours) are fixed now; a stretch cannot end before it started. */
async function endOpenSession(tx: Tx, me: { id: string; basic: number; allowances: number }, now: Date, s: HrSettings, attendanceId?: string) {
  const open = await openSession(me.id, tx);
  if (!open || (attendanceId && open.attendance_id !== attendanceId)) return null;
  const start = new Date(open.start_at);
  const end = now > start ? now : start;
  const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  const rate = hourlyRate(me.basic, me.allowances, s);
  const cost = Math.round(minutes / 60 * rate * 100) / 100;
  await tx`update work_sessions set end_at = ${end}, minutes = ${minutes}, rate = ${rate}, cost = ${cost} where id = ${open.id}`;
  return { ...open, minutes, rate, cost };
}
/** A design clock from before this update still running at the next clock-in: closed where it started, 0 minutes and 0 cost, with a note HR can read. */
async function closeStale(tx: Tx, employeeId: string) {
  await tx`update work_sessions set end_at = start_at, minutes = 0, cost = 0, note = trim(both ' ·' from note || ' · left running, closed unfinished at the next clock-in')
    where employee_id = ${employeeId} and end_at is null`;
}
const movedText = (n: number) => n ? ` ${n === 1 ? 'Your task on this project is' : `${n} of your tasks on this project are`} now In progress.` : '';

async function openNewSession(tx: Tx, me: { id: string }, cat: Category, project: ProjectPin | null, note: string, attendanceId: string, now: Date) {
  const [r] = await tx<{ id: string }[]>`insert into work_sessions (employee_id, project_id, category, start_at, note, attendance_id)
    values (${me.id}, ${project?.id ?? null}, ${cat.key}, ${now}, ${note}, ${attendanceId}) returning id`;
  return r.id;
}

export const listSessions = (opts: { employee?: string; project?: string; period?: string; category?: string } = {}) => sesSelect(sql, sql`where true
  ${opts.employee ? sql`and w.employee_id = ${opts.employee}` : sql``}
  ${opts.project ? sql`and w.project_id = ${opts.project}` : sql``}
  ${opts.category ? sql`and w.category = ${opts.category}` : sql``}
  ${opts.period ? sql`and to_char(w.start_at at time zone ${TZ},'YYYY-MM') = ${opts.period}` : sql``}`);

export type DesignTotal = { project_id: string; code: string; name: string; minutes: number; cost: number; people: number; open: number };
/** Design hours and cost per project, with how many designers and whether someone is on it right now. */
export const designTotals = (projectId?: string) => sql<DesignTotal[]>`
  select p.id project_id, p.code, p.name, coalesce(sum(d.minutes),0)::int minutes, coalesce(sum(d.cost),0) cost,
    count(distinct d.employee_id)::int people, count(d.id) filter (where d.end_at is null)::int open
  from projects p join work_sessions d on d.project_id = p.id and d.category = 'design' ${projectId ? sql`where p.id = ${projectId}` : sql``}
  group by p.id order by p.code`;

export type CategoryRow = { employee_id: string; code: string | null; name: string; category: string; minutes: number };
/** Minutes per employee and category in a month, from the closed stretches. */
export const categoryMinutes = (period: string) => sql<CategoryRow[]>`
  select e.id employee_id, e.code, e.name, w.category, sum(w.minutes)::int minutes
  from work_sessions w join employees e on e.id = w.employee_id
  where to_char(w.start_at at time zone ${TZ},'YYYY-MM') = ${period}
  group by e.id, w.category order by e.code, e.name, w.category`;
