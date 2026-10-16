'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { LangSwitch } from './LangSwitch';
import { Icon, type IconName } from './Icons';
import { type Lang, tr } from '@/lib/i18n';
import { type MenuGroup, type MenuItem, type MenuLink, activeHref, allLinks, isGroup, openPathFor } from '@/lib/menu';

export type NavItem = MenuItem;

/** The bottom bar on phones holds Home, Clock in, Tasks and Approvals; everything else is on the More page. */
const BAR = ['/', '/clock', '/tasks', '/approvals'];
const YOU = ['/settings', '/account'];
const ICON: Record<string, IconName> = {
  '/': 'home', '/clock': 'clock', '/tasks': 'tasks', '/approvals': 'stamp', '/leave': 'calendar', '/purchasing/new': 'cart', '/site': 'pin', '/settings': 'gear', '/account': 'user',
  Partners: 'people', Finance: 'bank', Engineering: 'ruler', Procurement: 'box', 'HR & Admin': 'folder', AP: 'cash', AR: 'doc', Closing: 'lock', 'Technical Office': 'ruler', Design: 'pen', Site: 'pin',
};
const iconOf = (i: MenuItem): IconName => (isGroup(i) ? ICON[i.key ?? i.group] ?? 'folder' : ICON[i.href] ?? 'doc');
const names = (g: MenuGroup) => g.items.slice(0, 3).map(x => (isGroup(x) ? x.group : x.label)).join(' · ') + (g.items.length > 3 ? ' · …' : '');

/** The sidebar (computer) and, on phones, the slim header, the bottom bar and the More page. Each sidebar heading folds open on a
 *  tap and is closed by default; the ones holding the page you are on open by itself. On the phone a heading is a card on the More
 *  page that opens its pages (and its own headings) with a Back button. */
