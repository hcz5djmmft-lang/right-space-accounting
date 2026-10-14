'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { isLang } from '@/lib/i18n';
import { saveLang } from '@/lib/lang';

/** The language switch (sign-in page, My account, the menu): saves the choice and goes back to the page it was made on. */
export async function setLangAction(f: FormData) {
  const lang = f.get('lang');
  if (!isLang(lang)) return;
  const u = await currentUser();
  await saveLang(u?.id ?? null, lang);
  revalidatePath('/', 'layout');
  const back = String(f.get('back') ?? '/');
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/');
}
