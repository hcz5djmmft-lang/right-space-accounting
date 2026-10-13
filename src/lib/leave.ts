import 'server-only';
import { sql, type Tx } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ } from './dates';
import { employeeOf, getHr } from './attendance';
import { FROM_BALANCE, LEAVE_TYPES, type LeaveType, checkRequest, entitlement, workingDays } from './leave-calc';

// Leave requests: the person asks from the phone, the head of their department signs, then HR (the head of Admin & HR, or any HR member).

export type Leave = {
  id: string; employee_id: string; name: string; dept_name: string | null; type: LeaveType; type_label: string; from_date: string; to_date: string; days: number; reason: string;
  status: string; head_user_id: string | null; head_name: string | null; head_signer: string | null; head_at: string | null; hr_signer: string | null; hr_at: string | null;
  decision_note: string; created_at: string;
};
const select = (tx: Tx, where = sql``) => tx<Leave[]>`
  select r.id, r.employee_id, e.name, d.name dept_name, r.type, r.type type_label, to_char(r.from_date,'YYYY-MM-DD') from_date, to_char(r.to_date,'YYYY-MM-DD') to_date, r.days, r.reason,
    r.status, r.head_user_id, h.name head_name, hs.name head_signer, to_char(r.head_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') head_at,
    rs.name hr_signer, to_char(r.hr_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') hr_at, r.decision_note, to_char(r.created_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') created_at
  from leave_requests r join employees e on e.id = r.employee_id left join departments d on d.id = e.dept_id
  left join users h on h.id = r.head_user_id left join users hs on hs.id = r.head_signed_by left join users rs on rs.id = r.hr_signed_by
  ${where} order by r.created_at desc`;
const label = (rows: Leave[]) => rows.map(r => ({ ...r, type_label: LEAVE_TYPES.find(t => t[0] === r.type)?.[1].split(' (')[0] ?? r.type }));

export const listLeave = async (opts: { employee?: string; status?: string[]; year?: number } = {}) => label(await select(sql, sql`where true
  ${opts.employee ? sql`and r.employee_id = ${opts.employee}` : sql``}
  ${opts.status ? sql`and r.status in ${sql(opts.status)}` : sql``}
  ${opts.year ? sql`and extract(year from r.from_date) = ${opts.year}` : sql``}`));
export const getLeave = async (id: string) => label(await select(sql, sql`where r.id = ${id}`))[0];

export type Balance = { year: number; entitlement: number; taken: number; pending: number; balance: number; thirty: boolean };
/** The year's annual balance: the entitlement less approved annual and casual days, with what is still waiting shown apart. */
export async function balanceOf(employeeId: string, year: number, tx: Tx = sql): Promise<Balance> {
  const [e] = await tx<{ hire_date: string | null; birth_date: string | null }[]>`select to_char(hire_date,'YYYY-MM-DD') hire_date, to_char(birth_date,'YYYY-MM-DD') birth_date from employees where id = ${employeeId}`;
  if (!e) throw new RuleError('Employee not found.');
  const ent = entitlement(e.hire_date, e.birth_date, year);
  const [t] = await tx<{ taken: number; pending: number }[]>`
    select coalesce(sum(days) filter (where status = 'approved'),0)::float taken, coalesce(sum(days) filter (where status in ('head','hr')),0)::float pending
    from leave_requests where employee_id = ${employeeId} and type in ${sql(FROM_BALANCE as string[])} and extract(year from from_date) = ${year}`;
  return { year, entitlement: ent, taken: t.taken, pending: t.pending, balance: ent - t.taken, thirty: ent === 30 };
}

/** Who signs first: the head of the person's department (a section without a head: its parent's head), unless there is none or it is the person themself (then HR straight away). */
async function headFor(tx: Tx, employeeId: string): Promise<string | null> {
  const [r] = await tx<{ head: string | null }[]>`
    select coalesce((select u.id from users u where u.id = d.head_user_id and u.active), (select u.id from users u where u.id = p.head_user_id and u.active)) head
    from employees e left join departments d on d.id = e.dept_id left join departments p on p.id = d.parent_id where e.id = ${employeeId} and coalesce(d.head_user_id, p.head_user_id) is distinct from e.user_id`;
  return r?.head ?? null;
}
const isHrHead = async (tx: Tx, user: User) => hasRole(user, 'hr');

