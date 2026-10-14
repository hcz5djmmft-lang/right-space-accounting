'use server';
import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireUser, hashPassword } from '@/lib/auth';
import { ROLES, type Role } from '@/lib/roles';
import { sql } from '@/lib/db';
import { audit } from '@/lib/books';
import { appUrl, sendMail } from '@/lib/mail';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (msg: string, bad = false) => redirect(`/settings?${bad ? 'error' : 'saved'}=${encodeURIComponent(msg)}`);
/** A message carrying a temporary password is shown once from a short-lived cookie, never in the address bar or the server log. */
async function flash(msg: string) {
  (await cookies()).set('rsa_flash', msg, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/settings', maxAge: 60 });
  redirect('/settings');
}
const rolesOf = (f: FormData, k = 'roles') => f.getAll(k).map(String).filter((r): r is Role => r in ROLES);
/** The chosen department's id, or null for none; an unknown id (a stale form) is refused. */
async function deptOf(f: FormData) {
  const id = s(f, 'dept');
  if (!id) return null;
  const [d] = await sql<{ id: string }[]>`select id from departments where id = ${id} and active`;
  if (!d) back('That department no longer exists.', true);
  return d.id;
}

export async function saveCompany(f: FormData) {
  const user = await requireUser('management');
  const vat = Number(s(f, 'vat_rate'));
  if (!(vat >= 0 && vat <= 100)) back('VAT must be between 0 and 100.', true);
  await sql.begin(async tx => {
    await tx`update settings set company_name = ${s(f, 'company_name') || 'Right Space Development'}, vat_rate = ${vat},
      require_approval = ${f.get('require_approval') === 'on'}, require_cc = ${f.get('require_cc') === 'on'},
      lock_date = ${s(f, 'lock_date') || null}, company_tax_id = ${s(f, 'company_tax_id')}, pr_prefix = ${s(f, 'pr_prefix') || 'C-'} where id = 1`;
    await audit(tx, user, 'settings', 'company', 'Changed company settings', '', Object.fromEntries(f));
  });
  revalidatePath('/', 'layout');
  back('Company settings saved.');
}

export async function saveSteps(f: FormData) {
  const user = await requireUser('management');
  await sql.begin(async tx => {
    const steps = await tx<{ position: number; name: string }[]>`select position, name from approval_steps order by position`;
    for (const st of steps) {
      if (/head/i.test(st.name)) continue; // the department head step is signed by the heads set under Departments
      const ids = f.getAll('step_' + st.position).map(String);
      await tx`update approval_steps set user_ids = ${ids} where position = ${st.position}`;
    }
    await audit(tx, user, 'settings', 'approval_steps', 'Changed approvers');
  });
  revalidatePath('/', 'layout');
  back('Approvers saved.');
}

export async function addUser(f: FormData) {
  const admin = await requireUser('management');
  const email = s(f, 'email').toLowerCase(), name = s(f, 'name');
  if (!email || !name) back('Enter a name and an email.', true);
  const dept = await deptOf(f);
  const password = crypto.randomBytes(6).toString('base64url');
  const [u] = await sql<{ id: string }[]>`insert into users (email, name, password_hash, roles, dept_id) values (${email}, ${name}, ${await hashPassword(password)}, ${rolesOf(f)}, ${dept})
    on conflict (email) do nothing returning id`;
  if (!u) back(`${email} already has a login.`, true);
  await audit(sql, admin, 'user', u.id, 'Created login', rolesOf(f).join(', '));
  await sendMail({
    to: [email], subject: 'Your Right Space login',
    text: `Hello ${name},\n\n${admin.name} gave you access to Right Space.\n\nSign in: ${appUrl('/login')}\nEmail: ${email}\nTemporary password: ${password}\n\nPlease change it after signing in (top of the menu, "My account").`,
  });
  revalidatePath('/settings');
  await flash(`Login created for ${email}. Temporary password: ${password} (also emailed when email is set up). Shown once; pass it on now.`);
}

export async function updateUser(id: string, f: FormData) {
  const admin = await requireUser('management');
  const roles = rolesOf(f), active = f.get('active') === 'on', dept = await deptOf(f);
  if (id === admin.id && (!roles.includes('management') || !active)) back('You cannot remove your own Management access.', true);
  await sql.begin(async tx => {
    await tx`update users set name = ${s(f, 'name')}, roles = ${roles}, active = ${active}, dept_id = ${dept} where id = ${id}`;
    if (!active) await tx`delete from sessions where user_id = ${id}`;
    await audit(tx, admin, 'user', id, 'Changed access', `${roles.join(', ') || 'no roles'}${active ? '' : ' · deactivated'}`);
  });
  revalidatePath('/', 'layout');
  back('Saved.');
}

export async function resetPassword(id: string) {
  const admin = await requireUser('management');
  const password = crypto.randomBytes(6).toString('base64url');
  const [u] = await sql<{ email: string }[]>`update users set password_hash = ${await hashPassword(password)} where id = ${id} returning email`;
  await sql`delete from sessions where user_id = ${id}`;
  await audit(sql, admin, 'user', id, 'Reset password');
  await sendMail({ to: [u.email], subject: 'Your Right Space password was reset', text: `Temporary password: ${password}\nSign in: ${appUrl('/login')}` });
  await flash(`New temporary password for ${u.email}: ${password}. Shown once; pass it on now.`);
}

export async function saveDepartment(id: string, f: FormData) {
  const admin = await requireUser('management');
  const name = s(f, 'name'), head = s(f, 'head') || null, roles = rolesOf(f, 'droles'), active = f.get('active') === 'on';
  if (!name) back('Enter the department name.', true);
  if (head) {
    const [u] = await sql<{ id: string }[]>`select id from users where id = ${head} and active`;
    if (!u) back('That person is not an active login.', true);
  }
  await sql.begin(async tx => {
    const r = await tx`update departments set name = ${name}, head_user_id = ${head}, roles = ${roles}, active = ${active} where id = ${id}`;
    if (!r.count) back('That department no longer exists.', true);
    await audit(tx, admin, 'department', id, 'Changed', `${name} · head ${head ?? 'none'} · members can ${roles.join(', ') || 'nothing extra'}${active ? '' : ' · inactive'}`);
  });
  revalidatePath('/', 'layout');
  back(`${name} saved.`);
}

/** The org chart: every position's holders at once (pos_<key> fields, one value for a single-holder position). */
export async function savePositionsAction(f: FormData) {
  const admin = await requireUser('management');
  const { POSITIONS } = await import('@/lib/org-chart');
  const { savePositions } = await import('@/lib/org');
  const picks = Object.fromEntries(POSITIONS.map(p => [p.key, f.getAll(`pos_${p.key}`).map(String).filter(Boolean)]));
  try { await savePositions(admin, picks); } catch (e) { back((e as Error).message, true); }
  revalidatePath('/', 'layout');
  back('Org chart saved.');
}

export async function addDepartment(f: FormData) {
  const admin = await requireUser('management');
  const code = s(f, 'code').toUpperCase(), name = s(f, 'name');
  if (!code || !name) back('Enter a code and a name for the department.', true);
  const [d] = await sql<{ id: string }[]>`insert into departments (code, name) values (${code}, ${name}) on conflict (code) do nothing returning id`;
  if (!d) back(`A department with code ${code} already exists.`, true);
  await audit(sql, admin, 'department', d.id, 'Created', `${code} · ${name}`);
  revalidatePath('/', 'layout');
  back(`${name} added. Choose its head and what its members can do, then Save.`);
}
