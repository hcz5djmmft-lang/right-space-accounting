// The design phase without a database: the kinds of drawing set, the approval steps and the default drawing lists
// (Adel's own shop drawing list replaces the default one when he sends it).

export const KINDS = [['concept_2d', 'Main Concept 2D'], ['concept_3d', 'Main Concept 3D'], ['shop', 'Shop drawings']] as const;
export type Kind = typeof KINDS[number][0];
export const kindLabel = (k: string) => KINDS.find(x => x[0] === k)?.[1] ?? k;

/** The approval steps in order: the set's status while waiting there, the label, and the org-chart position that signs. */
export const STEPS = [
  { status: 'design_head', label: 'Head of design', position: 'design_head' },
  { status: 'to_head', label: 'Technical office head', position: 'to_head' },
  { status: 'director', label: 'Director of engineering', position: 'eng_director' },
] as const;
export type Step = typeof STEPS[number]['status'];
export const isStep = (s: string): s is Step => STEPS.some(x => x.status === s);
export const stepLabel = (s: string) => STEPS.find(x => x.status === s)?.label ?? '';

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Being prepared', design_head: 'With the head of design', to_head: 'With the technical office head', director: 'With the director of engineering',
  approved: 'Approved', client: 'With the client', client_approved: 'Client approved', ifc: 'Issued for construction', rejected: 'Sent back',
};
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;
/** Statuses where the set is still moving (one such set per kind and project at a time). */
export const OPEN_STATUSES = ['draft', 'design_head', 'to_head', 'director', 'approved', 'client', 'rejected'];
/** The designer may change the drawings while the set is at one of these. */
export const EDITABLE = ['draft', 'rejected'];

/** Default drawings of each kind, prefilled on a new set (number, title). */
export const DEFAULT_DRAWINGS: Record<Kind, readonly (readonly [string, string])[]> = {
  concept_2d: [['C-01', 'Existing and demolition plan'], ['C-02', 'Proposed layout plan'], ['C-03', 'Furniture layout'], ['C-04', 'Flooring plan'], ['C-05', 'Reflected ceiling plan'], ['C-06', 'Wall elevations']],
  concept_3d: [['V-01', '3D views: reception and living'], ['V-02', '3D views: kitchen'], ['V-03', '3D views: master bedroom'], ['V-04', '3D views: bedrooms'], ['V-05', '3D views: bathrooms']],
  shop: [
    ['SD-01', 'Demolition plan'], ['SD-02', 'Proposed layout and setting-out plan'], ['SD-03', 'Flooring plan and details'], ['SD-04', 'Reflected ceiling plan and details'],
    ['SD-05', 'Lighting layout'], ['SD-06', 'Electrical power and data layout'], ['SD-07', 'Plumbing layout'], ['SD-08', 'HVAC layout'],
    ['SD-09', 'Wall elevations'], ['SD-10', 'Wall finishes schedule'], ['SD-11', 'Kitchen details'], ['SD-12', 'Bathroom details'],
    ['SD-13', 'Joinery and furniture details'], ['SD-14', 'Door and window schedule'],
  ],
};

/** Whole days a set has waited at its current step. */
export const daysWaiting = (stepAt: string | Date, now: Date = new Date()) => Math.floor((now.getTime() - new Date(stepAt).getTime()) / 864e5);
