import { redirect } from 'next/navigation';
import { login, currentUser } from '@/lib/auth';

async function signIn(form: FormData) {
  'use server';
  const ok = await login(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
  redirect(ok ? '/' : '/login?error=1');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect('/');
  const { error } = await searchParams;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--ink)' }}>
      <form action={signIn} className="card" style={{ width: '100%', maxWidth: 360, display: 'grid', gap: 12 }}>
        <div className="brand" style={{ padding: 0 }}>RIGHT <b style={{ color: 'var(--gold-ink)' }}>SPACE</b> <span className="muted" style={{ fontWeight: 400 }}>Accounting</span></div>
        {error && <div className="msg bad">Wrong email or password.</div>}
        <label className="f"><span>Email</span><input className="inp" name="email" type="email" autoComplete="username" required /></label>
        <label className="f"><span>Password</span><input className="inp" name="password" type="password" autoComplete="current-password" required /></label>
        <button className="btn pri" type="submit">Sign in</button>
      </form>
    </div>
  );
}
