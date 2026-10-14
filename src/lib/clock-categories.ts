// What a clock-in is for (Adel, 2026-10-14). The list is data: a new category is one more line here, nothing else changes.
//   project  the category is work on one project, picked at the clock-in or when switching during the day
//   rule     how the phone's position is checked: 'office' against the office location in HR's attendance settings,
//            'site' against the project's own location pin (set on the project page); no office or pin set means recorded only
//   phrase   the words after "Clocked in" on the phone; {project} is the project code
//   depts    department names the category is offered to, roles whose holders get it too (Management always does), siteStaff for
//            employees whose file says Works at: Site; with none of the three, everyone gets it
import { hasRole, type Role } from './roles';

export type Category = { key: string; label: string; short: string; project: boolean; rule: 'office' | 'site'; phrase: string; depts?: string[]; roles?: Role[]; siteStaff?: boolean };

const ENG = { depts: ['Engineering'], roles: ['engineering', 'projects'] as Role[] };
const FIN = { depts: ['Finance'], roles: ['finance'] as Role[] };
export const CATEGORIES: Category[] = [
  { key: 'office', label: 'Office', short: 'Office', project: false, rule: 'office', phrase: '' },
  { key: 'site', label: 'Site on a project', short: 'Site', project: true, rule: 'site', phrase: 'on site {project}', ...ENG, siteStaff: true },
  { key: 'design', label: 'Design on a project', short: 'Design', project: true, rule: 'office', phrase: 'for design on {project}', ...ENG },
  // Finance and accounting (Adel, 2026-10-14): what the accountant's day went on, switched as the work changes
  { key: 'payments', label: 'Payments', short: 'Payments', project: false, rule: 'office', phrase: 'for payments', ...FIN },
  { key: 'collections', label: 'Collections', short: 'Collections', project: false, rule: 'office', phrase: 'for collections', ...FIN },
  { key: 'payroll', label: 'Payroll', short: 'Payroll', project: false, rule: 'office', phrase: 'for payroll', ...FIN },
  { key: 'bank_cash', label: 'Bank and petty cash', short: 'Bank & cash', project: false, rule: 'office', phrase: 'for bank and petty cash', ...FIN },
  { key: 'cost_control', label: 'Cost control', short: 'Cost control', project: false, rule: 'office', phrase: 'for cost control', ...FIN },
  { key: 'reports', label: 'Reports, tax and closing', short: 'Reports & tax', project: false, rule: 'office', phrase: 'for reports, tax and closing', ...FIN },
];

export const categoryOf = (key: string | null | undefined) => CATEGORIES.find(c => c.key === key) ?? null;

/** The categories one person may pick: everyone's, their department's, those of the roles their login holds, and Site for site staff. */
export const offeredCategories = (me: { dept_name: string | null; work_location?: string }, user?: { roles: Role[] }) =>
  CATEGORIES.filter(c => (!c.depts && !c.roles && !c.siteStaff)
    || (me.dept_name !== null && (c.depts ?? []).includes(me.dept_name))
    || (!!user && !!c.roles && hasRole(user, ...c.roles))
    || (!!c.siteStaff && me.work_location === 'site'));

/** "Office", "Site on PH-B1302", "Design on PH-B1302": the category with its project, for lists and pills (a day from before projects were recorded reads "Site"). */
export const whatLabel = (c: Category | null, projectCode: string | null | undefined) => (!c ? '' : c.project && projectCode ? `${c.short} on ${projectCode}` : c.project ? c.short : c.label);

/** The words after "Clocked in" / "Clocked out" on the phone. */
export const whatPhrase = (c: Category, projectCode: string | null | undefined) => (projectCode ? c.phrase.replace('{project}', projectCode) : c.phrase.replace(/ on \{project\}| \{project\}/, ''));

export type Pick = { category: string; projectId: string | null; note?: string };

/** What the phone preselects: what the person did last time, else Site on their project for site staff, else Office. */
export function defaultPick(me: { work_location: string; project_id: string | null }, last: { category: string; project_id: string | null } | null): Pick {
  if (last && categoryOf(last.category)) return { category: last.category, projectId: last.project_id };
  return me.work_location === 'site' ? { category: 'site', projectId: me.project_id } : { category: 'office', projectId: null };
}
