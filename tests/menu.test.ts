import { describe, expect, it } from 'vitest';
import { activeHref, allLinks, buildMenu, isGroup, openGroupFor, type MenuFlags } from '../src/lib/menu';
import { tr } from '../src/lib/i18n';

const base: MenuFlags = { finance: false, projects: false, tenders: false, hr: false, management: false, site: false, approvals: 0, tasks: 0 };
const groups = (f: Partial<MenuFlags>) => Object.fromEntries(buildMenu({ ...base, ...f }).filter(isGroup).map(g => [g.group, g.items.map(l => l.label)]));

describe('menu (update 19)', () => {
  it('splits Finance into AP, AR, Partners, Closing and Finance as approved', () => {
    const g = groups({ finance: true, projects: true, hr: true, management: true });
    expect(Object.keys(g)).toEqual(['AP', 'AR', 'Partners', 'Closing', 'Finance', 'Purchasing', 'HR', 'Projects', 'Admin']);
    expect(g.AP).toEqual(['Banks & cash', 'Petty cash', 'Payment requests', 'Payables', 'Vendors & subcontractors']);
    expect(g.AR).toEqual(['Sales invoices', 'Collections', 'Collections follow-up', 'Customers']);
    expect(g.Partners).toEqual(['Partners', "Partners' dashboard"]);
    expect(g.Closing).toEqual(['Month-end close', 'Fixed assets', 'Reports', 'Audit log']);
    expect(g.Finance).toEqual(['Entries', 'Chart of accounts', 'Opening balances', 'Budgets', 'Payroll']);
    expect(g.Admin).toEqual(['Settings']);
    expect(g.Projects[0]).toBe('Cost centers');
  });
  it('keeps Expenses, Approvals and Tasks at the top and drops the old Customers & vendors and Insight', () => {
    const m = buildMenu({ ...base, finance: true, management: true, approvals: 2, tasks: 3 });
    const top = m.filter(i => !isGroup(i)).map(i => !isGroup(i) && i.label);
    expect(top).toEqual(['Overview', 'Clock in', 'Leave', 'Approvals', 'Tasks', 'Expenses', 'My account']);
    expect(allLinks(m).find(l => l.href === '/approvals')?.badge).toBe(2);
    expect(allLinks(m).some(l => l.label === 'Customers & vendors' || l.href === '/parties')).toBe(false);
    expect(m.some(i => isGroup(i) && i.group === 'Insight')).toBe(false);
  });
  it('gives others their Requests group, and the audit log only to Management', () => {
    expect(groups({}).Requests).toEqual(['Payment requests']);
    expect(groups({ finance: true }).Closing).not.toContain('Audit log');
    expect(groups({ management: true }).Admin).toEqual(['Settings', 'Audit log']);
    expect(groups({}).Projects).toBeUndefined();
  });
  it('opens the category holding the page you are on', () => {
    const m = buildMenu({ ...base, finance: true, management: true });
    expect(openGroupFor(m, activeHref(m, '/collections/follow-up'))).toBe('AR');
    expect(activeHref(m, '/collections/follow-up')).toBe('/collections/follow-up');
    expect(openGroupFor(m, activeHref(m, '/vendors/abc'))).toBe('AP');
    expect(openGroupFor(m, activeHref(m, '/customers/abc'))).toBe('AR');
    expect(openGroupFor(m, activeHref(m, '/settings/audit'))).toBe('Closing');
    expect(openGroupFor(m, activeHref(m, '/reports/trial-balance'))).toBe('Closing');
    expect(openGroupFor(m, activeHref(m, '/parties/abc'))).toBe('AP');
    expect(openGroupFor(m, activeHref(m, '/tasks'))).toBeNull();
    expect(openGroupFor(m, activeHref(m, '/'))).toBeNull();
  });
  it('has Arabic for the new names', () => {
    for (const p of ['AP', 'AR', 'Closing', 'Customers', 'Vendors & subcontractors']) expect(tr('ar', p)).not.toBe(p);
  });
});
