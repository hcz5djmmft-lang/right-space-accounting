// The org chart's positions (Adel's chart of 2026-10-13), without a database: who signs what in the engineering workflows.
// A person can hold several positions; `single` positions have one holder, the others any number.

export type Position = { key: string; label: string; group: string; single?: boolean };
export const POSITIONS: Position[] = [
  { key: 'board', label: 'Board member (partner)', group: 'Board' },
  { key: 'eng_director', label: 'Director of engineering', group: 'Engineering', single: true },
  { key: 'design_head', label: 'Head of design', group: 'Engineering · Technical Office', single: true },
  { key: 'designer', label: 'Designer', group: 'Engineering · Technical Office' },
  { key: 'to_head', label: 'Technical office head', group: 'Engineering · Technical Office', single: true },
  { key: 'planning', label: 'Planning engineer', group: 'Engineering · Technical Office' },
  { key: 'qs', label: 'Quantity surveying & progress claims', group: 'Engineering · Technical Office' },
  { key: 'pricing', label: 'Pricing & budgeting', group: 'Engineering · Technical Office' },
  { key: 'cost_control', label: 'Cost control', group: 'Engineering · Technical Office' },
  { key: 'site_head', label: 'Head of site execution', group: 'Engineering · Site execution', single: true },
  { key: 'site_eng', label: 'Site engineer', group: 'Engineering · Site execution' },
  { key: 'procurement_head', label: 'Head of procurement (supply chain)', group: 'Supply chain', single: true },
  { key: 'procurement', label: 'Procurement engineer', group: 'Supply chain' },
  { key: 'hr_head', label: 'Head of Admin & HR', group: 'Admin & HR', single: true },
  { key: 'finance_head', label: 'Head of Finance', group: 'Finance & accounts', single: true },
  { key: 'accountant', label: 'Accountant', group: 'Finance & accounts' },
];
export const positionOf = (key: string) => POSITIONS.find(p => p.key === key);
export const GROUPS = [...new Set(POSITIONS.map(p => p.group))];
