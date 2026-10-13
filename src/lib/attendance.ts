import 'server-only';
import { sql, type Tx } from './db';
import { audit, getSettings } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ } from './dates';
import { addAttachment } from './attachments';
import { type HrSettings, hourlyRate, hrSettings, lateMinutes, localParts, officeSet, placeOf, timesheetAmounts, workedAndOvertime } from './attendance-calc';

// Clock in and out, timesheets and the design clock. The employee's own phone writes the records; HR reads and checks them.

export const getHr = async (tx: Tx = sql) => hrSettings((await getSettings(tx)).hr);
export async function saveHr(user: User, s: HrSettings) {
  if (!hasRole(user, 'hr')) throw new RuleError('Only HR or Management can change attendance settings.');
  await sql.begin(async tx => {
    await tx`update settings set hr = ${tx.json(s as never)} where id = 1`;
    await audit(tx, user, 'settings', 'hr', 'Changed attendance settings', officeSet(s) ? `office at ${s.office_lat}, ${s.office_lng} ± ${s.office_radius_m} m` : 'office location not set');
  });
}

export type Me = { id: string; name: string; work_location: 'office' | 'site'; basic: number; allowances: number; dept_id: string | null; project_id: string | null };
/** The employee file behind a login, or null when the login has none (then there is nothing to clock). */
export async function employeeOf(userId: string, tx: Tx = sql): Promise<Me | null> {
  const [e] = await tx<Me[]>`select id, name, work_location, basic, allowances, dept_id, project_id from employees where user_id = ${userId} and active`;
  return e ?? null;
}

export type Pos = { lat: number; lng: number; acc: number | null } | null;
export type Record_ = {
  id: string; employee_id: string; name: string; day: string; in_at: string; out_at: string | null; in_time: string; out_time: string | null;
  in_lat: number | null; in_lng: number | null; in_place: string; out_lat: number | null; out_lng: number | null; out_place: string | null;
  late_min: number; overtime_min: number; worked_min: number; checked_by: string | null; checked_at: string | null; checker: string | null; hr_note: string;
};
const recSelect = (tx: Tx, where = sql``) => tx<Record_[]>`
  select a.id, a.employee_id, e.name, to_char(a.day,'YYYY-MM-DD') as day, a.in_at::text in_at, a.out_at::text out_at,
    to_char(a.in_at at time zone ${TZ},'HH24:MI') in_time, to_char(a.out_at at time zone ${TZ},'HH24:MI') out_time,
    a.in_lat, a.in_lng, a.in_place, a.out_lat, a.out_lng, a.out_place, a.late_min, a.overtime_min, a.worked_min,
    a.checked_by, to_char(a.checked_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') checked_at, u.name checker, a.hr_note
  from attendance a join employees e on e.id = a.employee_id left join users u on u.id = a.checked_by
  ${where} order by a.in_at desc`;

export const openRecord = async (employeeId: string, tx: Tx = sql) => (await recSelect(tx, sql`where a.employee_id = ${employeeId} and a.out_at is null`))[0] ?? null;

/** The person clocks in: a selfie is required, the position is kept, and Office staff must be inside the office radius once HR has set it. */
export async function clockIn(user: User, pos: Pos, photo: { name: string; body: Buffer } | null, now = new Date()) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  if (!photo) throw new RuleError('Take a selfie first: the camera opens when you tap Clock in.');
  const s = await getHr();
  const { place, distance } = placeOf(me.work_location, pos, s);
  if (me.work_location === 'office' && officeSet(s)) {
    if (!pos) throw new RuleError('Allow the location so the system can see you are at the office, then try again.');
    if (place === 'away') throw new RuleError(`You are about ${distance} m from the office (allowed ${s.office_radius_m} m). Clock in at the office.`);
  }
  const id = await sql.begin(async tx => {
    const open = await openRecord(me.id, tx);
    if (open) throw new RuleError(`You are already clocked in since ${open.in_time}. Clock out first.`);
    const [r] = await tx<{ id: string }[]>`insert into attendance (employee_id, day, in_at, in_lat, in_lng, in_acc, in_place, late_min)
      values (${me.id}, ${localParts(now, TZ).day}, ${now}, ${pos?.lat ?? null}, ${pos?.lng ?? null}, ${pos?.acc ?? null}, ${place}, ${lateMinutes(now, TZ, s)}) returning id`;
    await audit(tx, user, 'attendance', r.id, 'Clocked in', `${place}${distance !== null ? ` · ${distance} m from the office` : ''}`);
    return r.id;
  });
  await addAttachment(user, 'attendance', id, photo.name, photo.body, 'in');
  return id;
}

