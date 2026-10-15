// The menu (update 20). Headings fold open on a tap and are closed by default, except the ones holding the page you are on.
// Finance is one heading again, opening AP, AR and Closing (each a heading of its own) and then its five pages; Projects is
// Engineering, opening Technical Office, Design and Site; Purchasing is Procurement. What a person sees follows the
// sub-categories they were given (src/lib/access.ts). Plain data, no server code, so the sidebar and the phone tab row
// (a client component) and the tests share it.

export type MenuLink = { href: string; label: string; badge?: number };
export type MenuGroup = { group: string; items: MenuItem[] };
export type MenuItem = MenuLink | MenuGroup;

export const isGroup = (i: MenuItem): i is MenuGroup => 'group' in i;

export type MenuFlags = {
  /** the sub-categories the person may open; Management gets them all */
  access: readonly string[]; management: boolean; site: boolean;
  approvals: number; tasks: number;
};

export function buildMenu(f: MenuFlags): MenuItem[] {
  const has = (k: string) => f.management || f.access.includes(k);
  const g = (group: string, items: MenuItem[]): MenuGroup[] => (items.length ? [{ group, items }] : []);
  const when = (k: string, items: MenuItem[]) => (has(k) ? items : []);
  return [
    { href: '/', label: 'Overview' },
    { href: '/clock', label: 'Clock in' },
    { href: '/leave', label: 'Leave' },
    { href: '/approvals', label: 'Approvals', badge: f.approvals },
    { href: '/tasks', label: 'Tasks', badge: f.tasks },
    { href: '/purchasing/new', label: 'New purchase request' },
    ...(f.site && !has('site') ? [{ href: '/site', label: 'Site' }] : []),
    ...g('Finance', [
      ...when('ap', g('AP', [
        { href: '/banks', label: 'Banks & cash' },
        { href: '/petty-cash', label: 'Petty cash' },
        { href: '/payment-requests', label: 'Payment requests' },
        { href: '/ap-invoices', label: 'Invoices' },
        { href: '/payables', label: 'Payables' },
        { href: '/vendors', label: 'Vendors & subcontractors' }])),
      ...when('ar', g('AR', [
        { href: '/sales-invoices', label: 'Sales invoices' },
        { href: '/collections', label: 'Collections' },
        { href: '/collections/follow-up', label: 'Collections follow-up' },
        { href: '/customers', label: 'Customers' }])),
      ...when('closing', g('Closing', [
        { href: '/close', label: 'Month-end close' },
        { href: '/bank-reconciliation', label: 'Bank reconciliation' },
        { href: '/fixed-assets', label: 'Fixed assets' },
        { href: '/reports', label: 'Reports' },
        ...(f.management ? [{ href: '/settings/audit', label: 'Audit log' }] : [])])),
      ...when('books', [
        { href: '/entries', label: 'Entries' },
        { href: '/accounts', label: 'Chart of accounts' },
        { href: '/opening-balances', label: 'Opening balances' },
        { href: '/budgets', label: 'Budgets' }]),
      ...when('payroll', [{ href: '/payroll', label: 'Payroll' }]),
    ]),
    ...when('partners', g('Partners', [
      { href: '/partners', label: 'Partners' },
      { href: '/dashboard', label: "Partners' dashboard" }])),
    ...g('Engineering', [
      ...when('cost_centers', [{ href: '/cost-centers', label: 'Cost centers' }]),
      ...when('tech_office', g('Technical Office', [
        { href: '/qs', label: 'QS and pricing' },
        { href: '/planning', label: 'Planning' },
        { href: '/cost-control', label: 'Cost control' },
        { href: '/variations', label: 'Variation orders' },
        { href: '/tenders', label: 'Tenders' }])),
      ...(has('design') || has('tech_office') ? g('Design', [
        { href: '/design/concept', label: 'Main concept' },
        { href: '/design/shop', label: 'Shop drawings' }]) : []),
      ...when('site', g('Site', [
        { href: '/site', label: 'Site execution' },
        { href: '/samples', label: 'Samples' }])),
    ]),
    ...when('procurement', g('Procurement', [
      { href: '/purchasing', label: 'Purchase requests' }, { href: '/purchasing/orders', label: 'Purchase orders' },
      { href: '/purchasing/plan', label: 'Material plan' }, { href: '/purchasing/vendors', label: 'Vendors' },
      { href: '/purchasing/work-orders', label: 'Work orders' }, { href: '/purchasing/stock', label: 'Site stock' }, { href: '/claims', label: 'Progress claims' },
      { href: '/purchasing/reports', label: 'Procurement reports' }, { href: '/purchasing/materials', label: 'Materials' }])),
    ...when('hr', g('HR', [{ href: '/hr', label: 'Employees' }, { href: '/attendance', label: 'Attendance' }, { href: '/hr/pay-items', label: 'Pay items' }, { href: '/hr/reports', label: 'HR reports' }])),
    ...(f.management ? g('Admin', [{ href: '/settings', label: 'Settings' }]) : []),
    { href: '/account', label: 'My account' },
  ];
}

/** Every link, in menu order, at any depth. */
export const allLinks = (items: MenuItem[]): MenuLink[] => items.flatMap(i => (isGroup(i) ? allLinks(i.items) : [i]));

// pages reached from a menu page but living under another address: they light up (and open) that page's category
const ALSO: [string, string][] = [['/parties', '/vendors'], ['/design', '/design/concept']];

/** The menu link for the page at `path`: the most specific match, so Collections follow-up lights up and not also Collections. */
export function activeHref(items: MenuItem[], path: string): string | undefined {
  const links = allLinks(items);
  const match = (href: string, p: string) => (href === '/' ? p === '/' : p === href || p.startsWith(href + '/'));
  const best = links.filter(i => match(i.href, path)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  if (best) return best;
  return ALSO.find(([from, to]) => match(from, path) && links.some(l => l.href === to))?.[1];
}

/** The headings holding the page you are on, outermost first ("Finance", "Finance/AP"); they open by themselves. */
export function openPathFor(items: MenuItem[], href: string | undefined, prefix = ''): string[] {
  if (!href) return [];
  for (const i of items) {
    if (!isGroup(i)) continue;
    const key = prefix ? `${prefix}/${i.group}` : i.group;
    if (i.items.some(l => !isGroup(l) && l.href === href)) return [key];
    const inner = openPathFor(i.items, href, key);
    if (inner.length) return [key, ...inner];
  }
  return [];
}

/** The outermost heading holding the page you are on. */
export const openGroupFor = (items: MenuItem[], href: string | undefined): string | null => openPathFor(items, href)[0] ?? null;
