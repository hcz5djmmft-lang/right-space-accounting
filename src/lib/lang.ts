import 'server-only';
import { cookies } from 'next/headers';
import { sql } from './db';
import { LANG_COOKIE, isLang, type Lang } from './i18n';

// The reading language (improvement 3): a cookie on the device, kept on the login too so it follows the person to a
// new phone; signing in takes the login's language, or saves the device's choice when the login has none yet.

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : 'en';
}

export async function setLangCookie(lang: Lang) {
  (await cookies()).set(LANG_COOKIE, lang, { path: '/', sameSite: 'lax', maxAge: 400 * 864e2 });
}

export async function saveLang(userId: string | null, lang: Lang) {
  await setLangCookie(lang);
  if (userId) await sql`update users set lang = ${lang} where id = ${userId}`;
}

/** At sign-in: the login's language wins; a login with none takes the device's. */
export async function langAtSignIn(email: string) {
  const [u] = await sql<{ id: string; lang: string | null }[]>`select id, lang from users where lower(email) = lower(${email.trim()}) and active`;
  if (!u) return;
  if (isLang(u.lang)) await setLangCookie(u.lang);
  else await sql`update users set lang = ${await getLang()} where id = ${u.id}`;
}
