// Settings > People > Delete (update 20 fix): a login with no records goes for good; one with records, or one a
// document waits on, is stopped instead so the books keep who did what.
import { afterAll, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
let admin = { id: '', name: 'Delete Admin', email: 'deladmin@x.test', roles: ['management'] };
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error('REDIRECT'), { to }); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: () => {}, get: () => undefined }) }));
vi.mock('@/lib/auth', () => ({ requireUser: async () => admin, hashPassword: async () => 'x' }));
const { sql } = await import('@/lib/db');
const { deleteUser } = await import('@/app/(app)/settings/actions');

const run = (id: string) => deleteUser(id).then(() => '', (e: { to?: string }) => decodeURIComponent(e.to ?? String(e)));
const make = async (email: string) => (await sql`insert into users (email, name, password_hash, roles) values (${email}, ${email}, 'x', '{finance}') returning id`)[0].id as string;

afterAll(async () => { await sql.end(); });

describe('deleting a login', () => {
  it('deletes a fresh login, stops one with records or a waiting document, and never your own', async () => {
    await sql`delete from users where email like 'del-%@x.test' or email = 'deladmin@x.test'`;
    admin = { ...admin, id: await make('deladmin@x.test') };
    const fresh = await make('del-fresh@x.test'), busy = await make('del-busy@x.test'), head = await make('del-head@x.test');
    await sql`insert into tasks (title, created_by, assignee_id, status) values ('t', ${busy}, ${busy}, 'todo')`;
    await sql`insert into user_positions (user_id, position) values (${fresh}, 'accountant')`;
    const [inv] = await sql`select id from invoices limit 1`;
    if (inv) await sql`update invoices set approver_id = ${head} where id = ${inv.id}`;

    expect(await run(fresh)).toMatch(/saved=.*login is deleted/);
    expect(await sql`select 1 from users where id = ${fresh}`).toHaveLength(0);
    expect(await run(busy)).toMatch(/saved=.*kept for them and stopped/);
    expect((await sql`select active from users where id = ${busy}`)[0].active).toBe(false);
    if (inv) {
      expect(await run(head)).toMatch(/stopped/);
      expect((await sql`select active from users where id = ${head}`)[0].active).toBe(false);
      await sql`update invoices set approver_id = null where id = ${inv.id}`;
    }
    expect(await run(admin.id)).toMatch(/error=.*own login/);
  });
});
