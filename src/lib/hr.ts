import 'server-only';
import crypto from 'node:crypto';
import { sql, type Tx } from './db';
import { audit, nextNo } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import bcrypt from 'bcryptjs';
import { appUrl, sendMail } from './mail';

// Employee files for HR (Admin & HR, Finance and Management). Salary figures stay with Finance in payroll.ts.

export const canSeeHR = (u: User) => hasRole(u, 'hr', 'finance');
const needHR = (u: User, what: string) => { if (!canSeeHR(u)) throw new RuleError(`Only HR or Finance can ${what}.`); };

export const WORK_LOCATIONS = [['office', 'Office'], ['site', 'Site']] as const;
export type WorkLocation = typeof WORK_LOCATIONS[number][0];
export const CONTRACT_TYPES = [['permanent', 'Permanent'], ['fixed', 'Fixed term'], ['probation', 'Probation'], ['daily', 'Daily / tradesman']] as const;

/** The company's Employment Documents form: originals first, then photocopies; `copies` is how many copies the form asks for. */
export const DOCUMENTS = [
  { key: 'birth_cert', name: 'Birth certificate', kind: 'original', copies: 1, who: '' },
  { key: 'military_cert', name: 'Military service certificate', kind: 'original', copies: 1, who: 'men' },
  { key: 'edu_cert', name: 'Educational certificate', kind: 'original', copies: 1, who: '' },
  { key: 'labour_office', name: 'Labour office registration certificate', kind: 'original', copies: 1, who: '' },
  { key: 'criminal_record', name: 'Criminal record certificate (addressed to Right Space Development)', kind: 'original', copies: 1, who: '' },
  { key: 'medical_111', name: 'Pre-hiring medical check-up (Form 111)', kind: 'original', copies: 1, who: '' },
  { key: 'photographs', name: 'Photographs', kind: 'original', copies: 4, who: '', counted: true },
  { key: 'insurance_printout', name: 'Social insurance printout', kind: 'original', copies: 1, who: '' },
  { key: 'national_id', name: 'National ID', kind: 'copy', copies: 2, who: '' },
  { key: 'driving_licence', name: 'Driving licence', kind: 'copy', copies: 2, who: 'drivers' },
  { key: 'union_card', name: 'Union card and certificate', kind: 'copy', copies: 2, who: 'engineering and law graduates' },
  { key: 'skill_cert', name: 'Skill level certificate', kind: 'copy', copies: 2, who: 'craft jobs' },
] as const;
export type DocKey = typeof DOCUMENTS[number]['key'];
export const DOC_STATUSES = [['missing', 'Missing'], ['received', 'Received'], ['na', 'Not applicable']] as const;
export type DocStatus = typeof DOC_STATUSES[number][0];

export type EmployeeFile = {
  id: string; code: string | null; name: string; job_title: string | null; dept_id: string | null; dept_name: string | null;
  project_id: string | null; project_code: string | null; hire_date: string | null; active: boolean; work_location: WorkLocation;
  national_id: string | null; phone: string | null; personal_email: string | null; address: string | null; birth_date: string | null; gender: string | null;
  contract_type: string | null; contract_start: string | null; contract_end: string | null; probation_end: string | null; insurance_no: string | null;
  emergency_name: string | null; emergency_phone: string | null; notes: string | null;
  user_id: string | null; login_email: string | null; login_active: boolean | null;
  docs_received: number; docs_missing: number;
};
const fileSelect = (tx: Tx, where = sql``) => tx<EmployeeFile[]>`
  select e.id, e.code, e.name, e.job_title, e.dept_id, d.name dept_name, e.project_id, p.code project_code, to_char(e.hire_date,'YYYY-MM-DD') hire_date,
    e.active, e.work_location, e.national_id, e.phone, e.personal_email, e.address, to_char(e.birth_date,'YYYY-MM-DD') birth_date, e.gender,
    e.contract_type, to_char(e.contract_start,'YYYY-MM-DD') contract_start, to_char(e.contract_end,'YYYY-MM-DD') contract_end,
    to_char(e.probation_end,'YYYY-MM-DD') probation_end, e.insurance_no, e.emergency_name, e.emergency_phone, e.notes,
    e.user_id, u.email login_email, u.active login_active,
    (select count(*)::int from employee_documents x where x.employee_id = e.id and x.status = 'received') docs_received,
    (${DOCUMENTS.length} - (select count(*)::int from employee_documents x where x.employee_id = e.id and x.status in ('received','na'))) docs_missing
  from employees e left join departments d on d.id = e.dept_id left join projects p on p.id = e.project_id left join users u on u.id = e.user_id
  ${where} order by e.active desc, e.code, e.name`;
