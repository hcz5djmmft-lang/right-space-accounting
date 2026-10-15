'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { LangSwitch } from './LangSwitch';
import type { Lang } from '@/lib/i18n';
import { type MenuItem, type MenuLink, activeHref, isGroup, openPathFor } from '@/lib/menu';

export type NavItem = MenuItem;

/** The sidebar (computer) and the tab rows (phone). Each heading folds open on a tap and is closed by default; the ones
 *  holding the page you are on open by itself. A heading inside a heading (Finance > AP) opens the same way. */
export function Nav({ items, user, logout, lang = 'en', signOutLabel = 'Sign out' }: { items: MenuItem[]; user: string; logout: () => Promise<void>; lang?: Lang; signOutLabel?: string }) {
  const path = usePathname();
  const best = activeHref(items, path);
  const here = openPathFor(items, best);
  const hereKey = here.join('|');
  const on = (href: string) => (href === best ? 'on' : '');
  // the sidebar keeps any number of headings open; the phone shows one heading's pages at a time, a row per level
  const [open, setOpen] = useState<string[]>(here);
  const [phone, setPhone] = useState<string[]>(here);
  useEffect(() => {
    if (here.length) setOpen(o => [...new Set([...o, ...here])]);
    setPhone(here);
  }, [path, hereKey]);
  // on the phone, slide each row so the open heading and the page you are on are in view
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.querySelectorAll<HTMLElement>('.topbar').forEach(bar => {
      const el = bar.querySelector<HTMLElement>('.open, a.on');
      if (el && (el.offsetLeft < bar.scrollLeft || el.offsetLeft + el.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = el.offsetLeft - 24;
    });
  }, [path, phone]);
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
  // phone rows: the top row, then one row for each open heading
  const rows: { key: string; list: MenuItem[] }[] = [{ key: '', list: items }];
  for (const k of phone) {
    const parent = rows[rows.length - 1];
    const g = parent.list.find(i => isGroup(i) && (parent.key ? `${parent.key}/${i.group}` : i.group) === k);
    if (!g || !isGroup(g)) break;
    rows.push({ key: k, list: g.items });
  }
  const tapPhone = (k: string, depth: number) => setPhone(p => (p[depth] === k ? p.slice(0, depth) : [...p.slice(0, depth), k]));
  return (
    <>
      <aside className="side">
        <div className="brand"><img src="/logo.svg" alt="Right Space" style={{ width: '100%', maxWidth: 190, display: 'block' }} /></div>
        {side(items, '', 0)}
        <div className="who">{user}<br /><form action={logout}><button>{signOutLabel}</button></form><Suspense><LangSwitch lang={lang} /></Suspense></div>
      </aside>
      <div className="topwrap" ref={top}>
        {rows.map((r, depth) => (
          <nav key={'row' + r.key} className={'topbar' + (depth ? ' sub' : '')}>
            {r.list.map(i => {
              if (!isGroup(i)) return <Link key={i.href} href={i.href} className={on(i.href)}>{i.label}{i.badge ? ` (${i.badge})` : ''}</Link>;
              const k = r.key ? `${r.key}/${i.group}` : i.group;
              return <button key={'g' + k} type="button" className={'tabcat' + (phone[depth] === k ? ' open' : '') + (here[depth] === k ? ' here' : '')} aria-expanded={phone[depth] === k}
                onClick={() => tapPhone(k, depth)}>{i.group} <span aria-hidden>{phone[depth] === k ? '▴' : '▾'}</span></button>;
            })}
            {depth === 0 && <>
              <Suspense><LangSwitch lang={lang} className="btn sm langsw" /></Suspense>
              <form action={logout}><button className="btn sm" style={{ background: 'none', color: 'var(--muted)', border: 0 }}>{signOutLabel}</button></form></>}
          </nav>))}
      </div>
    </>
  );
}
