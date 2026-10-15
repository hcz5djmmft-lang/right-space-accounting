// Access per sub-category (update 20, Adel 2026-10-15): a person is given the menu's sub-categories one by one, so a
// designer gets Engineering > Design and not QS and pricing or Cost control. Plain data, no server code: the menu, the
// page guard (requireUser) and the tests share it. Management may open everything.
import type { Role } from './roles';

export type Area = { key: string; label: string; heading: string };
/** What can be given, in menu order, under the menu heading it belongs to. */
export const AREAS: Area[] = [
  { key: 'ap', label: 'AP', heading: 'Finance' },
  { key: 'ar', label: 'AR', heading: 'Finance' },
  { key: 'closing', label: 'Closing', heading: 'Finance' },
  { key: 'books', label: 'Entries, chart of accounts, opening balances, budgets', heading: 'Finance' },
  { key: 'payroll', label: 'Payroll', heading: 'Finance' },
  { key: 'partners', label: 'Partners', heading: 'Partners' },
  { key: 'cost_centers', label: 'Cost centers', heading: 'Engineering' },
  { key: 'tech_office', label: 'Technical Office', heading: 'Engineering' },
  { key: 'design', label: 'Design', heading: 'Engineering' },
  { key: 'site', label: 'Site', heading: 'Engineering' },
  { key: 'procurement', label: 'Procurement', heading: 'Procurement' },
  { key: 'hr', label: 'HR', heading: 'HR' },
];
export type AreaKey = string;
export const AREA_KEYS = AREAS.map(a => a.key);
export const AREA_HEADINGS = [...new Set(AREAS.map(a => a.heading))];
const FINANCE = ['ap', 'ar', 'closing', 'books', 'payroll'];
const ENGINEERING = ['cost_centers', 'tech_office', 'design', 'site'];

/** For a login whose access was never set one by one: what its roles gave before update 20, so nobody loses a page. */
export function accessFromRoles(roles: readonly Role[]): string[] {
  if (roles.includes('management')) return [...AREA_KEYS];
  const out = new Set<string>();
  if (roles.includes('finance')) [...FINANCE, 'partners', 'hr', 'procurement', ...ENGINEERING].forEach(k => out.add(k));
  if (roles.includes('engineering') || roles.includes('projects')) [...ENGINEERING, 'procurement'].forEach(k => out.add(k));
  if (roles.includes('tenders')) out.add('tech_office');
  if (roles.includes('hr')) out.add('hr');
  return AREA_KEYS.filter(k => out.has(k));
}

/** The roles the rest of the app checks, from the sub-categories given: Finance pages need the finance role, and so on. */
export function rolesFromAccess(access: readonly string[]): Role[] {
  const out = new Set<Role>();
  if (access.some(k => FINANCE.includes(k) || k === 'partners')) out.add('finance');
  if (access.some(k => ['cost_centers', 'tech_office', 'site'].includes(k))) { out.add('engineering'); out.add('projects'); }
  if (access.includes('design')) out.add('projects');
  if (access.includes('tech_office')) out.add('tenders');
  if (access.includes('hr')) out.add('hr');
  return [...out];
}

/** Everyone's pages, whatever they were given. */
const EVERYONE = 'everyone';
type Rule = { path: string; areas: string[]; exact?: boolean };
// The most specific rule decides. A document's own page (an id after the list) stays open to anyone, because approvers and
// the person who raised it open it from Approvals; what they may do there is checked by the page and its buttons.
const RULES: Rule[] = [
  { path: '/banks', areas: ['ap'] }, { path: '/petty-cash', areas: ['ap'] }, { path: '/payables', areas: ['ap'] },
  { path: '/vendors', areas: ['ap', 'procurement'] }, { path: '/parties', areas: ['ap', 'ar', 'procurement'] }, { path: '/payments', areas: ['ap'] },
  { path: '/ap-invoices', areas: ['ap'] },
  { path: '/sales-invoices', areas: ['ar'], exact: true }, { path: '/sales-invoices/new', areas: ['ar'] },
  { path: '/collections', areas: ['ar'] }, { path: '/customers', areas: ['ar'] }, { path: '/receipts', areas: ['ar'] },
  { path: '/close', areas: ['closing'] }, { path: '/fixed-assets', areas: ['closing'] }, { path: '/reports', areas: ['closing'] },
  { path: '/bank-reconciliation', areas: ['closing'] },
  { path: '/entries', areas: ['books'] }, { path: '/accounts', areas: ['books'] }, { path: '/opening-balances', areas: ['books'] }, { path: '/budgets', areas: ['books'] },
  { path: '/payroll', areas: ['payroll'] },
  { path: '/partners', areas: ['partners'] }, { path: '/dashboard', areas: ['partners'] },
  { path: '/cost-centers', areas: ['cost_centers'], exact: true }, { path: '/cost-centers/new', areas: ['cost_centers'] },
  { path: '/cost-centers', areas: [...ENGINEERING] },
  { path: '/qs', areas: ['tech_office'] }, { path: '/planning', areas: ['tech_office'] }, { path: '/cost-control', areas: ['tech_office'] },
  { path: '/variations', areas: ['tech_office'] }, { path: '/tenders', areas: ['tech_office'] },
  { path: '/design', areas: ['design', 'tech_office'] },
  { path: '/samples', areas: ['site'] },
  { path: '/purchasing', areas: ['procurement'], exact: true }, { path: '/purchasing/new', areas: [EVERYONE] },
  { path: '/purchasing/orders', areas: ['procurement'] }, { path: '/purchasing/plan', areas: ['procurement'] }, { path: '/purchasing/vendors', areas: ['procurement'] },
  { path: '/purchasing/work-orders', areas: ['procurement'] }, { path: '/purchasing/stock', areas: ['procurement'] }, { path: '/purchasing/reports', areas: ['procurement'] },
  { path: '/purchasing/materials', areas: ['procurement'] }, { path: '/claims', areas: ['procurement'], exact: true }, { path: '/claims/new', areas: ['procurement'] },
  { path: '/hr', areas: ['hr'] }, { path: '/attendance', areas: ['hr'] },
];
const DOC_ID = /^\/[a-z-]+\/[^/]+$/; // /entries/abc: a document's own page

/** Whether a person with these sub-categories may open the page at `path`. */
export function canOpen(path: string, access: readonly string[], management = false): boolean {
  if (management) return true;
  const hits = RULES.filter(r => (r.exact ? path === r.path : path === r.path || path.startsWith(r.path + '/')));
  if (!hits.length) return true;
  const rule = hits.sort((a, b) => b.path.length - a.path.length || Number(!!b.exact) - Number(!!a.exact))[0];
  if (rule.areas.includes(EVERYONE) || rule.areas.some(a => access.includes(a))) return true;
  // the document pages of the lists below stay open to the people who sign or raise them
  const docOpen = ['/payment-requests', '/sales-invoices', '/purchasing', '/claims', '/entries', '/petty-cash', '/design', '/ap-invoices'];
  return DOC_ID.test(path) && !/\/new$/.test(path) && docOpen.some(p => path.startsWith(p + '/'));
}
