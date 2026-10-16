// Who hears of a site clock-in: the people Settings > People shows with HR, including those who get it from their
// department (access left empty on the person), never Management.
import { afterAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const { hrEmails } = await import('@/lib/attendance');
const { hrSettings } = await import('@/lib/attendance-calc');

afterAll(async () => {
  await sql`delete from users where email like 'hrmail-%@x.test'`;
  await sql`delete from departments where code = 'HRT'`;
  await sql.end();
});

describe('site clock-in email recipients', () => {
  it('include HR given by the department, and not Management', async () => {
    await sql`delete from users where email like 'hrmail-%@x.test'`;
    await sql`delete from departments where code = 'HRT'`;
    const [d] = await sql`insert into departments (code, name, roles) values ('HRT', 'HR test', '{hr}') returning id`;
    await sql`insert into users (email, name, password_hash, roles, access, dept_id) values
      ('hrmail-dept@x.test', 'A dept HR', 'x', '{}', null, ${d.id}),
      ('hrmail-ticked@x.test', 'B ticked HR', 'x', '{}', '{hr}', null),
      ('hrmail-boss@x.test', 'C boss', 'x', '{management}', null, ${d.id}),
      ('hrmail-other@x.test', 'D other', 'x', '{}', '{ap}', null)`;
    const to = (await hrEmails(hrSettings({}))).filter(e => e.startsWith('hrmail-'));
    expect(to).toEqual(['hrmail-dept@x.test', 'hrmail-ticked@x.test']);
    expect(await hrEmails(hrSettings({ hr_email: 'hr@x.test' }))).toEqual(['hr@x.test']);
  });
});
