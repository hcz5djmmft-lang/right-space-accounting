// The menu (update 19). Finance is split into AP, AR, Partners, Closing and Finance; every heading is a category that
// folds open on a tap and is closed by default, except the one holding the page you are on. Plain data, no server
// code, so the sidebar and the phone tab row (a client component) and the tests share it.

export type MenuLink = { href: string; label: string; badge?: number };
export type MenuGroup = { group: string; items: MenuLink[] };
export type MenuItem = MenuLink | MenuGroup;

export const isGroup = (i: MenuItem): i is MenuGroup => 'group' in i;

export type MenuFlags = {
  finance: boolean; projects: boolean; tenders: boolean; hr: boolean; management: boolean; site: boolean;
  approvals: number; tasks: number;
};

export function buildMenu(f: MenuFlags): MenuItem[] {
  const g = (group: string, items: MenuLink[]): MenuGroup[] => (items.length ? [{ group, items }] : []);
  return [
    { href: '/', label: 'Overview' },
    { href: '/clock', label: 'Clock in' },
    { href: '/leave', label: 'Leave' },
    { href: '/approvals', label: 'Approvals', badge: f.approvals },
    { href: '/tasks', label: 'Tasks', badge: f.tasks },
    { href: '/expenses', label: 'Expenses' },
    ...(f.site ? [{ href: '/site', label: 'Site' }] : []),
    ...(f.finance ? [
      ...g('AP', [
        { href: '/banks', label: 'Banks & cash' },
        { href: '/petty-cash', label: 'Petty cash' },
        { href: '/payment-requests', label: 'Payment requests' },
        { href: '/payables', label: 'Payables' },
        { href: '/vendors', label: 'Vendors & subcontractors' }]),
      ...g('AR', [
        { href: '/sales-invoices', label: 'Sales invoices' },
        { href: '/collections', label: 'Collections' },
        { href: '/collections/follow-up', label: 'Collections follow-up' },
        { href: '/customers', label: 'Customers' }]),
      ...g('Partners', [
        { href: '/partners', label: 'Partners' },
        { href: '/dashboard', label: "Partners' dashboard" }]),
      ...g('Closing', [
        { href: '/close', label: 'Month-end close' },
        { href: '/fixed-assets', label: 'Fixed assets' },
        { href: '/reports', label: 'Reports' },
        ...(f.management ? [{ href: '/settings/audit', label: 'Audit log' }] : [])]),
      ...g('Finance', [
        { href: '/entries', label: 'Entries' },
        { href: '/accounts', label: 'Chart of accounts' },
        { href: '/opening-balances', label: 'Opening balances' },
        { href: '/budgets', label: 'Budgets' },
        { href: '/payroll', label: 'Payroll' }]),
    ] : g('Requests', [{ href: '/payment-requests', label: 'Payment requests' }])),
    ...g('Purchasing', [
      { href: '/purchasing', label: 'Purchase requests' }, { href: '/purchasing/plan', label: 'Material plan' }, { href: '/purchasing/vendors', label: 'Vendors' },
      { href: '/purchasing/work-orders', label: 'Work orders' }, { href: '/purchasing/stock', label: 'Site stock' }, { href: '/claims', label: 'Progress claims' },
      { href: '/purchasing/reports', label: 'Procurement reports' }, { href: '/purchasing/materials', label: 'Materials' }]),
    ...(f.hr ? g('HR', [{ href: '/hr', label: 'Employees' }, { href: '/attendance', label: 'Attendance' }, { href: '/hr/pay-items', label: 'Pay items' }, { href: '/hr/reports', label: 'HR reports' }]) : []),
    ...g('Projects', [
      ...(f.projects ? [{ href: '/cost-centers', label: 'Cost centers' }, { href: '/design', label: 'Design' }, { href: '/qs', label: 'QS and pricing' }, { href: '/planning', label: 'Planning' },
        { href: '/variations', label: 'Variation orders' }, { href: '/samples', label: 'Samples' }, { href: '/cost-control', label: 'Cost control' }, { href: '/site', label: 'Site execution' }] : []),
      ...(f.tenders ? [{ href: '/tenders', label: 'Tenders' }] : [])]),
    // the audit log (Management only) sits under Closing for Finance; a manager without the finance role finds it here
    ...(f.management ? g('Admin', [{ href: '/settings', label: 'Settings' }, ...(f.finance ? [] : [{ href: '/settings/audit', label: 'Audit log' }])]) : []),
    { href: '/account', label: 'My account' },
  ];
}

/** Every link, in menu order. */
export const allLinks = (items: MenuItem[]): MenuLink[] => items.flatMap(i => (isGroup(i) ? i.items : [i]));

// pages reached from a menu page but living under another address: they light up (and open) that page's category
const ALSO: [string, string][] = [['/parties', '/vendors']];

/** The menu link for the page at `path`: the most specific match, so Collections follow-up lights up and not also Collections. */
export function activeHref(items: MenuItem[], path: string): string | undefined {
  const links = allLinks(items);
  const match = (href: string, p: string) => (href === '/' ? p === '/' : p === href || p.startsWith(href + '/'));
  const best = links.filter(i => match(i.href, path)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  if (best) return best;
  return ALSO.find(([from, to]) => match(from, path) && links.some(l => l.href === to))?.[1];
}

/** The category holding the page you are on, which opens by itself. */
export function openGroupFor(items: MenuItem[], href: string | undefined): string | null {
  if (!href) return null;
  return items.find((i): i is MenuGroup => isGroup(i) && i.items.some(l => l.href === href))?.group ?? null;
}
