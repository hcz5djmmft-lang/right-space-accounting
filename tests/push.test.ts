// Phone notifications (improvement 1) against the test database; the push service itself is replaced by a recorder.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
let gone = new Set<string>();
vi.mock('web-push', () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: 'PUB', privateKey: 'PRIV' }),
    sendNotification: async (s: { endpoint: string }, payload: string) => {
      if (gone.has(s.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
    },
  },
}));

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const push = await import('@/lib/push');
const tasks = await import('@/lib/tasks');
const docs = await import('@/lib/documents');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: string[] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
const mgt: U = { id: '', email: 'adel@x.test', name: 'Adel Maksoud', roles: ['management'] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Ziad Finance', roles: ['finance'] };
const sub = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'k' + n, auth: 'a' + n } });

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, tasks, push_keys, push_runs cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [eng, mgt, fin]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
  await sql`update departments set head_user_id = ${eng.id} where id = 'eng'`;
  await sql`update approval_steps set user_ids = '{}'`;
  await sql`insert into accounts (code, name, type, parent, postable, is_system) values ('Q113', 'Current account – Youssef', 'equity', 'Q100', true, true)`;
  await sql`insert into partners (id, name, share, account, sort) values ('youssef', 'Youssef', 25, 'Q113', 3)`;
});
afterAll(async () => { await sql.end(); });

describe('phone notifications', () => {
  it('makes the push keys once and keeps them', async () => {
    expect(await push.pushKeys()).toEqual({ publicKey: 'PUB', privateKey: 'PRIV' });
    expect((await sql`select count(*)::int n from push_keys`)[0].n).toBe(1);
  });
  it('a new phone does not get what already waited; a task given afterwards rings once', async () => {
    await tasks.saveTask(mgt as never, { title: 'Old task', details: '', status: 'todo', priority: 'normal', assignee_id: eng.id });
    await push.subscribe(eng as never, sub('eng'), 'iPhone');
    expect(await push.subscriptionCount(eng.id)).toBe(1);
    sent.length = 0;
    await push.notifyPending({ force: true });
    expect(sent).toEqual([]);
    const id = await tasks.saveTask(mgt as never, { title: 'Check PH-B1302 ceiling', details: '', status: 'todo', priority: 'high', assignee_id: eng.id });
    await push.notifyPending({ force: true });
    expect(sent).toEqual([{ endpoint: 'https://push.example/eng', payload: { title: 'New task for you', body: 'Check PH-B1302 ceiling', url: `/tasks/${id}`, tag: `task|${id}` } }]);
    await push.notifyPending({ force: true });
    expect(sent).toHaveLength(1);
    // the same phone checking in again does not reset what it was told
    await push.subscribe(eng as never, sub('eng'), 'iPhone');
    await tasks.saveTask(mgt as never, { title: 'Second', details: '', status: 'todo', priority: 'normal', assignee_id: eng.id });
    await push.notifyPending({ force: true });
    expect(sent.map(s => s.payload.body)).toEqual(['Check PH-B1302 ceiling', 'Second']);
  });
  it('an approval waiting for the head rings on their phone', async () => {
    sent.length = 0;
    await docs.savePaymentRequest(fin as never, { date: '2026-10-12', party: 'vc0003', project: 'ph-b1302', ref: 'X', vatRate: 14, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0,
      lines: [{ acc: '25001-1', desc: 'Kitchen', qty: 1, price: 1000 }] }, true);
    await push.notifyPending({ force: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: 'Waiting for your approval' });
    expect(sent[0].payload.body).toMatch(/^Approve Payment request · Engineering head C-/);
  });
  it('the check runs at most every 20 seconds unless forced', async () => {
    await sql`update push_runs set at = now() where name = 'pending'`;
    await tasks.saveTask(mgt as never, { title: 'Third', details: '', status: 'todo', priority: 'normal', assignee_id: eng.id });
    sent.length = 0;
    await push.notifyPending();
    expect(sent).toEqual([]);
    await sql`update push_runs set at = now() - interval '1 minute' where name = 'pending'`;
    await push.notifyPending();
    expect(sent.map(s => s.payload.body)).toEqual(['Third']);
  });
  it('a phone that has gone away is forgotten', async () => {
    gone = new Set(['https://push.example/eng']);
    expect(await push.pushTo([eng.id], { title: 't', body: 'b' })).toBe(0);
    expect(await push.subscriptionCount(eng.id)).toBe(0);
    gone = new Set();
  });
  it('morning summary: from 08:00 Cairo, once a day, to the partners linked (else Management)', async () => {
    await push.subscribe(mgt as never, sub('adel'));
    sent.length = 0;
    // 04:30 UTC = 07:30 Cairo (summer time): too early
    expect(await push.morningSummary(new Date('2026-10-14T04:30:00Z'))).toMatchObject({ sent: 0 });
    const r = await push.morningSummary(new Date('2026-10-14T05:00:00Z'));
    expect(r).toEqual({ sent: 1 });
    expect(sent[0].payload.title).toBe('Good morning · 2026-10-14');
    expect(sent[0].payload.body).toMatch(/^Cash: bank [\d,.-]+ · petty cash [\d,.-]+\. Collections due this week: [\d,.]+ \(\d+ invoices?\).* Approvals waiting for you: \d+/);
    expect(await push.morningSummary(new Date('2026-10-14T06:00:00Z'))).toMatchObject({ sent: 0, skipped: 'already sent today' });
    // a partner linked to a login: only that login gets it
    await sql`update partners set user_id = ${fin.id} where id = 'youssef'`;
    expect(await push.summaryPeople()).toEqual([fin.id]);
  });
});
