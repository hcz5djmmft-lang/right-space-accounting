import 'server-only';
import { sql, type Tx } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { POSITIONS, positionOf } from './org-chart';

// Who holds which org-chart position (Settings > Org chart), and the department tree (Engineering and its two sections).

export type Holder = { id: string; name: string };
/** Every position with its holders (active logins only). */
export async function positionHolders(): Promise<Record<string, Holder[]>> {
  const rows = await sql<{ position: string; id: string; name: string }[]>`
    select p.position, u.id, u.name from user_positions p join users u on u.id = p.user_id where u.active order by u.name`;
  const out: Record<string, Holder[]> = Object.fromEntries(POSITIONS.map(p => [p.key, []]));
  for (const r of rows) out[r.position]?.push({ id: r.id, name: r.name });
  return out;
}
/** Active user ids holding a position. */
export async function holdersOf(position: string, tx: Tx = sql): Promise<string[]> {
  return (await tx<{ id: string }[]>`select u.id from user_positions p join users u on u.id = p.user_id where p.position = ${position} and u.active order by u.name`).map(r => r.id);
}
export const hasPosition = async (userId: string, position: string, tx: Tx = sql) => (await holdersOf(position, tx)).includes(userId);
/** A person's positions, for their own pages. */
export const positionsOf = async (userId: string) => (await sql<{ position: string }[]>`select position from user_positions where user_id = ${userId}`).map(r => r.position).filter(positionOf);

/** Management sets every position at once: a single-holder position takes one person, the others any number. */
export async function savePositions(user: User, picks: Record<string, string[]>) {
  if (!hasRole(user, 'management')) throw new RuleError('Only Management changes the org chart.');
  await sql.begin(async tx => {
    const users = new Set((await tx<{ id: string }[]>`select id from users where active`).map(u => u.id));
    for (const p of POSITIONS) {
      const ids = [...new Set((picks[p.key] ?? []).filter(id => users.has(id)))];
      if (p.single && ids.length > 1) throw new RuleError(`${p.label}: one person only.`);
      await tx`delete from user_positions where position = ${p.key}`;
      for (const id of ids) await tx`insert into user_positions (user_id, position) values (${id}, ${p.key})`;
    }
    await audit(tx, user, 'settings', 'positions', 'Changed the org chart', POSITIONS.map(p => `${p.key}: ${(picks[p.key] ?? []).length}`).join(', '));
  });
}

export type DeptNode = { id: string; code: string; name: string; parent_id: string | null; parent_name: string | null; head_user_id: string | null; active: boolean; label: string };
/** Departments with their parent, labelled "Engineering › Technical Office" for the pickers. */
export async function listDepartmentTree(): Promise<DeptNode[]> {
  const rows = await sql<Omit<DeptNode, 'label'>[]>`
    select d.id, d.code, d.name, d.parent_id, p.name parent_name, d.head_user_id, d.active
    from departments d left join departments p on p.id = d.parent_id order by coalesce(p.code, d.code), d.parent_id nulls first, d.code`;
  return rows.map(d => ({ ...d, label: d.parent_name ? `${d.parent_name} › ${d.name}` : d.name }));
}
