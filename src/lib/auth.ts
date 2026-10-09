import 'server-only';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from './db';
import { afterFailure, isLocked } from './lockout';

import { type Role, type User, hasRole } from './roles';
export { ROLES, hasRole, type Role, type User } from './roles';

const COOKIE = 'rsa_session';
const DAYS = 14;
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
// a real hash, so an unknown email takes as long to answer as a wrong password
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export type LoginResult = 'ok' | 'wrong' | 'locked';

/** Signs the person in. Ten wrong passwords in a row lock the login for fifteen minutes (see lockout.ts). */
export async function login(email: string, password: string): Promise<LoginResult> {
  const [u] = await sql<{ id: string; password_hash: string; failed_logins: number; locked_until: Date | null }[]>`
    select id, password_hash, failed_logins, locked_until from users where lower(email) = lower(${email.trim()}) and active`;
  if (u && isLocked(u.locked_until)) return 'locked';
  const ok = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
  if (!u) return 'wrong';
  if (!ok) {
    const next = afterFailure(u.failed_logins, u.locked_until);
    await sql`update users set failed_logins = ${next.failed}, locked_until = ${next.lockedUntil} where id = ${u.id}`;
    return next.lockedUntil ? 'locked' : 'wrong';
  }
  if (u.failed_logins) await sql`update users set failed_logins = 0, locked_until = null where id = ${u.id}`;
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + DAYS * 864e5);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${hash(token)}, ${u.id}, ${expires})`;
  await sql`delete from sessions where expires_at < now()`; // housekeeping: expired sessions go on each sign-in
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires,
  });
  return 'ok';
}

/** After a password change: every other device is signed out; the one making the change stays signed in. */
export async function endOtherSessions(userId: string) {
  const t = (await cookies()).get(COOKIE)?.value ?? '';
  await sql`delete from sessions where user_id = ${userId} and token_hash <> ${hash(t)}`;
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