/** The person clocks out: the same selfie and position, then the day's worked and overtime minutes are fixed. */
export async function clockOut(user: User, pos: Pos, photo: { name: string; body: Buffer } | null, now = new Date()) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  if (!photo) throw new RuleError('Take a selfie first: the camera opens when you tap Clock out.');
  const s = await getHr();
  const { place } = placeOf(me.work_location, pos, s);
  const id = await sql.begin(async tx => {
    const open = await openRecord(me.id, tx);
    if (!open) throw new RuleError('You are not clocked in.');
    const inAt = new Date(open.in_at);
    if (now <= inAt) throw new RuleError('The clock-out time is before the clock-in.');
    const { worked, overtime } = workedAndOvertime(inAt, now, TZ, s);
    await tx`update attendance set out_at = ${now}, out_lat = ${pos?.lat ?? null}, out_lng = ${pos?.lng ?? null}, out_acc = ${pos?.acc ?? null}, out_place = ${place},
      worked_min = ${worked}, overtime_min = ${overtime} where id = ${open.id}`;
    await audit(tx, user, 'attendance', open.id, 'Clocked out', `${worked} min worked, ${overtime} min overtime`);
    return open.id;
  });
  await addAttachment(user, 'attendance', id, photo.name, photo.body, 'out');
  return id;
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

/** HR fixes a forgotten clock-out (the person left without tapping): the day is closed at the time HR types. */
export async function closeRecord(user: User, id: string, outAt: Date, note: string) {
  if (!hasRole(user, 'hr')) throw new RuleError('Only HR can close a day.');
  const s = await getHr();
  await sql.begin(async tx => {
    const [r] = await tx<{ in_at: string; out_at: string | null }[]>`select in_at::text, out_at::text from attendance where id = ${id} for update`;
    if (!r) throw new RuleError('Record not found.');
    if (r.out_at) throw new RuleError('This day is already closed.');
    const inAt = new Date(r.in_at);
    if (outAt <= inAt) throw new RuleError('The clock-out time must be after the clock-in.');
    const { worked, overtime } = workedAndOvertime(inAt, outAt, TZ, s);
    await tx`update attendance set out_at = ${outAt}, out_place = 'unknown', worked_min = ${worked}, overtime_min = ${overtime}, hr_note = ${note.trim()}, checked_by = ${user.id}, checked_at = now() where id = ${id}`;
    await audit(tx, user, 'attendance', id, 'Closed by HR', note.trim());
  });
}

export const listRecords = (opts: { employee?: string; period?: string; day?: string } = {}) => recSelect(sql, sql`where true
  ${opts.employee ? sql`and a.employee_id = ${opts.employee}` : sql``}
  ${opts.period ? sql`and to_char(a.day,'YYYY-MM') = ${opts.period}` : sql``}
  ${opts.day ? sql`and a.day = ${opts.day}` : sql``}`);

export type MonthRow = { employee_id: string; code: string | null; name: string; work_location: string; days: number; late_days: number; late_min: number; overtime_min: number; worked_min: number; unchecked: number; open: number; away: number };
/** The month per employee: days present, lateness, overtime, selfies not yet checked, days still open, clock-ins away from the office. */
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

// ---- Design clock: a designer works on one project at a time; the hours and their cost go to the project.

