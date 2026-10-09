export const ROLES = {
  management: 'Management',
  finance: 'Finance',
  engineering: 'Engineering',
  projects: 'Projects (manager / designer)',
  tenders: 'Tenders',
} as const;
export type Role = keyof typeof ROLES;

export type User = { id: string; email: string; name: string; roles: Role[] };

/** Management may do anything; everyone else needs one of the listed roles. */
export const hasRole = (u: Pick<User, 'roles'>, ...roles: Role[]) =>
  u.roles.includes('management') || roles.some(r => u.roles.includes(r));
