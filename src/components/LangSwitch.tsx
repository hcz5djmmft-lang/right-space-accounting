'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { setLangAction } from '@/app/lang-actions';
import type { Lang } from '@/lib/i18n';

/** "العربية" when the page reads English, "English" when it reads Arabic: one tap switches and stays on the same page.
 *  With children (the phone's More page) the whole card is the button. */
export function LangSwitch({ lang, className = 'langsw', children }: { lang: Lang; className?: string; children?: React.ReactNode }) {
  const path = usePathname(), q = useSearchParams().toString();
  const to: Lang = lang === 'ar' ? 'en' : 'ar';
  return (
    <form action={setLangAction} style={children ? undefined : { display: 'inline' }}>
      <input type="hidden" name="lang" value={to} />
      <input type="hidden" name="back" value={path + (q ? `?${q}` : '')} />
      {children
        ? <button className={className}>{children}</button>
        : <button className={className} lang={to} dir={to === 'ar' ? 'rtl' : 'ltr'}>{to === 'ar' ? 'العربية' : 'English'}</button>}
    </form>
  );
}
