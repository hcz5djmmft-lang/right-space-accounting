import { redirect } from 'next/navigation';
import { login, currentUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { Suspense } from 'react';
import { tr } from '@/lib/i18n';
import { getLang, langAtSignIn } from '@/lib/lang';
import { LangSwitch } from '@/components/LangSwitch';
export const maxDuration = 30; // give up after half a minute, not five

async function signIn(form: FormData) {
  'use server';
  const email = String(form.get('email') ?? '');
  const r = await login(email, String(form.get('password') ?? ''));
  if (r === 'ok') await langAtSignIn(email);
  redirect(r === 'ok' ? '/' : `/login?error=${r}`);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect('/');
  // a fresh database has no login yet: the first one is created on /setup
  if ((await sql<{ n: number }[]>`select count(*)::int n from users`)[0].n === 0) redirect('/setup');
  const { error } = await searchParams;
  const lang = await getLang();
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--sand)' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
      <form action={signIn} className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="brand" style={{ padding: 0 }}>RIGHT <b style={{ color: 'var(--gold-ink)' }}>SPACE</b></div>
        {error && <div className="msg bad">{tr(lang, error === 'locked' ? 'Too many wrong attempts. Try again in 15 minutes.' : 'Wrong email or password.')}</div>}
        <label className="f"><span>{tr(lang, 'Email')}</span><input className="inp" name="email" type="email" dir="ltr" autoComplete="username" required /></label>
        <label className="f"><span>{tr(lang, 'Password')}</span><input className="inp" name="password" type="password" dir="ltr" autoComplete="current-password" required /></label>
        <button className="btn pri" type="submit">{tr(lang, 'Sign in')}</button>
      </form>
      <div style={{ textAlign: 'center', marginTop: 8 }}><Suspense><LangSwitch lang={lang} /></Suspense></div>
      </div>
    </div>
  );
}
