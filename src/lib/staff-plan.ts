// Who gets what from the staff sheet (Adel, 2026-10-15): his roles of 08:13 and the hierarchy he confirmed at 07:53.
// Keyed by the sheet's Emp ID, so no address or name of the staff lives in the code; the three partners share the Emp ID
// "owner" and are told apart by the first words of their name, which pick only the department each one heads.
// Pure data, no database: tested in tests/staff.test.ts.

export type StaffRow = { empId: string; name: string; email: string };
export type PlannedLogin = {
  key: string; name: string; email: string; management: boolean; access: string[];
  dept: string; deptFallback?: string; positions: string[]; singlePositions: string[];
};
export type StaffPlan = { people: PlannedLogin[]; heads: Record<string, string>; skipped: string[] };

const FINANCE = ['ap', 'ar', 'closing', 'books', 'payroll'];
const ENGINEERING = ['cost_centers', 'tech_office', 'design', 'site'];
type Rule = { access: string[]; dept: string; deptFallback?: string; positions?: string[]; singlePositions?: string[]; heads?: string[]; management?: boolean };

const DESIGNER: Rule = { access: ['design'], dept: 'ENG', positions: ['designer'] };
/** Hassan and Ali report to Abdullah Fayed in the Technical Office. */
const DESIGNER_TO: Rule = { ...DESIGNER, dept: 'TO', deptFallback: 'ENG' };
const BY_ID: Record<string, Rule> = {
  'RS-1001': { access: FINANCE, dept: 'FIN', positions: ['accountant'] },                       // the accountant: Finance in full
  'RS-1002': { access: ['hr'], dept: 'ADM' },                                                    // HR and Admin; Settings stays with Management
  'RS-1003': DESIGNER, 'RS-1004': DESIGNER, 'RS-1005': DESIGNER,                                 // designers reporting to the Director of Engineering
  'RS-1006': DESIGNER_TO, 'RS-1007': DESIGNER_TO,                                                // designers under Abdullah Fayed
  'RS-1008': { access: [...ENGINEERING, 'procurement'], dept: 'TO', deptFallback: 'ENG', positions: ['qs', 'pricing', 'cost_control', 'procurement'], singlePositions: ['to_head'], heads: ['TO'] },
  'RS-1009': { access: ENGINEERING, dept: 'TO', deptFallback: 'ENG', positions: ['planning'] }, // planning, all Engineering
  'RS-1010': DESIGNER,                                                                           // Ezz, added after the sheet
};
const PARTNER = (heads: string[], singlePositions: string[]): Rule => ({ access: [], management: true, dept: 'MGT', positions: ['board'], singlePositions, heads });
/** The partners: everything, as Management and final approvers; each heads the departments of the hierarchy. */
const OWNERS: [RegExp, Rule][] = [
  [/^h[ae]?itham\b/i, PARTNER(['ADM', 'S&M'], ['hr_head'])],
  [/^marwan\b/i, PARTNER(['PUR'], ['procurement_head'])],
  [/^youssef ali$/i, PARTNER(['ENG'], ['eng_director'])],
];

export function planStaff(rows: StaffRow[]): StaffPlan {
  const people: PlannedLogin[] = [], heads: Record<string, string> = {}, skipped: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.empId.trim().toUpperCase();
    const rule = id === 'OWNER' ? OWNERS.find(([re]) => re.test(r.name.trim()))?.[1] : BY_ID[id];
    const email = r.email.trim().replace(/^mailto:/i, '');
    if (!rule || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email.toLowerCase())) { skipped.push(r.name || r.empId); continue; }
    seen.add(email.toLowerCase());
    const key = `${id}:${email.toLowerCase()}`;
    const name = r.name.trim().split(/\s+/).map(w => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
    people.push({ key, name, email, management: !!rule.management, access: [...rule.access], dept: rule.dept, deptFallback: rule.deptFallback,
      positions: rule.positions ?? [], singlePositions: rule.singlePositions ?? [] });
    for (const h of rule.heads ?? []) heads[h] = key;
  }
  return { people, heads, skipped };
}
