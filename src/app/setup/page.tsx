import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { hashPassword, login } from '@/lib/auth';

// First run on a fresh database: creates the first Management login. Works only while no login exists,
// so the owner can set the system up from the browser without a command line. Afterwards people are added in Settings.
// With SETUP_CODE set in the hosting settings, the page also asks for that code, so nobody else can get in first.
const noUsers = async () => (await sql<{ n: number }[]>`select count(*)::int n from users`)[0].n === 0;
export const dynamic = 'force-dynamic'; // the check must run on every request, never at build time
export const maxDuration = 30; // a request that waits on the database gives up after half a minute, not five
const setupCode = () => process.env.SETUP_CODE?.trim() || ''; // trimmed, so a stray space typed in Vercel cannot lock the page

async function createFirst(form: FormData) {
  'use server';
  const email = String(form.get('email') ?? '').trim().toLowerCase(), name = String(form.get('name') ?? '').trim(), password = String(form.get('password') ?? '');
  if (setupCode() && String(form.get('code') ?? '').trim() !== setupCode()) redirect('/setup?error=code');
  if (!email.includes('@') || !name || password.length < 8) redirect('/setup?error=1');
  // the insert itself checks that the table is still empty, so two first logins cannot be created at once
  const rows = await sql`insert into users (email, name, password_hash, roles)
    select ${email}, ${name}, ${await hashPassword(password)}, ${['management']}::text[] where not exists (select 1 from users)`;
  if (rows.count === 0) redirect('/login');
  await login(email, password);
  redirect('/settings');
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await noUsers())) redirect('/login');
  const { error } = await searchParams;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--ink)' }}>
      <form action={createFirst} className="card" style={{ width: '100%', maxWidth: 400, display: 'grid', gap: 12 }}>
        <div className="brand" style={{ padding: 0 }}>RIGHT <b style={{ color: 'var(--gold-ink)' }}>SPACE</b> <span className="muted" style={{ fontWeight: 400 }}>Accounting</span></div>
        <h1 style={{ fontSize: 18, margin: 0 }}>Welcome. Create the first login.</h1>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>This person gets the Management role and can add everyone else in Settings. This page disappears once a login exists.</p>
        {error && <div className="msg bad">{error === 'code' ? 'The setup code is wrong.' : 'Enter a name, a valid email and a password of at least 8 characters.'}</div>}
        {setupCode() && <label className="f"><span>Setup code (from the hosting settings)</span><input className="inp" name="code" autoComplete="off" required /></label>}
        <label className="f"><span>Your name</span><input className="inp" name="name" autoComplete="name" required /></label>
        <label className="f"><span>Email</span><input className="inp" name="email" type="email" autoComplete="username" required /></label>
        <label className="f"><span>Password (8+ characters)</span><input className="inp" name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <button className="btn pri" type="submit">Create login and sign in</button>
      </form>
    </div>
  );
}
