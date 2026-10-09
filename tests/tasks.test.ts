// Tasks against the test database.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const tasks = await import('@/lib/tasks');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
const mgt: U = { id: '', email: 'adel@x.test', name: 'Adel', roles: ['management'] };

beforeAll(async () => {
  await sql`truncate sessions, users, tasks cascade`;
  for (const u of [fin, eng, mgt]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
});
afterAll(async () => { await sql.end(); });

describe('tasks', () => {
  let id = '';
  it('anyone adds a task; the board sorts high priority and earliest due first', async () => {
    id = await tasks.saveTask(eng as never, { title: 'Collect PH-B1302 receipts', details: '', status: 'todo', priority: 'normal', due: '2026-10-20', assignee_id: fin.id, link_type: 'cost-center', link_id: 'ph-b1302', link_label: 'PH-B1302' });
    await tasks.saveTask(fin as never, { title: 'Close September', details: 'TB and bank rec', status: 'doing', priority: 'high', due: '2026-10-15', assignee_id: fin.id });
    await tasks.saveTask(fin as never, { title: 'Low one', details: '', status: 'todo', priority: 'low', assignee_id: null });
    await expect(tasks.saveTask(fin as never, { title: '  ', details: '', status: 'todo', priority: 'low' })).rejects.toThrow(/title/);
    await expect(tasks.saveTask(fin as never, { title: 'x', details: '', status: 'todo', priority: 'low', link_type: 'nope', link_id: '1' })).rejects.toThrow(/Unknown link/);
    expect((await tasks.listTasks()).map(t => t.title)).toEqual(['Close September', 'Collect PH-B1302 receipts', 'Low one']);
    expect((await tasks.listTasks({ mine: fin.id })).map(t => t.title)).toEqual(['Close September', 'Collect PH-B1302 receipts']);
    expect(await tasks.openForUser(fin.id)).toBe(2);
    expect((await tasks.listTasks({ link: { type: 'cost-center', id: 'ph-b1302' } }))[0]).toMatchObject({ id, assignee: 'Fatma Finance', creator: 'Omar Engineer' });
  });
  it('moving to done records when; comments are kept with the author', async () => {
    await tasks.setStatus(fin as never, id, 'done');
    expect((await tasks.getTask(id))).toMatchObject({ status: 'done' });
    expect((await tasks.getTask(id)).done_at).toBeTruthy();
    await tasks.setStatus(fin as never, id, 'review');
    expect((await tasks.getTask(id)).done_at).toBeNull();
    await tasks.addComment(fin as never, id, 'Three receipts still missing');
    await tasks.addComment(fin as never, id, '   ');
    expect(await tasks.listComments(id)).toMatchObject([{ who: 'Fatma Finance', text: 'Three receipts still missing' }]);
    expect((await tasks.getTask(id)).comments).toBe(1);
  });
  it('only the creator, the assignee or Management can delete', async () => {
    const [other] = await tasks.listTasks({ mine: fin.id });
    const lowOne = (await tasks.listTasks()).find(t => t.title === 'Low one')!;
    await expect(tasks.deleteTask(eng as never, lowOne.id)).rejects.toThrow(/Only the person/);
    await tasks.deleteTask(mgt as never, lowOne.id);
    await tasks.deleteTask(eng as never, id); // Omar created it
    await tasks.deleteTask(fin as never, other.id); // Fatma owns it
    expect(await tasks.listTasks()).toHaveLength(0);
  });
});
