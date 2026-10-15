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
export type User = { id: string; email: string; name: string; roles: Role[]; dept_id?: string | null; dept_name?: string | null;
  /** the menu sub-categories the person may open (update 20); missing on users built in tests: worked out from the roles */
  access?: string[] };

/** Management may do anything; everyone else needs one of the listed roles. */
export const hasRole = (u: Pick<User, 'roles'>, ...roles: Role[]) =>
  u.roles.includes('management') || roles.some(r => u.roles.includes(r));

/** A person's own roles plus what their department's members may do, each once, unknown names dropped. */
export const mergeRoles = (own: readonly string[], dept: readonly string[] | null | undefined): Role[] =>
  [...new Set([...own, ...(dept ?? [])])].filter((r): r is Role => r in ROLES);

/**
 * A login as the pages see it. A person whose sub-categories were set one by one (Settings > People) gets exactly those, and the
 * roles that go with them; anyone else keeps their own ticks plus their department's, as before update 20.
 */
export function resolveUser<T extends { roles: string[]; access?: string[] | null }>(u: T, deptRoles: readonly string[] | null | undefined,
  fromRoles: (r: Role[]) => string[], toRoles: (a: readonly string[]) => Role[]): Omit<T, 'roles' | 'access'> & { roles: Role[]; access: string[] } {
  if (u.access) {
    const roles = mergeRoles([...u.roles.filter(r => r === 'management'), ...toRoles(u.access)], []);
    return { ...u, roles, access: roles.includes('management') ? fromRoles(roles) : [...u.access] };
  }
  const roles = mergeRoles(u.roles, deptRoles);
  return { ...u, roles, access: fromRoles(roles) };
}