export function Nav({ items, user, logout, lang = 'en', signOutLabel = 'Sign out' }: { items: MenuItem[]; user: string; logout: () => Promise<void>; lang?: Lang; signOutLabel?: string }) {
  const path = usePathname();
  const t = (s: string) => tr(lang, s);
  const best = activeHref(items, path);
  const here = openPathFor(items, best);
  const hereKey = here.join('|');
  const on = (href: string) => (href === best ? 'on' : '');
  // the sidebar keeps any number of headings open
  const [open, setOpen] = useState<string[]>(here);
  useEffect(() => { if (here.length) setOpen(o => [...new Set([...o, ...here])]); }, [path, hereKey]);
  const toggle = (k: string) => setOpen(o => (o.includes(k) ? o.filter(x => x !== k && !x.startsWith(k + '/')) : [...o, k]));
  const link = (l: MenuLink) => <Link key={l.href} href={l.href} className={on(l.href)}>{l.label}{l.badge ? <span className="badge">{l.badge}</span> : null}</Link>;
  const side = (list: MenuItem[], prefix: string, depth: number): React.ReactNode => list.map(i => {
    if (!isGroup(i)) return link(i);
    const k = prefix ? `${prefix}/${i.group}` : i.group;
    return (
      <div key={'g' + k} className={'cat' + (open.includes(k) ? ' open' : '') + (depth ? ' sub' : '')}>
        <button type="button" className="grp" aria-expanded={open.includes(k)} onClick={() => toggle(k)}>
          <span>{i.group}</span><span className="chev" aria-hidden>▸</span></button>
        {open.includes(k) && <div className={depth ? 'nest' : ''}>{side(i.items, k, depth + 1)}</div>}
      </div>);
  });

  // the phone: the More page closes when the page changes; while it is open the page behind it does not scroll
  const [more, setMore] = useState(false);
  const [stack, setStack] = useState<MenuGroup[]>([]);
  useEffect(() => { setMore(false); setStack([]); }, [path]);
  const ttl = useRef<HTMLSpanElement>(null), moreBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    document.body.classList.toggle('more-open', more);
    document.querySelector('main')?.toggleAttribute('inert', more);
    if (!more) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('more-open'); document.querySelector('main')?.removeAttribute('inert'); moreBtn.current?.focus(); };
  }, [more]);
  // the title takes the focus when More opens and after each step in or back, so a screen reader reads where it is
  useEffect(() => { if (more) ttl.current?.focus(); }, [more, stack.length]);
  const links = allLinks(items);
  const bar = BAR.map(h => links.find(l => l.href === h)).filter((l): l is MenuLink => !!l);
  const inBar = !!best && BAR.includes(best);
  const pages = items.filter((i): i is MenuLink => !isGroup(i) && !BAR.includes(i.href) && !YOU.includes(i.href));
  const depts = items.filter(isGroup);
  const you = items.filter((i): i is MenuLink => !isGroup(i) && YOU.includes(i.href));
  const title = links.find(l => l.href === best)?.label ?? '';
  const cur = stack[stack.length - 1];
  const card = (i: MenuItem) => {
    const ic = <span className="ic"><Icon name={iconOf(i)} /></span>;
    if (isGroup(i)) return (
      <button key={'g' + i.group} type="button" className="crd" onClick={() => setStack(s => [...s, i])}>
        {ic}<span className="tx"><span className="t">{i.group}</span><span className="d">{names(i)}</span></span><span className="ch"><Icon name="chev" /></span></button>);
    return (
      <Link key={i.href} href={i.href} className={'crd ' + on(i.href)} aria-current={best === i.href ? 'page' : undefined} onClick={() => setMore(false)}>
        {ic}<span className="tx"><span className="t">{i.label}</span></span>{i.badge ? <span className="badge">{i.badge}</span> : <span className="ch"><Icon name="chev" /></span>}</Link>);
  };
  return (
    <>
      <aside className="side">
        <div className="brand"><img src="/logo.svg" alt="Right Space" style={{ width: '100%', maxWidth: 190, display: 'block' }} /></div>
        {side(items, '', 0)}
        <div className="who">{user}<br /><form action={logout}><button>{signOutLabel}</button></form><Suspense><LangSwitch lang={lang} /></Suspense></div>
      </aside>

      {path !== '/' && <header className="phead" inert={more}><img src="/logo.svg" alt="Right Space" /><span className="ttl" dir="auto">{title}</span></header>}
      {more && (
        <div className="more" role="dialog" aria-modal="true" aria-labelledby="more-ttl">
          <header className="phead">
            {cur ? <button type="button" className="rbtn back" onClick={() => setStack(s => s.slice(0, -1))} aria-label={t('Back')}><Icon name="back" /></button> : <img src="/logo.svg" alt="Right Space" />}
            <span id="more-ttl" className="ttl" ref={ttl} tabIndex={-1}>{cur ? cur.group : t('More')}</span>
          </header>
          <div className="page">
            {cur ? cur.items.map(card) : <>
              {pages.length > 0 && <><div className="grp-h">{t('Pages')}</div>{pages.map(card)}</>}
              {depts.length > 0 && <><div className="grp-h">{t('Departments')}</div>{depts.map(card)}</>}
              <div className="grp-h">{t('You')}</div>
              {you.map(card)}
              <Suspense><LangSwitch lang={lang} className="crd"><span className="ic"><Icon name="globe" /></span><span className="tx"><span className="t" lang={lang === 'ar' ? 'en' : 'ar'}>{lang === 'ar' ? 'English' : 'العربية'}</span><span className="d">{t('Switch the language')}</span></span></LangSwitch></Suspense>
              <form action={logout}><button className="crd bad"><span className="ic"><Icon name="out" /></span><span className="tx"><span className="t">{signOutLabel}</span><span className="d" dir="auto">{user}</span></span></button></form>
            </>}
          </div>
        </div>)}
      <nav className="bbar" aria-label={t('Menu')}>
        {bar.map(l => (
          <Link key={l.href} href={l.href} className={!more ? on(l.href) : ''} aria-current={!more && best === l.href ? 'page' : undefined} onClick={() => setMore(false)}>
            <Icon name={ICON[l.href]} />{l.href === '/' ? t('Home') : l.label}{l.badge ? <span className="badge">{l.badge}</span> : null}</Link>))}
        <button type="button" ref={moreBtn} className={more || !inBar ? 'on' : ''} aria-expanded={more} onClick={() => { setMore(m => !m); setStack([]); }}><Icon name="more" />{t('More')}</button>
      </nav>
    </>
  );
}
