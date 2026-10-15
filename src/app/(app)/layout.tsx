import { requireUser, logout } from '@/lib/auth';
import { waitingForUser } from '@/lib/documents';
import { openForUser } from '@/lib/tasks';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { notifyPending } from '@/lib/push';
import { Nav } from '@/components/Nav';
import { buildMenu, isGroup } from '@/lib/menu';
import { tr } from '@/lib/i18n';
import { getLang } from '@/lib/lang';

async function signOut() {
  'use server';
  await logout();
  redirect('/login');
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // after the page is sent: push to the phones whatever has started waiting for someone (at most every 20 seconds)
  after(() => notifyPending().catch(e => console.error('notify', e)));
  const [waiting, myTasks] = await Promise.all([waitingForUser(user), openForUser(user.id)]);
  const n = waiting.length;
  // The menu follows the department: Finance holds the books; everyone else raises requests and sees their projects.
  const finance = hasRole(user, 'finance'), projects = hasRole(user, 'finance', 'engineering', 'projects'), tenders = hasRole(user, 'tenders'), hr = hasRole(user, 'hr', 'finance');
  // a site engineer or project manager without the engineering roles still gets the Site page for their projects
  const site = !projects && !!(await sql`select 1 from projects p join employees e on e.id in (p.site_eng_id, p.manager_id) where e.user_id = ${user.id} and p.status = 'Active' limit 1`)[0];
  const items = buildMenu({ finance, projects: projects, tenders, hr, management: hasRole(user, 'management'), site, approvals: n, tasks: myTasks });
  const lang = await getLang();
  const shown = items.map(i => (isGroup(i) ? { group: tr(lang, i.group), items: i.items.map(l => ({ ...l, label: tr(lang, l.label) })) } : { ...i, label: tr(lang, i.label) }));
  return (
    <div className="shell">
      <Nav items={shown} user={user.dept_name ? `${user.name} · ${user.dept_name}` : user.name} logout={signOut} lang={lang} signOutLabel={tr(lang, 'Sign out')} />
      <main>{children}</main>
    </div>
  );
}
