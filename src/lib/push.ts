import 'server-only';
import webpush from 'web-push';
import { sql } from './db';
import { mergeRoles, type User } from './roles';
import { appUrl } from './mail';
import { today } from './dates';
import { r2, fmt } from './money';
import { RuleError } from './ledger';

// Phone notifications (improvement 1). A phone that turns notifications on (My account, or the card on Overview) is a
// push subscription; the app pushes when an approval, a task or a claim starts waiting for the person, and every
// morning at 08:00 Cairo it sends the partners a summary. The signing keys are made on first use and kept in the
// database, so nothing has to be set in the hosting settings.

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

let keys: { publicKey: string; privateKey: string } | null = null;
/** The app's push keys, made once and kept in push_keys. */
export async function pushKeys() {
  if (keys) return keys;
  let [k] = await sql<{ public_key: string; private_key: string }[]>`select public_key, private_key from push_keys where id = 1`;
  if (!k) {
    const made = webpush.generateVAPIDKeys();
    await sql`insert into push_keys (id, public_key, private_key) values (1, ${made.publicKey}, ${made.privateKey}) on conflict (id) do nothing`;
    [k] = await sql<{ public_key: string; private_key: string }[]>`select public_key, private_key from push_keys where id = 1`;
  }
  keys = { publicKey: k.public_key, privateKey: k.private_key };
  return keys;
}

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Saves a phone's subscription for the person. For a new phone, what already waits counts as told, so it is not flooded. */
export async function subscribe(user: User, sub: Subscription, device = '') {
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) throw new RuleError('This phone did not give a usable subscription.');
  const [row] = await sql<{ fresh: boolean }[]>`insert into push_subscriptions (endpoint, user_id, p256dh, auth, device) values (${sub.endpoint}, ${user.id}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${device.slice(0, 200)})
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device
    returning (xmax = 0) fresh`;
  // a phone already known (the page checks in on every open) keeps what it was told; only a new one starts from today
  if (!row.fresh) return;
  const items = await waitingItems(user);
  for (const i of items) await sql`insert into push_sent (user_id, key) values (${user.id}, ${i.key}) on conflict do nothing`;
}
export async function unsubscribe(user: User, endpoint: string) {
  await sql`delete from push_subscriptions where endpoint = ${endpoint} and user_id = ${user.id}`;
}
export const subscriptionCount = async (userId: string) => (await sql<{ n: number }[]>`select count(*)::int n from push_subscriptions where user_id = ${userId}`)[0].n;

/** Pushes one message to every phone of the given people; a phone that has gone away is forgotten. Returns how many phones got it. */
export async function pushTo(userIds: string[], m: PushMessage) {
  if (!userIds.length) return 0;
  const subs = await sql<{ endpoint: string; p256dh: string; auth: string }[]>`select endpoint, p256dh, auth from push_subscriptions where user_id = any(${userIds})`;
  if (!subs.length) return 0;
  const k = await pushKeys();
  const payload = JSON.stringify({ title: m.title, body: m.body, url: m.url ?? '/', tag: m.tag });
  let ok = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        TTL: 24 * 3600, urgency: 'normal', timeout: 10_000,
        vapidDetails: { subject: appUrl('/'), publicKey: k.publicKey, privateKey: k.privateKey },
      });
      ok++;
      await sql`update push_subscriptions set last_ok_at = now() where endpoint = ${s.endpoint}`;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sql`delete from push_subscriptions where endpoint = ${s.endpoint}`;
      else console.error('push failed', code ?? e);
    }
  }));
  return ok;
}

/** A person as the pages see them (their roles merged with their department's). */
export async function userById(id: string): Promise<User | null> {
  const [u] = await sql<(User & { dept_roles: string[] | null })[]>`
    select u.id, u.email, u.name, u.roles, u.dept_id, d.name dept_name, d.roles || coalesce(p.roles, '{}') dept_roles
    from users u left join departments d on d.id = u.dept_id and d.active left join departments p on p.id = d.parent_id and p.active
    where u.id = ${id} and u.active`;
  if (!u) return null;
  const { dept_roles, ...user } = u;
  return { ...user, roles: mergeRoles(u.roles, dept_roles) };
}

// the daily site report and the weekly progress are left out: they would ring at midnight; they still show under Tasks
const QUIET_KINDS = new Set(['site', 'progress']);
export type WaitingItem = { key: string; title: string; href: string; kind: string };
/** Everything waiting for the person that is worth a push: their pending steps (approvals, claims, forms, drawings…) and open tasks given to them. */
export async function waitingItems(user: User): Promise<WaitingItem[]> {
  const { pendingSteps } = await import('./pending');
  const [steps, tasks] = await Promise.all([
    pendingSteps(user),
    sql<{ id: string; title: string }[]>`select t.id, t.title from tasks t where t.status <> 'done'
      and (t.assignee_id = ${user.id} or exists (select 1 from employees e where e.id = t.assignee_emp_id and e.user_id = ${user.id}))`,
  ]);
  return [
    ...steps.filter(s => !QUIET_KINDS.has(s.kind)).map(s => ({ key: `${s.kind}|${s.href}|${s.title}`, title: s.title, href: s.href, kind: s.kind })),
    ...tasks.map(t => ({ key: `task|${t.id}`, title: t.title, href: `/tasks/${t.id}`, kind: 'task' })),
  ];
}

const KIND_TITLE: Record<string, string> = { approval: 'Waiting for your approval', task: 'New task for you', claim: 'Progress claim waiting for you' };
export const titleFor = (kind: string) => KIND_TITLE[kind] ?? 'Waiting for you';

