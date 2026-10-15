import 'server-only';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { readSpreadsheet } from './xlsx';
import { planStaff, type StaffRow } from './staff-plan';

export { planStaff } from './staff-plan';

/** The rows of the staff sheet (Emp ID, Full Name, Email), whatever the order of its columns. */
export function readStaffSheet(buf: Buffer, name: string): StaffRow[] {
  const rows = readSpreadsheet(buf, name).filter(r => r.some(c => c.trim()));
  if (!rows.length) throw new RuleError('The sheet is empty.');
  const head = rows[0].map(c => c.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex(h => names.includes(h));
  const id = col('emp id', 'employee id', 'id'), nm = col('full name', 'name'), em = col('email', 'e-mail');
  if (nm < 0 || em < 0) throw new RuleError('The sheet needs the columns Full Name and Email (and Emp ID).');
  return rows.slice(1).map(r => ({ empId: (r[id] ?? '').trim(), name: (r[nm] ?? '').trim().replace(/\s+/g, ' '), email: (r[em] ?? '').trim() }))
    .filter(r => r.name && r.email);
}

export type ImportResult = { created: { name: string; email: string; password: string }[]; updated: string[]; skipped: string[] };

/**
 * Creates a login for each person of the staff sheet who has none (and updates the access and department of those who
 * have), with the roles Adel set on 2026-10-15; the department heads and the org chart follow his confirmed hierarchy.
 * The temporary passwords come back once, for Settings to show; they are never stored in plain text.
 */
export async function importStaff(admin: User, rows: StaffRow[]): Promise<ImportResult> {
  if (!hasRole(admin, 'management')) throw new RuleError('Only Management creates logins.');
  const plan = planStaff(rows);
  if (!plan.people.length) throw new RuleError('No one in the sheet matches the staff list (Emp ID RS-1001 onwards, or owner).');
  const result: ImportResult = { created: [], updated: [], skipped: plan.skipped };
  const hashed = await Promise.all(plan.people.map(async () => {
    const password = crypto.randomBytes(6).toString('base64url');
    return { password, hash: await bcrypt.hash(password, 10) };
  }));
  await sql.begin(async tx => {
    const depts = new Map((await tx<{ id: string; code: string }[]>`select id, code from departments where active`).map(d => [d.code, d.id]));
    const ids = new Map<string, string>();
    for (const [k, p] of plan.people.entries()) {
      const dept = depts.get(p.dept) ?? depts.get(p.deptFallback ?? '') ?? null;
      const roles = p.management ? ['management'] : [];
      const [old] = await tx<{ id: string; roles: string[] }[]>`select id, roles from users where lower(email) = lower(${p.email})`;
      let id: string;
      if (old) {
        id = old.id;
        // never take Management away from someone who has it (the person importing above all)
        const keep = old.roles.includes('management') ? ['management'] : roles;
        await tx`update users set access = ${p.access}, roles = ${keep}, dept_id = ${dept}, active = true where id = ${id}`;
        result.updated.push(p.name);
        await audit(tx, admin, 'user', id, 'Changed access from the staff sheet', p.access.join(', ') || 'everything');
      } else {
        [{ id }] = await tx<{ id: string }[]>`insert into users (email, name, password_hash, roles, access, dept_id)
          values (${p.email.toLowerCase()}, ${p.name}, ${hashed[k].hash}, ${roles}, ${p.access}, ${dept}) returning id`;
        result.created.push({ name: p.name, email: p.email.toLowerCase(), password: hashed[k].password });
        await audit(tx, admin, 'user', id, 'Created login from the staff sheet', p.access.join(', ') || 'everything');
      }
      ids.set(p.key, id);
      for (const pos of p.positions) await tx`insert into user_positions (user_id, position) values (${id}, ${pos}) on conflict do nothing`;
      // a single-holder position (director of engineering…) goes to this person alone
      for (const pos of p.singlePositions) {
        await tx`delete from user_positions where position = ${pos}`;
        await tx`insert into user_positions (user_id, position) values (${id}, ${pos})`;
      }
    }
    for (const [code, key] of Object.entries(plan.heads)) {
      const id = ids.get(key), dept = depts.get(code);
      if (id && dept) await tx`update departments set head_user_id = ${id} where id = ${dept}`;
    }
    await audit(tx, admin, 'settings', 'staff', 'Imported the staff sheet', `${result.created.length} created, ${result.updated.length} updated`);
  });
  return result;
}
