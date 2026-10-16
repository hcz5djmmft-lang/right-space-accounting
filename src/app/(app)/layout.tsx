import { requireUser } from '@/lib/auth';
import { waitingForUser } from '@/lib/documents';
import { DateAutoClose } from '@/components/DateAutoClose';
import { openForUser } from '@/lib/tasks';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { after } from 'next/server';
import { notifyPending } from '@/lib/push';
import { Nav } from '@/components/Nav';
import { signOutAction } from '@/app/sign-out-action';
import { type MenuItem, buildMenu, isGroup } from '@/lib/menu';
import { tr } from '@/lib/i18n';
import { getLang } from '@/lib/lang';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // after the page is sent: push to the phones whatever has started waiting for someone (at most every 20 seconds)
  after(() => notifyPending().catch(e => console.error('notify', e)));
  const [waiting, myTasks] = await Promise.all([waitingForUser(user), openForUser(user.id)]);
  const n = waiting.length;
  // The menu follows the sub-categories the person was given (Settings > People); Management sees everything.
  const access = user.access ?? [], management = hasRole(user, 'management');
  // a site engineer or project manager without Engineering > Site still gets the Site page for their projects
  const site = !management && !access.includes('site') && !!(await sql`select 1 from projects p join employees e on e.id in (p.site_eng_id, p.manager_id) where e.user_id = ${user.id} and p.status = 'Active' limit 1`)[0];
  const items = buildMenu({ access, management, site, approvals: n, tasks: myTasks });
  const lang = await getLang();
  const say = (list: MenuItem[]): MenuItem[] => list.map(i => (isGroup(i) ? { group: tr(lang, i.group), key: i.group, items: say(i.items) } : { ...i, label: tr(lang, i.label) }));
  const shown = say(items);
  return (
    <div className="shell">
      <Nav items={shown} user={user.dept_name ? `${user.name} · ${user.dept_name}` : user.name} logout={signOutAction} lang={lang} signOutLabel={tr(lang, 'Sign out')} />
      <main>{children}</main>
      <DateAutoClose />
    </div>
  );
}