/** Pushes, to each person with a phone turned on, what has started waiting for them since the last check. */
export async function notifyPending(opts: { force?: boolean } = {}) {
  // at most one check every 20 seconds across all servers
  const [run] = await sql`insert into push_runs (name, at) values ('pending', now()) on conflict (name) do update set at = now()
    where push_runs.at < now() - interval '20 seconds' or ${!!opts.force} returning name`;
  if (!run) return 0;
  const people = await sql<{ user_id: string }[]>`select distinct user_id from push_subscriptions`;
  let sent = 0;
  for (const { user_id } of people) {
    const user = await userById(user_id);
    if (!user) continue;
    const items = await waitingItems(user);
    const told = new Set((await sql<{ key: string }[]>`select key from push_sent where user_id = ${user_id}`).map(r => r.key));
    const fresh = items.filter(i => !told.has(i.key));
    // what no longer waits is forgotten, so it rings again if it ever comes back (a request returned and resubmitted)
    const keys = items.map(i => i.key);
    await sql`delete from push_sent where user_id = ${user_id} and not (key = any(${keys}))`;
    if (!fresh.length) continue;
    for (const i of fresh) await sql`insert into push_sent (user_id, key) values (${user_id}, ${i.key}) on conflict do nothing`;
    if (fresh.length <= 3) for (const i of fresh) sent += await pushTo([user_id], { title: titleFor(i.kind), body: i.title, url: i.href, tag: i.key.slice(0, 60) });
    else sent += await pushTo([user_id], { title: `${fresh.length} new items wait for you`, body: fresh.slice(0, 3).map(i => i.title).join(' · ') + ' …', url: '/tasks' });
  }
  return sent;
}

/** The partners who get the morning summary: each partner's login (Partners page); none linked, Management. */
export async function summaryPeople() {
  const linked = await sql<{ id: string }[]>`select distinct u.id from partners p join users u on u.id = p.user_id and u.active where p.active`;
  if (linked.length) return linked.map(r => r.id);
  return (await sql<{ id: string }[]>`select id from users where active and 'management' = any(roles)`).map(r => r.id);
}

export type Summary = { bank: number; cash: number; dueWeek: number; dueCount: number; overdue: number; overdueCount: number; approvals: number; waitingAll: number };
const plusDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** The figures of the morning summary: cash in bank and petty cash, collections due this week and overdue, approvals pending. */
export async function summaryFigures(user: User, now = today()): Promise<Summary> {
  const { waitingForUser } = await import('./documents');
  const [[cash], [due], mine, [all]] = await Promise.all([
    sql<{ bank: number; cash: number }[]>`
      select coalesce(sum(case when coalesce(b.kind, 'bank') = 'bank' then l.dr - l.cr end), 0) bank, coalesce(sum(case when b.kind = 'cash' then l.dr - l.cr end), 0) cash
      from accounts a left join bank_accounts b on b.account = a.code
      join journal_lines l on l.account = a.code join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where a.is_bank and a.type = 'asset'`,
    sql<{ week: number; nweek: number; overdue: number; nover: number }[]>`
      with o as (select i.due_date, i.total - invoice_paid(i.id) open from invoices i where i.kind = 'sales' and i.status = 'posted')
      select coalesce(sum(open) filter (where due_date >= ${now}::date and due_date <= ${plusDays(now, 7)}::date), 0) week,
        count(*) filter (where due_date >= ${now}::date and due_date <= ${plusDays(now, 7)}::date)::int nweek,
        coalesce(sum(open) filter (where due_date < ${now}::date), 0) overdue, count(*) filter (where due_date < ${now}::date)::int nover
      from o where open > 0.004`,
    waitingForUser(user),
    sql<{ n: number }[]>`select (select count(*) from invoices where kind = 'purchase' and status = 'pending')
      + (select count(*) from purchase_requests where status in ('procurement', 'head', 'management'))
      + (select count(*) from journal_entries where status = 'pending') + (select count(*) from leave_requests where status in ('head', 'hr'))
      + (select count(*) from sub_claims where status in ('pricing', 'finance')) n`,
  ]);
  return { bank: r2(cash.bank), cash: r2(cash.cash), dueWeek: r2(due.week), dueCount: due.nweek, overdue: r2(due.overdue), overdueCount: due.nover, approvals: mine.length, waitingAll: Number(all.n) };
}

export const summaryText = (s: Summary) =>
  `Cash: bank ${fmt(s.bank)} · petty cash ${fmt(s.cash)}. ` +
  `Collections due this week: ${fmt(s.dueWeek)} (${s.dueCount} invoice${s.dueCount === 1 ? '' : 's'})` +
  (s.overdueCount ? `, overdue ${fmt(s.overdue)} (${s.overdueCount}).` : '.') +
  ` Approvals waiting for you: ${s.approvals}${s.waitingAll !== s.approvals ? ` (${s.waitingAll} in the system)` : ''}.`;

/** Sends the morning summary once a day, at 08:00 Cairo or later (the scheduler calls at 05:00 and 06:00 UTC to cover summer and winter time). */
export async function morningSummary(now = new Date(), opts: { force?: boolean } = {}) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: process.env.APP_TZ || 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 8 && !opts.force) return { sent: 0, skipped: 'before 08:00 Cairo' };
  const day = today(now);
  const [run] = await sql`insert into push_runs (name) values (${'morning:' + day}) on conflict do nothing returning name`;
  if (!run && !opts.force) return { sent: 0, skipped: 'already sent today' };
  let sent = 0;
  for (const id of await summaryPeople()) {
    const user = await userById(id);
    if (!user) continue;
    const s = await summaryFigures(user, day);
    sent += await pushTo([id], { title: `Good morning · ${day}`, body: summaryText(s), url: '/', tag: 'morning' });
  }
  return { sent };
}