export const listEmployeeFiles = () => fileSelect(sql);
export async function getEmployeeFile(id: string) { return (await fileSelect(sql, sql`where e.id = ${id}`))[0]; }

/** Everyone who can be given a task: active employees first (with their login, if any), then logins that have no employee file yet. */
export type Assignee = { key: string; name: string; employee_id: string | null; user_id: string | null; detail: string };
export async function listAssignees(): Promise<Assignee[]> {
  const emps = await sql<{ id: string; name: string; job_title: string | null; user_id: string | null; dept_name: string | null }[]>`
    select e.id, e.name, e.job_title, (select u.id from users u where u.id = e.user_id and u.active) user_id, d.name dept_name
    from employees e left join departments d on d.id = e.dept_id where e.active order by e.name`;
  const users = await sql<{ id: string; name: string }[]>`
    select u.id, u.name from users u where u.active and not exists (select 1 from employees e where e.user_id = u.id and e.active) order by u.name`;
  return [
    ...emps.map(e => ({ key: 'e:' + e.id, name: e.name, employee_id: e.id, user_id: e.user_id, detail: [e.job_title, e.dept_name].filter(Boolean).join(' · ') })),
    ...users.map(u => ({ key: 'u:' + u.id, name: u.name, employee_id: null, user_id: u.id, detail: 'login only' })),
  ];
}
/** Turns a picker value (e:<employee> or u:<user>) into the two ids a task keeps. */
export async function resolveAssignee(key: string | null | undefined): Promise<{ assignee_id: string | null; assignee_emp_id: string | null }> {
  if (!key) return { assignee_id: null, assignee_emp_id: null };
  if (key.startsWith('u:')) return { assignee_id: key.slice(2), assignee_emp_id: null };
  const id = key.startsWith('e:') ? key.slice(2) : key;
  const [e] = await sql<{ id: string; user_id: string | null }[]>`select e.id, (select u.id from users u where u.id = e.user_id and u.active) user_id from employees e where e.id = ${id}`;
  if (!e) throw new RuleError('That employee no longer exists.');
  return { assignee_id: e.user_id, assignee_emp_id: e.id };
}

export type FileInput = {
  id?: string; code?: string; name: string; job_title?: string; dept_id?: string | null; project_id?: string | null; hire_date?: string | null; active?: boolean;
  work_location: WorkLocation; national_id?: string; phone?: string; personal_email?: string; address?: string; birth_date?: string | null; gender?: string | null;
  contract_type?: string | null; contract_start?: string | null; contract_end?: string | null; probation_end?: string | null; insurance_no?: string;
  emergency_name?: string; emergency_phone?: string; notes?: string;
};
const t = (s: string | null | undefined) => (s ?? '').trim() || null;
/** HR saves the personal and contract data; salary figures are untouched (Finance keeps them under Payroll). */
export async function saveEmployeeFile(user: User, i: FileInput) {
  needHR(user, 'edit employee files');
  if (!i.name.trim()) throw new RuleError('Enter the employee name.');
  if (!WORK_LOCATIONS.some(w => w[0] === i.work_location)) throw new RuleError('Choose Office or Site.');
  if (i.gender && !['male', 'female'].includes(i.gender)) throw new RuleError('Unknown gender.');
  if (i.contract_type && !CONTRACT_TYPES.some(c => c[0] === i.contract_type)) throw new RuleError('Unknown contract type.');
  return sql.begin(async tx => {
    const vals = {
      name: i.name.trim(), job_title: t(i.job_title), dept_id: i.dept_id || null, project_id: i.project_id || null, hire_date: i.hire_date || null,
      work_location: i.work_location, national_id: t(i.national_id), phone: t(i.phone), personal_email: t(i.personal_email)?.toLowerCase() ?? null, address: t(i.address),
      birth_date: i.birth_date || null, gender: i.gender || null, contract_type: i.contract_type || null, contract_start: i.contract_start || null,
      contract_end: i.contract_end || null, probation_end: i.probation_end || null, insurance_no: t(i.insurance_no),
      emergency_name: t(i.emergency_name), emergency_phone: t(i.emergency_phone), notes: t(i.notes), active: i.active ?? true,
    };
    let id = i.id;
    if (id) {
      const n = await tx`update employees set ${tx(vals)} where id = ${id}`;
      if (!n.count) throw new RuleError('Employee not found.');
    } else {
      const code = (i.code ?? '').trim() || await nextNo(tx, 'E', 3);
      [{ id }] = await tx<{ id: string }[]>`insert into employees ${tx({ ...vals, code })} returning id`;
    }
    // a woman has no military certificate: marked not applicable from the start, HR can change it
    if (!i.id && vals.gender === 'female') await tx`insert into employee_documents (employee_id, key, status) values (${id}, 'military_cert', 'na') on conflict do nothing`;
    await audit(tx, user, 'employee', id!, i.id ? 'Edited file' : 'Created file', vals.name);
    return id!;
  });
}

