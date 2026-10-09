'use server';
import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, hashPassword } from '@/lib/auth';
import { ROLES, type Role } from '@/lib/roles';
import { sql } from '@/lib/db';
import { audit } from '@/lib/books';
import { appUrl, sendMail } from '@/lib/mail';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (msg: string, bad = false) => redirect(`/settings?${bad ? 'error' : 'saved'}=${encodeURIComponent(msg)}`);
const rolesOf = (f: FormData) => f.getAll('roles').map(String).filter((r): r is Role => r in ROLES);

export async function saveCompany(f: FormData) {
  const user = await requireUser('management');
  const vat = Number(s(f, 'vat_rate'));
  if (!(vat >= 0 && vat <= 100)) back('VAT must be between 0 and 100.', true);
  await sql.begin(async tx => {
    await tx`update settings set company_name = ${s(f, 'company_name') || 'Right Space Development'}, vat_rate = ${vat},
      require_approval = ${f.get('require_approval') === 'on'}, require_cc = ${f.get('require_cc') === 'on'},
      lock_date = ${s(f, 'lock_date') || null}, pr_prefix = ${s(f, 'pr_prefix') || 'C-'} where id = 1`;
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
  const password = crypto.randomBytes(6).toString('base64url');
  const [u] = await sql<{ id: string }[]>`insert into users (email, name, password_hash, roles) values (${email}, ${name}, ${await hashPassword(password)}, ${rolesOf(f)})
    on conflict (email) do nothing returning id`;
  if (!u) back(`${email} already has a login.`, true);
  await audit(sql, admin, 'user', u.id, 'Created login', rolesOf(f).join(', '));
  await sendMail({
    to: [email], subject: 'Your Right Space Accounting login',
    text: `Hello ${name},\n\n${admin.name} gave you access to Right Space Accounting.\n\nSign in: ${appUrl('/login')}\nEmail: ${email}\nTemporary password: ${password}\n\nPlease change it after signing in (top of the menu, "My account").`,
  });
  revalidatePath('/settings');
  redirect(`/settings?saved=${encodeURIComponent(`Login created for ${email}. Temporary password: ${password} (also emailed when email is set up).`)}`);
}

export async function updateUser(id: string, f: FormData) {
  const admin = await requireUser('management');
  const roles = rolesOf(f), active = f.get('active') === 'on';
  if (id === admin.id && (!roles.includes('management') || !active)) back('You cannot remove your own Management access.', true);
  await sql.begin(async tx => {
    await tx`update users set name = ${s(f, 'name')}, roles = ${roles}, active = ${active} where id = ${id}`;
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
  await sendMail({ to: [u.email], subject: 'Your Right Space Accounting password was reset', text: `Temporary password: ${password}\nSign in: ${appUrl('/login')}` });
  redirect(`/settings?saved=${encodeURIComponent(`New temporary password for ${u.email}: ${password}`)}`);
}
