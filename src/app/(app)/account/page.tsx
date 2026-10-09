import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { requireUser, hashPassword, endOtherSessions } from '@/lib/auth';
import { ROLES } from '@/lib/roles';
import { sql } from '@/lib/db';
import { audit } from '@/lib/books';

async function changePassword(f: FormData) {
  'use server';
  const u = await requireUser();
  const cur = String(f.get('current') ?? ''), next = String(f.get('next') ?? '');
  const [row] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${u.id}`;
  if (!(await bcrypt.compare(cur, row.password_hash))) redirect('/account?error=' + encodeURIComponent('Your current password is not right.'));
  if (next.length < 8) redirect('/account?error=' + encodeURIComponent('Use at least 8 characters.'));
  await sql`update users set password_hash = ${await hashPassword(next)} where id = ${u.id}`;
  await endOtherSessions(u.id);
  await audit(sql, u, 'user', u.id, 'Changed own password');
  redirect('/account?saved=1');
}

export default async function Account({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const u = await requireUser();
  const { saved, error } = await searchParams;
  return (
    <>
      <div className="head"><div><h1>My account</h1><p>{u.name} · {u.email} · {u.roles.map(r => ROLES[r]).join(', ') || 'no role yet'}</p></div></div>
      {saved && <div className="msg good">Password changed.</div>}
      {error && <div className="msg bad">{error}</div>}
      <form action={changePassword} className="card grid g3" style={{ alignItems: 'end', maxWidth: 760 }}>
        <label className="f"><span>Current password</span><input className="inp" type="password" name="current" autoComplete="current-password" required /></label>
        <label className="f"><span>New password</span><input className="inp" type="password" name="next" autoComplete="new-password" minLength={8} required /></label>
        <button className="btn pri">Change password</button>
      </form>
    </>
  );
}