/** The person files a request for themself; HR may file one for anyone (a paper request, a phone call). */
export async function requestLeave(user: User, i: { employee_id?: string; type: LeaveType; from: string; to: string; reason?: string }) {
  const me = await employeeOf(user.id);
  const employeeId = i.employee_id && i.employee_id !== me?.id ? i.employee_id : me?.id;
  if (!employeeId) throw new RuleError('Your login is not linked to an employee file. Ask HR to link it.');
  if (employeeId !== me?.id && !hasRole(user, 'hr')) throw new RuleError('Only HR can file leave for someone else.');
  if (!LEAVE_TYPES.some(t => t[0] === i.type)) throw new RuleError('Choose the kind of leave.');
  const s = await getHr();
  const days = /^\d{4}-\d\d-\d\d$/.test(i.from) && /^\d{4}-\d\d-\d\d$/.test(i.to) ? workingDays(i.from, i.to, s.weekend) : 0;
  return sql.begin(async tx => {
    const year = Number(i.from.slice(0, 4));
    const bal = await balanceOf(employeeId, year, tx);
    const err = checkRequest({ type: i.type, from: i.from, to: i.to, days, balance: bal.balance - bal.pending });
    if (err) throw new RuleError(err);
    const [clash] = await tx`select 1 from leave_requests where employee_id = ${employeeId} and status in ('head','hr','approved') and from_date <= ${i.to} and to_date >= ${i.from}`;
    if (clash) throw new RuleError('Those days overlap a request that is already filed.');
    const head = await headFor(tx, employeeId);
    const [r] = await tx<{ id: string }[]>`insert into leave_requests (employee_id, type, from_date, to_date, days, reason, status, head_user_id, created_by)
      values (${employeeId}, ${i.type}, ${i.from}, ${i.to}, ${days}, ${(i.reason ?? '').trim()}, ${head ? 'head' : 'hr'}, ${head}, ${user.id}) returning id`;
    await audit(tx, user, 'leave', r.id, 'Requested', `${i.type} ${i.from} to ${i.to} (${days} days)`);
    return r.id;
  });
}

/** Whether this user signs the request at its current step. */
export const canDecide = (user: User, r: Pick<Leave, 'status' | 'head_user_id'>) =>
  r.status === 'head' ? r.head_user_id === user.id || hasRole(user, 'management') : r.status === 'hr' ? hasRole(user, 'hr') : false;

export async function decideLeave(user: User, id: string, approve: boolean, note = '') {
  await sql.begin(async tx => {
    const [r] = await tx<{ status: string; head_user_id: string | null; employee_id: string }[]>`select status, head_user_id, employee_id from leave_requests where id = ${id} for update`;
    if (!r) throw new RuleError('Request not found.');
    if (!canDecide(user, r)) throw new RuleError(r.status === 'head' ? 'This request waits for the department head.' : r.status === 'hr' ? 'This request waits for HR.' : 'This request is already decided.');
    if (!approve) {
      await tx`update leave_requests set status = 'rejected', decision_note = ${note.trim()}, ${r.status === 'head' ? tx`head_signed_by = ${user.id}, head_at = now()` : tx`hr_signed_by = ${user.id}, hr_at = now()`} where id = ${id}`;
      await audit(tx, user, 'leave', id, 'Rejected', note.trim());
      return;
    }
    if (r.status === 'head') {
      // the head's approval; a head who is also HR signs both steps at once
      const both = await isHrHead(tx, user);
      await tx`update leave_requests set head_signed_by = ${user.id}, head_at = now(), status = ${both ? 'approved' : 'hr'},
        ${both ? tx`hr_signed_by = ${user.id}, hr_at = now(),` : tx``} decision_note = ${note.trim()} where id = ${id}`;
      await audit(tx, user, 'leave', id, both ? 'Approved (head and HR)' : 'Approved by the department head', note.trim());
    } else {
      await tx`update leave_requests set hr_signed_by = ${user.id}, hr_at = now(), status = 'approved', decision_note = ${note.trim()} where id = ${id}`;
      await audit(tx, user, 'leave', id, 'Approved by HR', note.trim());
    }
  });
}

/** The person withdraws a request that is not decided yet; HR can cancel an approved one that was not taken. */
export async function cancelLeave(user: User, id: string) {
  const me = await employeeOf(user.id);
  await sql.begin(async tx => {
    const [r] = await tx<{ status: string; employee_id: string }[]>`select status, employee_id from leave_requests where id = ${id} for update`;
    if (!r) throw new RuleError('Request not found.');
    const own = r.employee_id === me?.id;
    if (['rejected', 'cancelled'].includes(r.status)) throw new RuleError('This request is already closed.');
    if (!(own && ['head', 'hr'].includes(r.status)) && !hasRole(user, 'hr')) throw new RuleError('Only HR can cancel this request now.');
    await tx`update leave_requests set status = 'cancelled' where id = ${id}`;
    await audit(tx, user, 'leave', id, 'Cancelled');
  });
}

/** Requests waiting for this user's signature, for the Approvals page and its badge. */
export async function leaveWaitingFor(user: User) {
  const rows = label(await select(sql, sql`where r.status in ('head','hr')`));
  return rows.filter(r => canDecide(user, r));
}

/** Approved unpaid days per employee in a month, for the payroll fill (a whole month's pay over the standard days). */
export async function unpaidDays(period: string, tx: Tx = sql) {
  const s = await getHr(tx);
  const rows = await tx<{ employee_id: string; from_date: string; to_date: string }[]>`
    select employee_id, to_char(from_date,'YYYY-MM-DD') from_date, to_char(to_date,'YYYY-MM-DD') to_date from leave_requests
    where status = 'approved' and type = 'unpaid' and to_char(from_date,'YYYY-MM') <= ${period} and to_char(to_date,'YYYY-MM') >= ${period}`;
  const [y, m] = period.split('-').map(Number);
  const first = `${period}-01`, last = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.employee_id, (out.get(r.employee_id) ?? 0) + workingDays(r.from_date < first ? first : r.from_date, r.to_date > last ? last : r.to_date, s.weekend));
  return out;
}