export type Session = { id: string; employee_id: string; name: string; project_id: string; project_code: string; start_at: string; end_at: string | null; start_time: string; end_time: string | null; day: string; minutes: number; rate: number; cost: number; note: string };
const sesSelect = (tx: Tx, where = sql``) => tx<Session[]>`
  select d.id, d.employee_id, e.name, d.project_id, p.code project_code, d.start_at::text start_at, d.end_at::text end_at,
    to_char(d.start_at at time zone ${TZ},'HH24:MI') start_time, to_char(d.end_at at time zone ${TZ},'HH24:MI') end_time, to_char(d.start_at at time zone ${TZ},'YYYY-MM-DD') as day,
    d.minutes, d.rate, d.cost, d.note
  from design_sessions d join employees e on e.id = d.employee_id join projects p on p.id = d.project_id ${where} order by d.start_at desc`;
export const openSession = async (employeeId: string, tx: Tx = sql) => (await sesSelect(tx, sql`where d.employee_id = ${employeeId} and d.end_at is null`))[0] ?? null;

export async function startDesign(user: User, projectId: string, note = '', now = new Date()) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  return sql.begin(async tx => {
    const [p] = await tx<{ id: string }[]>`select id from projects where id = ${projectId} and not is_office`;
    if (!p) throw new RuleError('Choose a project.');
    const open = await openSession(me.id, tx);
    if (open) throw new RuleError(`You are already working on ${open.project_code} since ${open.start_time}. Stop it first.`);
    const [r] = await tx<{ id: string }[]>`insert into design_sessions (employee_id, project_id, start_at, note) values (${me.id}, ${projectId}, ${now}, ${note.trim()}) returning id`;
    await audit(tx, user, 'project', projectId, 'Design work started', me.name);
    return r.id;
  });
}

/** Stops the open session: minutes and cost (the designer's hourly cost from the salary, as HR set the standard hours) are fixed now. */
export async function stopDesign(user: User, now = new Date()) {
  const me = await employeeOf(user.id);
  if (!me) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  const s = await getHr();
  return sql.begin(async tx => {
    const open = await openSession(me.id, tx);
    if (!open) throw new RuleError('You are not working on a project right now.');
    const start = new Date(open.start_at);
    const minutes = Math.max(1, Math.round((now.getTime() - start.getTime()) / 60000));
    const rate = hourlyRate(me.basic, me.allowances, s);
    const cost = Math.round(minutes / 60 * rate * 100) / 100;
    await tx`update design_sessions set end_at = ${now}, minutes = ${minutes}, rate = ${rate}, cost = ${cost} where id = ${open.id}`;
    await audit(tx, user, 'project', open.project_id, 'Design work stopped', `${me.name} · ${minutes} min · ${cost} EGP`);
    return open.id;
  });
}

export const listSessions = (opts: { employee?: string; project?: string; period?: string } = {}) => sesSelect(sql, sql`where true
  ${opts.employee ? sql`and d.employee_id = ${opts.employee}` : sql``}
  ${opts.project ? sql`and d.project_id = ${opts.project}` : sql``}
  ${opts.period ? sql`and to_char(d.start_at at time zone ${TZ},'YYYY-MM') = ${opts.period}` : sql``}`);

export type DesignTotal = { project_id: string; code: string; name: string; minutes: number; cost: number; people: number; open: number };
/** Design hours and cost per project, with how many designers and whether someone is on it right now. */
export const designTotals = (projectId?: string) => sql<DesignTotal[]>`
  select p.id project_id, p.code, p.name, coalesce(sum(d.minutes),0)::int minutes, coalesce(sum(d.cost),0) cost,
    count(distinct d.employee_id)::int people, count(d.id) filter (where d.end_at is null)::int open
  from projects p join design_sessions d on d.project_id = p.id ${projectId ? sql`where p.id = ${projectId}` : sql``}
  group by p.id order by p.code`;
