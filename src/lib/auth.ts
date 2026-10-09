import 'server-only';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from './db';

import { type Role, type User, hasRole } from './roles';
export { ROLES, hasRole, type Role, type User } from './roles';

const COOKIE = 'rsa_session';
const DAYS = 14;
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function login(email: string, password: string): Promise<boolean> {
  const [u] = await sql<{ id: string; password_hash: string }[]>`
    select id, password_hash from users where lower(email) = lower(${email.trim()}) and active`;
  // compare even when the user is unknown, so timing does not reveal which emails exist
  const ok = await bcrypt.compare(password, u?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!u || !ok) return false;
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + DAYS * 864e5);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${hash(token)}, ${u.id}, ${expires})`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires,
  });
  return true;
}

export async function logout() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) await sql`delete from sessions where token_hash = ${hash(t)}`;
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  const [u] = await sql<User[]>`
    select u.id, u.email, u.name, u.roles from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hash(t)} and s.expires_at > now() and u.active`;
  return u ?? null;
}

/** For pages and actions: the signed-in user, who must hold one of `roles` (Management may do anything). */
export async function requireUser(...roles: Role[]): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (roles.length && !hasRole(u, ...roles)) redirect('/?denied=1');
  return u;
}

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
