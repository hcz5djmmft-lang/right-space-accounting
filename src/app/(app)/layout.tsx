import { requireUser, logout } from '@/lib/auth';
import { waitingForUser } from '@/lib/documents';
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
    'Projects',
    { href: '/cost-centers', label: 'Cost centers' },
    'Trade',
    { href: '/payment-requests', label: 'Payment requests' },
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
