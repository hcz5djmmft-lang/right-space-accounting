import type { AccountType } from './ledger';

export type ChartRow = {
  code: string; name: string; type: AccountType; parent: string | null; postable: boolean; is_bank: boolean; is_system: boolean;
  budget: number | null; cost_type: string | null; project: string | null; dr: number; cr: number;
};

const PROJECT_CODE = /^(2\d{4})-(\d+)$/;
export const isProjectCode = (code: string) => PROJECT_CODE.test(code);
/** 21001-3 → 21001; any other code stays as it is. */
export const baseCode = (code: string) => PROJECT_CODE.exec(code)?.[1] ?? code;

/**
 * One line per GL code: a project code's copies (21001-1, 21001-2, …) fold into 21001 with the total of every project,
 * under one "Project costs" heading; the office codes already carry every department. A code that was given different
 * names on different projects keeps one line per name, so nothing is added up under the wrong name.
 */
export function groupProjectCodes(rows: ChartRow[]): ChartRow[] {
  const out: ChartRow[] = [];
  const groups = new Map<string, ChartRow & { suffix: number }>();
  let hasProjects = false;
  for (const r of rows) {
    const m = PROJECT_CODE.exec(r.code);
    if (!m) { out.push(r); continue; }
    hasProjects = true;
    if (!r.postable) continue; // the per-project headings (20000-N) become the one heading below
    const key = m[1] + '|' + r.name, suffix = Number(m[2]);
    const g = groups.get(key);
    if (!g) { groups.set(key, { ...r, code: m[1], parent: '20000', project: null, suffix }); continue; }
    g.dr += r.dr; g.cr += r.cr;
    g.budget = g.budget === null && r.budget === null ? null : (g.budget ?? 0) + (r.budget ?? 0);
    if (suffix < g.suffix) { g.cost_type = r.cost_type; g.suffix = suffix; }
  }
  if (hasProjects) out.push({ code: '20000', name: 'Project costs · all projects', type: 'expense', parent: null, postable: false, is_bank: false, is_system: false, budget: null, cost_type: null, project: null, dr: 0, cr: 0 });
  for (const g of [...groups.values()].sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name))) {
    const { suffix: _s, ...row } = g;
    out.push(row);
  }
  return out;
}
