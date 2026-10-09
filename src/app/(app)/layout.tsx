import { requireUser, logout } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { redirect } from 'next/navigation';
import { Nav, type NavItem } from '@/components/Nav';

async function signOut() {
  'use server';
  await logout();
  redirect('/login');
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from journal_entries where status = 'pending'`;
  const items: NavItem[] = [
    { href: '/', label: 'Overview' },
    { href: '/approvals', label: 'Approvals', badge: hasRole(user, 'finance') ? n : 0 },
    'Books',
    { href: '/entries', label: 'Entries' },
    { href: '/accounts', label: 'Chart of accounts' },
    'Projects',
    { href: '/cost-centers', label: 'Cost centers' },
    'Trade',
    { href: '/parties', label: 'Customers & vendors' },
    'Insight',
    { href: '/reports', label: 'Reports' },
  ];
  return (
    <div className="shell">
      <Nav items={items} user={user.name} logout={signOut} />
      <main>{children}</main>
    </div>
  );
}
