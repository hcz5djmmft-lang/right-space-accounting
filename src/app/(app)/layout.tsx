import { requireUser, logout } from '@/lib/auth';
import { waitingForUser } from '@/lib/documents';
import { openForUser } from '@/lib/tasks';
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
  const [waiting, myTasks] = await Promise.all([waitingForUser(user), openForUser(user.id)]);
  const n = waiting.length;
  // The menu follows the department: Finance holds the books; everyone else raises requests and sees their projects.
  const finance = hasRole(user, 'finance'), projects = hasRole(user, 'finance', 'engineering', 'projects'), tenders = hasRole(user, 'tenders'), hr = hasRole(user, 'hr', 'finance');
  // a site engineer or project manager without the engineering roles still gets the Site page for their projects
  const site = !projects && !!(await sql`select 1 from projects p join employees e on e.id in (p.site_eng_id, p.manager_id) where e.user_id = ${user.id} and p.status = 'Active' limit 1`)[0];
  const items: NavItem[] = [
    { href: '/', label: 'Overview' },
    { href: '/clock', label: 'Clock in' },
    { href: '/leave', label: 'Leave' },
    { href: '/approvals', label: 'Approvals', badge: n },
    { href: '/tasks', label: 'Tasks', badge: myTasks },
    ...(site ? [{ href: '/site', label: 'Site' }] : []),
    ...(finance ? ['Finance',
      { href: '/entries', label: 'Entries' },
      { href: '/accounts', label: 'Chart of accounts' },
      { href: '/banks', label: 'Banks & cash' },
      { href: '/partners', label: 'Partners' },
      { href: '/payment-requests', label: 'Payment requests' },
      { href: '/collections', label: 'Collections' },
      { href: '/sales-invoices', label: 'Sales invoices' },
      { href: '/parties', label: 'Customers & vendors' },
      { href: '/payroll', label: 'Payroll' }] as NavItem[]
      : ['Requests', { href: '/payment-requests', label: 'Payment requests' }] as NavItem[]),
    'Purchasing', { href: '/purchasing', label: 'Purchase requests' }, { href: '/purchasing/plan', label: 'Material plan' }, { href: '/purchasing/vendors', label: 'Vendors' }, { href: '/purchasing/work-orders', label: 'Work orders' }, { href: '/purchasing/stock', label: 'Site stock' }, { href: '/claims', label: 'Progress claims' }, { href: '/purchasing/reports', label: 'Procurement reports' }, { href: '/purchasing/materials', label: 'Materials' },
    ...(hr ? ['HR', { href: '/hr', label: 'Employees' }, { href: '/attendance', label: 'Attendance' }, { href: '/hr/pay-items', label: 'Pay items' }, { href: '/hr/reports', label: 'HR reports' }] as NavItem[] : []),
    ...(projects || tenders ? ['Projects',
      ...(projects ? [{ href: '/cost-centers', label: 'Cost centers' }, { href: '/design', label: 'Design' }, { href: '/qs', label: 'QS and pricing' }, { href: '/planning', label: 'Planning' }, { href: '/variations', label: 'Variation orders' }, { href: '/samples', label: 'Samples' }, { href: '/cost-control', label: 'Cost control' }, { href: '/site', label: 'Site execution' }] : []),
      ...(tenders ? [{ href: '/tenders', label: 'Tenders' }] : [])] as NavItem[] : []),
    ...(finance ? ['Insight', { href: '/reports', label: 'Reports' }] as NavItem[] : []),
    ...(hasRole(user, 'management') ? ['Admin', { href: '/settings', label: 'Settings' }] as NavItem[] : []),
    { href: '/account', label: 'My account' },
  ];
  return (
    <div className="shell">
      <Nav items={items} user={user.dept_name ? `${user.name} · ${user.dept_name}` : user.name} logout={signOut} />
      <main>{children}</main>
    </div>
  );
}
