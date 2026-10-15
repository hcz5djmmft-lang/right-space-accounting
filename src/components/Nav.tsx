'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { LangSwitch } from './LangSwitch';
import type { Lang } from '@/lib/i18n';
import { type MenuItem, activeHref, isGroup, openGroupFor } from '@/lib/menu';

export type NavItem = MenuItem;

/** The sidebar (computer) and the tab row (phone). Each category folds open on a tap and is closed by default;
 *  the one holding the page you are on opens by itself. */
export function Nav({ items, user, logout, lang = 'en', signOutLabel = 'Sign out' }: { items: MenuItem[]; user: string; logout: () => Promise<void>; lang?: Lang; signOutLabel?: string }) {
  const path = usePathname();
  const best = activeHref(items, path);
  const here = openGroupFor(items, best);
  const on = (href: string) => (href === best ? 'on' : '');
  // the sidebar keeps any number of categories open; the phone shows one category's pages at a time in a second row
  const [open, setOpen] = useState<string[]>(here ? [here] : []);
  const [phone, setPhone] = useState<string | null>(here);
  useEffect(() => {
    if (here) setOpen(o => (o.includes(here) ? o : [...o, here]));
    setPhone(here);
  }, [path, here]);
  // on the phone, slide each row so the open category and the page you are on are in view
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.querySelectorAll<HTMLElement>('.topbar').forEach(bar => {
      const el = bar.querySelector<HTMLElement>('.open, a.on');
      if (el && (el.offsetLeft < bar.scrollLeft || el.offsetLeft + el.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = el.offsetLeft - 24;
    });
  }, [path, phone]);
  const toggle = (g: string) => setOpen(o => (o.includes(g) ? o.filter(x => x !== g) : [...o, g]));
  const phoneGroup = items.find(i => isGroup(i) && i.group === phone);
  return (
    <>
      <aside className="side">
        <div className="brand"><img src="/logo.svg" alt="Right Space" style={{ width: '100%', maxWidth: 190, display: 'block' }} /></div>
        {items.map(i => isGroup(i)
          ? <div key={'g' + i.group} className={'cat' + (open.includes(i.group) ? ' open' : '')}>
              <button type="button" className="grp" aria-expanded={open.includes(i.group)} onClick={() => toggle(i.group)}>
                <span>{i.group}</span><span className="chev" aria-hidden>▸</span></button>
              {open.includes(i.group) && i.items.map(l => <Link key={l.href} href={l.href} className={on(l.href)}>{l.label}{l.badge ? <span className="badge">{l.badge}</span> : null}</Link>)}
            </div>
          : <Link key={i.href} href={i.href} className={on(i.href)}>{i.label}{i.badge ? <span className="badge">{i.badge}</span> : null}</Link>)}
        <div className="who">{user}<br /><form action={logout}><button>{signOutLabel}</button></form><Suspense><LangSwitch lang={lang} /></Suspense></div>
      </aside>
      <div className="topwrap" ref={top}>
        <nav className="topbar">
          {items.map(i => isGroup(i)
            ? <button key={'g' + i.group} type="button" className={'tabcat' + (phone === i.group ? ' open' : '') + (here === i.group ? ' here' : '')} aria-expanded={phone === i.group}
                onClick={() => setPhone(p => (p === i.group ? null : i.group))}>{i.group} <span aria-hidden>{phone === i.group ? '▴' : '▾'}</span></button>
            : <Link key={i.href} href={i.href} className={on(i.href)}>{i.label}{i.badge ? ` (${i.badge})` : ''}</Link>)}
          <Suspense><LangSwitch lang={lang} className="btn sm langsw" /></Suspense>
          <form action={logout}><button className="btn sm" style={{ background: 'none', color: 'var(--muted)', border: 0 }}>{signOutLabel}</button></form>
        </nav>
        {phoneGroup && isGroup(phoneGroup) && (
          <nav className="topbar sub">
            {phoneGroup.items.map(l => <Link key={l.href} href={l.href} className={on(l.href)}>{l.label}{l.badge ? ` (${l.badge})` : ''}</Link>)}
          </nav>)}
      </div>
    </>
  );
}
