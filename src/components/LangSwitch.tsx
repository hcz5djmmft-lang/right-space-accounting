'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { setLangAction } from '@/app/lang-actions';
import type { Lang } from '@/lib/i18n';

/** "العربية" when the page reads English, "English" when it reads Arabic: one tap switches and stays on the same page. */
export function LangSwitch({ lang, className = 'langsw' }: { lang: Lang; className?: string }) {
  const path = usePathname(), q = useSearchParams().toString();
  const to: Lang = lang === 'ar' ? 'en' : 'ar';
  return (
    <form action={setLangAction} style={{ display: 'inline' }}>
      <input type="hidden" name="lang" value={to} />
      <input type="hidden" name="back" value={path + (q ? `?${q}` : '')} />
      <button className={className} lang={to} dir={to === 'ar' ? 'rtl' : 'ltr'}>{to === 'ar' ? 'العربية' : 'English'}</button>
    </form>
  );
}
