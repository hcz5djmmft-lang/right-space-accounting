export const ROLES = {
  management: 'Management',
  finance: 'Finance',
  engineering: 'Engineering',
  projects: 'Projects (manager / designer)',
  tenders: 'Tenders',
  hr: 'HR (employee files, attendance, leave)',
} as const;
export type Role = keyof typeof ROLES;

/** `roles` is what the person may do: their own ticks plus their department's (see mergeRoles). */
export type User = { id: string; email: string; name: string; roles: Role[]; dept_id?: string | null; dept_name?: string | null };

/** Management may do anything; everyone else needs one of the listed roles. */
export const hasRole = (u: Pick<User, 'roles'>, ...roles: Role[]) =>
  u.roles.includes('management') || roles.some(r => u.roles.includes(r));

/** A person's own roles plus what their department's members may do, each once, unknown names dropped. */
export const mergeRoles = (own: readonly string[], dept: readonly string[] | null | undefined): Role[] =>
  [...new Set([...own, ...(dept ?? [])])].filter((r): r is Role => r in ROLES);
