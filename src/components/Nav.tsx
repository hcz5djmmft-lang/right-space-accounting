'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavItem = { href: string; label: string; badge?: number } | string;

export function Nav({ items, user, logout }: { items: NavItem[]; user: string; logout: () => Promise<void> }) {
  const path = usePathname();
  const on = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const links = items.filter((i): i is Exclude<NavItem, string> => typeof i !== 'string');
  return (
    <>
      <aside className="side">
        <div className="brand">RIGHT <b>SPACE</b><div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>Accounting</div></div>
        {items.map((i, k) => typeof i === 'string'
          ? <div key={k} className="grp">{i}</div>
          : <Link key={i.href} href={i.href} className={on(i.href) ? 'on' : ''}>{i.label}{i.badge ? <span className="badge">{i.badge}</span> : null}</Link>)}
        <div className="who">{user}<br /><form action={logout}><button>Sign out</button></form></div>
      </aside>
      <nav className="topbar">
        {links.map(i => <Link key={i.href} href={i.href} className={on(i.href) ? 'on' : ''}>{i.label}{i.badge ? ` (${i.badge})` : ''}</Link>)}
        <form action={logout}><button className="btn sm" style={{ background: 'none', color: '#b9b2a5', border: 0 }}>Sign out</button></form>
      </nav>
    </>
  );
}