export type DocRow = { key: DocKey; status: DocStatus; qty: number | null; received_on: string | null; note: string };
export async function listDocuments(employeeId: string): Promise<DocRow[]> {
  const rows = await sql<DocRow[]>`select key, status, qty, to_char(received_on,'YYYY-MM-DD') received_on, note from employee_documents where employee_id = ${employeeId}`;
  return DOCUMENTS.map(d => rows.find(r => r.key === d.key) ?? { key: d.key, status: 'missing', qty: null, received_on: null, note: '' });
}
/** Saves the whole checklist at once; a document marked received today gets today's date unless one was typed. */
export async function saveDocuments(user: User, employeeId: string, rows: { key: string; status: string; qty?: number | null; received_on?: string | null; note?: string }[], today: string) {
  needHR(user, 'edit employee documents');
  await sql.begin(async tx => {
    const [e] = await tx<{ name: string }[]>`select name from employees where id = ${employeeId}`;
    if (!e) throw new RuleError('Employee not found.');
    for (const r of rows) {
      const def = DOCUMENTS.find(d => d.key === r.key);
      if (!def) throw new RuleError('Unknown document.');
      if (!DOC_STATUSES.some(s => s[0] === r.status)) throw new RuleError('Unknown document status.');
      const vals = { status: r.status, qty: 'counted' in def && def.counted ? (r.qty ?? null) : null, received_on: r.status === 'received' ? (r.received_on || today) : null, note: (r.note ?? '').trim() };
      await tx`insert into employee_documents ${tx({ employee_id: employeeId, key: r.key, ...vals })} on conflict (employee_id, key) do update set ${tx(vals)}`;
    }
    await audit(tx, user, 'employee', employeeId, 'Documents updated', `${rows.filter(r => r.status === 'received').length} received`);
  });
}

/** A login for the employee, made from the file: same name, the employee's department, no extra roles. Returns the temporary password (shown once). */
export async function createLogin(user: User, employeeId: string, email: string): Promise<{ password: string; email: string }> {
  if (!hasRole(user, 'hr')) throw new RuleError('Only HR or Management can create logins.');
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new RuleError('Enter a valid email address for the login.');
  const password = crypto.randomBytes(6).toString('base64url');
  const hash = await bcrypt.hash(password, 10);
  const name = await sql.begin(async tx => {
    const [e] = await tx<{ name: string; dept_id: string | null; user_id: string | null }[]>`select name, dept_id, user_id from employees where id = ${employeeId} for update`;
    if (!e) throw new RuleError('Employee not found.');
    if (e.user_id) throw new RuleError('This employee already has a login.');
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash, roles, dept_id) values (${email}, ${e.name}, ${hash}, '{}', ${e.dept_id})
      on conflict (email) do nothing returning id`;
    if (!u) throw new RuleError(`${email} already has a login. Use "Link to an existing login" instead.`);
    await tx`update employees set user_id = ${u.id}, personal_email = coalesce(personal_email, ${email}) where id = ${employeeId}`;
    await audit(tx, user, 'user', u.id, 'Created login', `from the employee file of ${e.name}`);
    await audit(tx, user, 'employee', employeeId, 'Login created', email);
    return e.name;
  });
  await sendMail({
    to: [email], subject: 'Your Right Space login',
    text: `Hello ${name},\n\n${user.name} created your login for the Right Space system.\n\nSign in: ${appUrl('/login')}\nEmail: ${email}\nTemporary password: ${password}\n\nPlease change it after signing in ("My account").`,
  });
  return { password, email };
}

/** Ties the file to a login that already exists (the partners and the first colleagues were added under Settings). */
export async function linkLogin(user: User, employeeId: string, userId: string | null) {
  if (!hasRole(user, 'hr')) throw new RuleError('Only HR or Management can link logins.');
  await sql.begin(async tx => {
    if (userId) {
      const [u] = await tx<{ id: string }[]>`select id from users where id = ${userId} and active`;
      if (!u) throw new RuleError('That login does not exist.');
      const [taken] = await tx<{ name: string }[]>`select name from employees where user_id = ${userId} and id <> ${employeeId}`;
      if (taken) throw new RuleError(`That login already belongs to the file of ${taken.name}.`);
    }
    const n = await tx`update employees set user_id = ${userId} where id = ${employeeId}`;
    if (!n.count) throw new RuleError('Employee not found.');
    await audit(tx, user, 'employee', employeeId, userId ? 'Login linked' : 'Login unlinked');
  });
}
