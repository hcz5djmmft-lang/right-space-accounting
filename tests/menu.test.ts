import { describe, expect, it } from 'vitest';
import { activeHref, allLinks, buildMenu, isGroup, openGroupFor, openPathFor, type MenuFlags, type MenuItem } from '../src/lib/menu';
import { AREA_KEYS, accessFromRoles, canOpen, rolesFromAccess } from '../src/lib/access';
import { resolveUser } from '../src/lib/roles';
import { tr } from '../src/lib/i18n';

const base: MenuFlags = { access: [], management: false, site: false, approvals: 0, tasks: 0 };
const shape = (items: MenuItem[]): unknown[] => items.map(i => (isGroup(i) ? { [i.group]: shape(i.items) } : i.label));
const groups = (f: Partial<MenuFlags>) => Object.fromEntries(buildMenu({ ...base, ...f }).filter(isGroup).map(g => [g.group, shape(g.items)]));

describe('menu (update 20)', () => {
  it('has Finance as one heading opening AP, AR and Closing, then its five pages', () => {
    const g = groups({ management: true });
    expect(Object.keys(g)).toEqual(['Finance', 'Partners', 'Engineering', 'Procurement', 'HR', 'Admin']);
    expect(g.Finance).toEqual([
      { AP: ['Banks & cash', 'Petty cash', 'Payment requests', 'Invoices', 'Payables', 'Vendors & subcontractors'] },
      { AR: ['Sales invoices', 'Collections', 'Collections follow-up', 'Customers'] },
      { Closing: ['Month-end close', 'Bank reconciliation', 'Fixed assets', 'Reports', 'Audit log'] },
      'Entries', 'Chart of accounts', 'Opening balances', 'Budgets', 'Payroll']);
    expect(g.Partners).toEqual(['Partners', "Partners' dashboard"]);
    expect(g.Admin).toEqual(['Settings']);
  });
  it('renames Projects to Engineering, opening Technical Office, Design and Site', () => {
    expect(groups({ management: true }).Engineering).toEqual(['Cost centers',
      { 'Technical Office': ['QS and pricing', 'Planning', 'Cost control', 'Variation orders', 'Tenders'] },
      { Design: ['Main concept', 'Shop drawings'] },
      { Site: ['Site execution', 'Samples'] }]);
    expect(groups({ management: true }).Procurement).toContain('Purchase orders');
  });
  it('gives everyone the top items and New purchase request, and drops Expenses', () => {
    const m = buildMenu({ ...base, approvals: 2, tasks: 3 });
    expect(m.map(i => (isGroup(i) ? i.group : i.label))).toEqual(['Overview', 'Clock in', 'Leave', 'Approvals', 'Tasks', 'New purchase request', 'My account']);
    expect(allLinks(m).find(l => l.href === '/approvals')?.badge).toBe(2);
    expect(allLinks(buildMenu({ ...base, management: true })).some(l => l.href === '/expenses')).toBe(false);
  });
  it('shows a designer Design only', () => {
    const g = groups({ access: ['design'] });
    expect(g).toEqual({ Engineering: [{ Design: ['Main concept', 'Shop drawings'] }] });
    expect(groups({ access: ['ar'] })).toEqual({ Finance: [{ AR: ['Sales invoices', 'Collections', 'Collections follow-up', 'Customers'] }] });
  });
  it('opens the headings holding the page you are on', () => {
    const m = buildMenu({ ...base, management: true });
    expect(openPathFor(m, activeHref(m, '/collections/follow-up'))).toEqual(['Finance', 'Finance/AR']);
    expect(openPathFor(m, activeHref(m, '/entries/abc'))).toEqual(['Finance']);
    expect(openPathFor(m, activeHref(m, '/qs/x'))).toEqual(['Engineering', 'Engineering/Technical Office']);
    expect(openGroupFor(m, activeHref(m, '/vendors/abc'))).toBe('Finance');
    expect(openPathFor(m, activeHref(m, '/parties/abc'))).toEqual(['Finance', 'Finance/AP']);
    expect(openPathFor(m, activeHref(m, '/design/abc'))).toEqual(['Engineering', 'Engineering/Design']);
    expect(openGroupFor(m, activeHref(m, '/tasks'))).toBeNull();
  });
  it('has Arabic for the new names', () => {
    for (const p of ['Engineering', 'Technical Office', 'Main concept', 'Shop drawings', 'Procurement', 'Purchase orders', 'New purchase request', 'Bank reconciliation', 'Invoices']) expect(tr('ar', p)).not.toBe(p);
  });
});

describe('access per sub-category', () => {
  it('keeps what the old roles gave', () => {
    expect(accessFromRoles(['management'])).toEqual(AREA_KEYS);
    expect(accessFromRoles(['finance'])).toContain('payroll');
    expect(accessFromRoles(['projects'])).toEqual(['cost_centers', 'tech_office', 'design', 'site', 'procurement']);
    expect(accessFromRoles([])).toEqual([]);
  });
  it('gives the roles the pages check', () => {
    expect(rolesFromAccess(['design'])).toEqual(['projects']);
    expect(rolesFromAccess(['ap', 'ar'])).toEqual(['finance']);
    expect(rolesFromAccess(['hr'])).toEqual(['hr']);
  });
  it('keeps a designer out of QS and cost control but lets them open documents sent to them', () => {
    const d = ['design'];
    expect(canOpen('/qs', d)).toBe(false);
    expect(canOpen('/cost-control', d)).toBe(false);
    expect(canOpen('/design/concept', d)).toBe(true);
    expect(canOpen('/cost-centers', d)).toBe(false);
    expect(canOpen('/cost-centers/p1', d)).toBe(true);
    expect(canOpen('/cost-centers/new', d)).toBe(false);
    expect(canOpen('/purchasing/new', d)).toBe(true);
    expect(canOpen('/purchasing', d)).toBe(false);
    expect(canOpen('/purchasing/r1', d)).toBe(true);
    expect(canOpen('/payment-requests/x', d)).toBe(true);
    expect(canOpen('/sales-invoices/x', d)).toBe(true);
    expect(canOpen('/sales-invoices', d)).toBe(false);
    expect(canOpen('/entries', d)).toBe(false);
    expect(canOpen('/tasks', d)).toBe(true);
    expect(canOpen('/qs', d, true)).toBe(true);
  });
  it('a login given sub-categories gets exactly those; one never given any keeps its roles', () => {
    const set = resolveUser({ roles: ['engineering'], access: ['design'] }, ['engineering', 'projects'], accessFromRoles, rolesFromAccess);
    expect(set).toMatchObject({ roles: ['projects'], access: ['design'] });
    const old = resolveUser({ roles: [], access: null }, ['finance'], accessFromRoles, rolesFromAccess);
    expect(old.roles).toEqual(['finance']);
    expect(old.access).toContain('ap');
    const boss = resolveUser({ roles: ['management'], access: [] }, [], accessFromRoles, rolesFromAccess);
    expect(boss.access).toEqual(AREA_KEYS);
  });
});
