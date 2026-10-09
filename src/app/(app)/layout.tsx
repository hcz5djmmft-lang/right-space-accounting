import { requireUser, logout } from '@/lib/auth';
import { waitingForUser } from '@/lib/documents';
import { hasRole } from '@/lib/roles';
import { redirect } from 'next/navigation';
import { Nav, type NavItem } from '@/components/Nav';

async function signOut() {
  'use server';
  await logout();
  redirect('/login');
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const n = (await waitingForUser(user)).length;
  const items: NavItem[] = [
    { href: '/', label: 'Overview' },
    { href: '/approvals', label: 'Approvals', badge: n },
    'Books',
    { href: '/entries', label: 'Entries' },
    { href: '/accounts', label: 'Chart of accounts' },
    ...(hasRole(user, 'finance') ? [{ href: '/banks', label: 'Banks & cash' }] : []),
    'Projects',
    { href: '/cost-centers', label: 'Cost centers' },
    'Trade',
    { href: '/payment-requests', label: 'Payment requests' },
    { href: '/sales-invoices', label: 'Sales invoices' },
    { href: '/parties', label: 'Customers & vendors' },
    'Insight',
    { href: '/reports', label: 'Reports' },
    ...(hasRole(user, 'management') ? ['Admin', { href: '/settings', label: 'Settings' }] as NavItem[] : []),
    { href: '/account', label: 'My account' },
  ];
  return (
    <div className="shell">
      <Nav items={items} user={user.name} logout={signOut} />
      <main>{children}</main>
    </div>
  );
}
