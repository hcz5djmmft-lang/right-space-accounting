import 'server-only';
import { sql } from './db';
import type { User } from './roles';
import { accessFromRoles } from './access';
import { today, TZ } from './dates';
import { fmt, r2 } from './money';
import { bankAccounts, cardFigures } from './banks';
import { openRequests, waitingForUser } from './documents';
import { closeChecklist } from './close';
import { reminders } from './hr-reports';
import { cashView, projectMoney } from './dashboard';
import { phaseLabel } from './projects';

// The home dashboards (update 20, item 1, as proposed to Adel on 2026-10-15): one per department on the Overview tab.
// Each is made of tiles (a figure) and short lists, every line linking to the page where the work is done. Someone in two
// departments switches between theirs at the top; Management sees all seven.

export type DashKey = 'finance' | 'engineering' | 'procurement' | 'hr' | 'admin' | 'sales' | 'management';
export const DASHBOARDS: [DashKey, string][] = [
  ['management', 'Management'], ['finance', 'Finance'], ['engineering', 'Engineering'], ['procurement', 'Procurement'],
  ['hr', 'HR'], ['admin', 'Admin'], ['sales', 'Sales & Marketing'],
];
export type Tile = { label: string; value: string; sub?: string; href?: string; warn?: boolean };
export type Row = { text: string; sub?: string; value?: string; href?: string; warn?: boolean };
export type List = { title: string; href?: string; rows: Row[]; empty: string };
export type Dashboard = { key: DashKey; title: string; tiles: Tile[]; lists: List[] };

const ENGINEERING = ['cost_centers', 'tech_office', 'design', 'site'];
const FINANCE = ['ap', 'ar', 'closing', 'books', 'payroll'];

/** The dashboards a person has, in menu order; the first one is shown unless they pick another. */
export async function dashboardsFor(user: User): Promise<DashKey[]> {
  if (user.roles.includes('management')) return DASHBOARDS.map(d => d[0]);
  const access = user.access ?? accessFromRoles(user.roles);
  const [dept] = user.dept_id ? await sql<{ code: string }[]>`select code from departments where id = ${user.dept_id}` : [];
  const out: DashKey[] = [];
  if (access.some(a => FINANCE.includes(a))) out.push('finance');
  if (access.some(a => ENGINEERING.includes(a))) out.push('engineering');
  if (access.includes('procurement')) out.push('procurement');
  if (access.includes('hr')) out.push('hr', 'admin');
  if (dept?.code === 'S&M' || dept?.code === 'SM') out.push('sales');
  return out;
}

const plus = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const money = (n: number) => fmt(r2(n));

export async function dashboard(key: DashKey, user: User): Promise<Dashboard> {
  const title = DASHBOARDS.find(d => d[0] === key)![1];
  const parts = key === 'finance' ? await finance(user) : key === 'engineering' ? await engineering(user) : key === 'procurement' ? await procurement()
    : key === 'hr' ? await hr() : key === 'admin' ? await admin() : key === 'sales' ? await sales() : await management(user);
  return { key, title, ...parts };
}

async function finance(user: User) {
  const now = today(), week = plus(now, 7);
  const [banks, due, requests, [topups], waiting, close] = await Promise.all([
    bankAccounts(),
    sql<{ id: string; no: string; customer: string; due: string; open: number }[]>`
      select i.id, i.no, p.name customer, to_char(coalesce(i.due_date, i.date),'YYYY-MM-DD') due, (i.total - invoice_paid(i.id))::float open
      from invoices i join parties p on p.id = i.party_id
      where i.kind = 'sales' and i.status = 'posted' and i.total - invoice_paid(i.id) > 0.004 and coalesce(i.due_date, i.date) <= ${week}::date
      order by coalesce(i.due_date, i.date), i.no`,
    openRequests(sql),
    sql<{ n: number; amount: number }[]>`select count(*)::int n, coalesce(sum(amount), 0)::float amount from petty_topups where status = 'pending'`,
    waitingForUser(user),
    closeChecklist(lastMonth(now)).catch(() => null),
  ]);
  const shown = banks.filter(b => !b.hidden);
  const cash = shown.filter(b => b.kind === 'cash'), bank = shown.filter(b => b.kind === 'bank'), card = shown.filter(b => b.kind === 'card');
  const overdue = due.filter(d => d.due < now), thisWeek = due.filter(d => d.due >= now);
  const toPay = requests.filter(r => r.open > 0.004);
  const sum = (rows: { open: number }[]) => rows.reduce((t, r) => t + r.open, 0);
  const tiles: Tile[] = [
    ...cash.map(b => ({ label: `${b.name} (office safe)`, value: money(b.balance), sub: topups.n ? `${topups.n} top-up waiting · ${money(topups.amount)}` : 'petty cash is paid from here', href: '/petty-cash', warn: topups.n > 0 })),
    ...bank.map(b => ({ label: b.name, value: money(b.balance), href: `/banks?account=${b.code}` })),
    ...card.map(b => { const c = cardFigures(b); return { label: `${b.name} available`, value: money(c.available ?? 0), sub: `owed ${money(c.owed)} of ${money(b.credit_limit ?? 0)}`, href: `/banks?account=${b.code}` }; }),
    { label: 'Collections due this week', value: money(sum(thisWeek)), sub: `${thisWeek.length} invoice${thisWeek.length === 1 ? '' : 's'} · overdue ${money(sum(overdue))}`, href: '/collections', warn: overdue.length > 0 },
    { label: 'Approved payment requests to pay', value: money(sum(toPay)), sub: `${toPay.length} to pay`, href: '/payables' },
    { label: 'Approvals waiting for me', value: String(waiting.length), href: '/approvals', warn: waiting.length > 0 },
  ];
  if (close) {
    const done = close.items.filter(i => i.done).length;
    tiles.push({ label: `Month-end close · ${close.name}`, value: `${done} of ${close.items.length}`, sub: close.locked ? 'closed and locked' : close.ready ? 'ready to close' : 'steps still open', href: `/close?m=${close.period}` });
  }
  return {
    tiles,
    lists: [
      { title: 'Collections overdue and due this week', href: '/collections', empty: 'Nothing due this week.',
        rows: due.slice(0, 8).map(d => ({ text: `${d.no} · ${d.customer}`, sub: d.due < now ? `overdue since ${d.due}` : `due ${d.due}`, value: money(d.open), href: `/sales-invoices/${d.id}`, warn: d.due < now })) },
      { title: 'Approved payment requests to pay', href: '/payables', empty: 'Nothing approved is waiting to be paid.',
        rows: toPay.slice(0, 8).map(r => ({ text: r.via ? `${r.no} (on ${r.via})` : r.no, sub: r.date, value: money(r.open), href: `/payment-requests/${r.via_id ?? r.id}` })) },
    ],
  };
}

async function engineering(user: User) {
  const now = today();
  const [projects, inspections, reports, tasks, late, drawings, estimates, onSite] = await Promise.all([
    sql<{ id: string; code: string; name: string; phase: string | null; mine: boolean }[]>`
      select p.id, p.code, p.name, p.phase, exists (select 1 from employees e where e.id in (p.manager_id, p.site_eng_id, p.designer_id) and e.user_id = ${user.id}) mine
      from projects p where not p.is_office and p.status <> 'Closed' and coalesce(p.phase, '') <> 'closed' order by p.code`,
    sql<{ id: string; no: string; code: string; title: string; on_day: string }[]>`
      select r.id, r.no, p.code, r.title, to_char(r.requested_for,'YYYY-MM-DD') on_day from inspection_requests r join projects p on p.id = r.project_id
      where r.status = 'open' and r.requested_for <= ${now}::date order by r.requested_for`,
    sql<{ id: string; code: string }[]>`
      select p.id, p.code from projects p where p.phase = 'execution' and not p.is_office
        and not exists (select 1 from site_reports s where s.project_id = p.id and s.day = ${now}::date and s.status <> 'draft') order by p.code`,
    sql<{ status: string; n: number }[]>`
      select t.status, count(*)::int n from tasks t where t.status in ('todo', 'doing')
        and (t.assignee_id = ${user.id} or exists (select 1 from employees e where e.id = t.assignee_emp_id and e.user_id = ${user.id})) group by t.status`,
    sql<{ id: string; title: string; href: string; due: string | null }[]>`
      select t.id, t.title, '/tasks/' || t.id href, to_char(t.due,'YYYY-MM-DD') due from tasks t
      where t.status <> 'done' and t.priority = 'high' and (t.title like 'Late delivery:%' or t.link_type = 'planning') order by t.due nulls last limit 8`,
    sql<{ id: string; code: string; kind: string; version: number; status: string }[]>`
      select s.id, p.code, s.kind, s.version, s.status from drawing_sets s join projects p on p.id = s.project_id
      where s.status in ('design_head', 'to_head', 'director') order by s.step_at`,
    sql<{ id: string; code: string; rev: number }[]>`select e.id, p.code, e.rev from estimates e join projects p on p.id = e.project_id where e.status = 'sent' order by e.sent_at`,
    sql<{ code: string; who: string }[]>`
      select coalesce(p.code, 'Site') code, e.name who from work_sessions w join employees e on e.id = w.employee_id left join projects p on p.id = w.project_id
      where w.end_at is null and w.category = 'site' order by p.code, e.name`,
  ]);
  const phases = new Map<string, number>();
  for (const p of projects) phases.set(phaseLabel(p.phase) || 'No phase', (phases.get(phaseLabel(p.phase) || 'No phase') ?? 0) + 1);
  const n = (s: string) => tasks.find(t => t.status === s)?.n ?? 0;
  const bySite = new Map<string, string[]>();
  for (const s of onSite) bySite.set(s.code, [...(bySite.get(s.code) ?? []), s.who]);
  return {
    tiles: [
      { label: 'My tasks', value: `${n('todo')} to do · ${n('doing')} in progress`, href: '/tasks?tab=mine' },
      { label: 'Inspections due today', value: String(inspections.length), href: '/site', warn: inspections.length > 0 },
      { label: 'Site reports still due today', value: String(reports.length), href: '/site', warn: reports.length > 0 },
      { label: 'Waiting for approval', value: `${drawings.length} drawing set${drawings.length === 1 ? '' : 's'} · ${estimates.length} estimate${estimates.length === 1 ? '' : 's'}`, href: '/design' },
      { label: 'On site now', value: String(onSite.length), sub: [...bySite.keys()].join(', ') || 'nobody clocked in on a site', href: '/clock' },
    ],
    lists: [
      { title: 'Projects by phase', href: '/cost-centers', empty: 'No open projects.',
        rows: [...phases.entries()].map(([phase, count]) => ({ text: phase, value: String(count),
          sub: projects.filter(p => (phaseLabel(p.phase) || 'No phase') === phase).map(p => p.code + (p.mine ? ' (mine)' : '')).join(', ') })) },
      { title: 'Delays and late deliveries', href: '/tasks', empty: 'Nothing behind the plan and no late delivery.',
        rows: late.map(t => ({ text: t.title, sub: t.due ? `since ${t.due}` : undefined, href: t.href, warn: true })) },
      { title: 'Inspections due today', href: '/site', empty: 'No inspection due.',
        rows: inspections.map(i => ({ text: `${i.no} · ${i.code} · ${i.title}`, sub: i.on_day < now ? `asked for ${i.on_day}` : 'today', href: `/site/inspections/${i.id}`, warn: i.on_day < now })) },
      { title: 'Who is on each site', href: '/clock', empty: 'Nobody is clocked in on a site.',
        rows: [...bySite.entries()].map(([code, who]) => ({ text: code, sub: who.join(', '), value: String(who.length) })) },
    ],
  };
}

async function procurement() {
  const now = today(), week = plus(now, 7);
  const [waitingQuotes, deliveries, wos, money_, vendors] = await Promise.all([
    sql<{ id: string; no: string; cc: string | null; date: string }[]>`
      select r.id, r.no, coalesce(p.code, d.name) cc, to_char(r.date,'YYYY-MM-DD') date from purchase_requests r left join projects p on p.id = r.project_id
      left join departments d on d.id = r.dept_id where r.status = 'procurement' order by r.date`,
    sql<{ id: string; po_no: string; vendor: string | null; due: string }[]>`
      select r.id, r.po_no, v.name vendor, to_char(coalesce(r.delivery_date, r.needed_by),'YYYY-MM-DD') due from purchase_requests r left join parties v on v.id = r.vendor_id
      where r.status = 'approved' and not r.closed and coalesce(r.delivery_date, r.needed_by) <= ${week}::date order by coalesce(r.delivery_date, r.needed_by)`,
    sql<{ id: string; no: string; code: string; title: string }[]>`
      select w.id, w.no, p.code, w.title from work_orders w join projects p on p.id = w.project_id where w.status in ('head', 'management') order by w.date`,
    projectMoney(),
    sql<{ id: string; name: string; open: number }[]>`
      select p.id, p.name, sum(i.net - invoice_paid(i.id))::float open from invoices i join parties p on p.id = i.party_id
      where i.kind = 'purchase' and i.status = 'posted' and i.net - invoice_paid(i.id) > 0.004 and (i.is_bill or not exists (select 1 from payment_request_bills b where b.request_id = i.id))
      group by p.id, p.name order by open desc limit 6`,
  ]);
  const late = deliveries.filter(d => d.due < now);
  return {
    tiles: [
      { label: 'Requests waiting for quotations', value: String(waitingQuotes.length), href: '/purchasing?tab=all', warn: waitingQuotes.length > 0 },
      { label: 'Deliveries due this week', value: String(deliveries.length - late.length), sub: `${late.length} late`, href: '/purchasing/orders', warn: late.length > 0 },
      { label: 'Work orders waiting approval', value: String(wos.length), href: '/purchasing/work-orders' },
    ],
    lists: [
      { title: 'Deliveries due this week and late', href: '/purchasing/orders', empty: 'No delivery due this week.',
        rows: deliveries.map(d => ({ text: `${d.po_no}${d.vendor ? ` · ${d.vendor}` : ''}`, sub: d.due < now ? `late since ${d.due}` : `due ${d.due}`, href: `/purchasing/${d.id}`, warn: d.due < now })) },
      { title: 'Committed against budget', href: '/cost-control', empty: 'No open projects.',
        rows: money_.filter(p => p.budget || p.committed || p.cost).map(p => ({ text: p.code, sub: `cost ${money(p.cost)} + committed ${money(p.committed)}`, value: p.budget ? `${Math.round((p.cost + p.committed) / p.budget * 100)}% of ${money(p.budget)}` : 'no budget', href: `/cost-centers/${p.id}`, warn: !!p.budget && p.cost + p.committed > p.budget })) },
      { title: 'Vendors with the largest open amounts', href: '/payables', empty: 'Nothing owed to vendors.',
        rows: vendors.map(v => ({ text: v.name, value: money(v.open), href: `/vendors/${v.id}` })) },
      { title: 'Requests waiting for quotations', href: '/purchasing', empty: 'None.',
        rows: waitingQuotes.slice(0, 8).map(r => ({ text: `${r.no}${r.cc ? ` · ${r.cc}` : ''}`, sub: r.date, href: `/purchasing/${r.id}` })) },
    ],
  };
}

async function hr() {
  const now = today(), monday = plus(now, -((new Date(now + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const [clocked, [leave], late, rem, [run]] = await Promise.all([
    sql<{ name: string; category: string | null; code: string | null; since: string }[]>`
      select e.name, w.category, p.code, to_char(w.start_at at time zone ${TZ},'HH24:MI') since from work_sessions w join employees e on e.id = w.employee_id
      left join projects p on p.id = w.project_id where w.end_at is null order by e.name`,
    sql<{ n: number }[]>`select count(*)::int n from leave_requests where status in ('head', 'hr')`,
    sql<{ name: string; n: number; min: number }[]>`
      select e.name, count(*)::int n, sum(a.late_min)::int min from attendance a join employees e on e.id = a.employee_id
      where a.day between ${monday}::date and ${now}::date and a.late_min > 0 group by e.name order by min desc`,
    reminders(now),
    sql<{ period: string; status: string }[]>`select period, status from payroll_runs order by period desc limit 1`,
  ]);
  const docs = rem.filter(r => r.kind === 'documents'), dates = rem.filter(r => r.due);
  return {
    tiles: [
      { label: 'Clocked in now', value: String(clocked.length), href: '/attendance' },
      { label: 'Leave requests waiting', value: String(leave.n), href: '/leave', warn: leave.n > 0 },
      { label: 'Late arrivals this week', value: String(late.reduce((t, l) => t + l.n, 0)), href: '/attendance' },
      { label: 'Employees with documents missing', value: String(docs.length), href: '/hr/reports' },
      { label: 'Payroll', value: run ? `${run.period} · ${run.status}` : 'no run yet', href: '/payroll' },
    ],
    lists: [
      { title: 'Who is clocked in, and where', href: '/attendance', empty: 'Nobody is clocked in.',
        rows: clocked.map(c => ({ text: c.name, sub: `${c.category === 'site' ? `Site${c.code ? ` on ${c.code}` : ''}` : c.category === 'design' ? `Design${c.code ? ` on ${c.code}` : ''}` : 'Office'} since ${c.since}` })) },
      { title: 'Contract and probation dates', href: '/hr', empty: 'No contract or probation ending soon.',
        rows: dates.slice(0, 8).map(r => ({ text: r.name, sub: r.text, href: `/hr/employees/${r.employee_id}`, warn: r.urgent })) },
      { title: 'Late arrivals this week', href: '/attendance', empty: 'Nobody was late this week.',
        rows: late.map(l => ({ text: l.name, sub: `${l.n} day${l.n === 1 ? '' : 's'}`, value: `${l.min} min` })) },
      { title: 'Documents missing', href: '/hr/reports', empty: 'Every file is complete.',
        rows: docs.slice(0, 8).map(r => ({ text: r.name, sub: r.text, href: `/hr/employees/${r.employee_id}` })) },
    ],
  };
}

async function admin() {
  const now = today();
  const mgmt: User = { id: '', email: '', name: 'Management', roles: ['management'] };
  const [waiting, overdue, noLogin, noHead, noPin, log] = await Promise.all([
    waitingForUser(mgmt),
    sql<{ dept: string | null; n: number }[]>`
      select coalesce(d.name, 'No department') dept, count(*)::int n from tasks t
      left join employees e on e.id = t.assignee_emp_id left join users u on u.id = t.assignee_id left join departments d on d.id = coalesce(e.dept_id, u.dept_id)
      where t.status <> 'done' and t.due < ${now}::date group by d.name order by n desc`,
    sql<{ id: string; name: string }[]>`select id, name from employees where active and user_id is null order by name`,
    sql<{ id: string; name: string }[]>`select id, name from departments where active and head_user_id is null order by name`,
    sql<{ id: string; code: string }[]>`select id, code from projects where not is_office and status <> 'Closed' and (site_lat is null or site_lng is null) order by code`,
    sql<{ at: string; who: string | null; entity: string; action: string; note: string }[]>`
      select to_char(g.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, g.entity, g.action, g.note from audit_log g left join users u on u.id = g.user_id order by g.at desc limit 8`,
  ]);
  const late = overdue.reduce((t, o) => t + o.n, 0);
  return {
    tiles: [
      { label: 'Waiting for Management', value: String(waiting.length), href: '/approvals' },
      { label: 'Overdue tasks', value: String(late), href: '/tasks', warn: late > 0 },
      { label: 'People without a login', value: String(noLogin.length), href: '/settings#people' },
      { label: 'Departments without a head', value: String(noHead.length), href: '/settings' },
      { label: 'Projects without a site pin', value: String(noPin.length), href: '/cost-centers', warn: noPin.length > 0 },
    ],
    lists: [
      { title: 'Overdue tasks by department', href: '/tasks', empty: 'No task is overdue.', rows: overdue.map(o => ({ text: o.dept ?? 'No department', value: String(o.n), warn: true })) },
      { title: 'Without a login, or without a head', href: '/settings', empty: 'Everyone has a login and every department a head.',
        rows: [...noLogin.map(e => ({ text: e.name, sub: 'no login', href: `/hr/employees/${e.id}` })), ...noHead.map(d => ({ text: d.name, sub: 'department without a head', href: '/settings' }))] },
      { title: 'Projects without a site pin', href: '/cost-centers', empty: 'Every project has its site pin.', rows: noPin.map(p => ({ text: p.code, sub: 'Site location not set', href: `/cost-centers/${p.id}` })) },
      { title: 'Last changes', href: '/settings/audit', empty: 'Nothing recorded yet.', rows: log.map(g => ({ text: `${g.who ?? 'System'} · ${g.action}`, sub: `${g.at} · ${g.entity}${g.note ? ` · ${g.note}` : ''}` })) },
    ],
  };
}

async function sales() {
  const now = today();
  const [tenders, estimates, clientSets, vos, uncollected, pipeline] = await Promise.all([
    sql<{ id: string; no: string; name: string; due: string | null }[]>`
      select id, no, name, to_char(due_date,'YYYY-MM-DD') due from tenders where status not in ('Won', 'Lost') order by due_date nulls last`,
    sql<{ id: string; code: string; rev: number; price: number; sent: string | null }[]>`
      select e.id, p.code, e.rev, coalesce(e.client_price, 0)::float price, to_char(e.sent_at at time zone ${TZ},'YYYY-MM-DD') sent
      from estimates e join projects p on p.id = e.project_id where e.status = 'sent' order by e.sent_at`,
    sql<{ id: string; code: string; kind: string; version: number }[]>`select s.id, p.code, s.kind, s.version from drawing_sets s join projects p on p.id = s.project_id where s.status = 'client' order by s.client_sent_at`,
    sql<{ id: string; no: string; code: string }[]>`select v.id, v.no, p.code from variation_orders v join projects p on p.id = v.project_id where v.status = 'sent' order by v.date`,
    sql<{ customer: string; n: number; open: number }[]>`
      select pt.name customer, count(*)::int n, sum(i.total - invoice_paid(i.id))::float open from invoices i join parties pt on pt.id = i.party_id
      where i.kind = 'sales' and i.status = 'posted' and i.total - invoice_paid(i.id) > 0.004 group by pt.name order by open desc`,
    sql<{ phase: string | null; n: number; value: number }[]>`
      select phase, count(*)::int n, coalesce(sum(contract), 0)::float value from projects where not is_office and status <> 'Closed' group by phase`,
  ]);
  const approvals = clientSets.length + vos.length;
  return {
    tiles: [
      { label: 'Tenders in progress', value: String(tenders.length), sub: tenders[0]?.due ? `next deadline ${tenders[0].due}` : undefined, href: '/tenders' },
      { label: 'Estimates waiting for the client', value: String(estimates.length), sub: money(estimates.reduce((t, e) => t + e.price, 0)), href: '/qs' },
      { label: 'Client approvals pending', value: String(approvals), sub: `${clientSets.length} drawing set${clientSets.length === 1 ? '' : 's'} · ${vos.length} variation order${vos.length === 1 ? '' : 's'}`, href: '/design' },
      { label: 'Not yet collected', value: money(uncollected.reduce((t, u) => t + u.open, 0)), sub: `${uncollected.length} client${uncollected.length === 1 ? '' : 's'}`, href: '/collections' },
    ],
    lists: [
      { title: 'Tenders and their deadlines', href: '/tenders', empty: 'No tender in progress.',
        rows: tenders.map(t => ({ text: `${t.no} · ${t.name}`, sub: t.due ? `deadline ${t.due}` : 'no deadline', href: `/tenders/${t.id}`, warn: !!t.due && t.due < now })) },
      { title: 'Pipeline by phase', href: '/cost-centers', empty: 'No open projects.',
        rows: pipeline.map(p => ({ text: phaseLabel(p.phase) || 'No phase', sub: `${p.n} project${p.n === 1 ? '' : 's'}`, value: money(p.value) })) },
      { title: 'Waiting for the client', href: '/qs', empty: 'Nothing is with a client.',
        rows: [...estimates.map(e => ({ text: `${e.code} · estimate rev ${e.rev}`, sub: e.sent ? `sent ${e.sent}` : undefined, value: money(e.price), href: `/qs/${e.id}` })),
          ...clientSets.map(s => ({ text: `${s.code} · ${s.kind} v${s.version}`, sub: 'drawings with the client', href: `/design/${s.id}` })),
          ...vos.map(v => ({ text: `${v.code} · ${v.no}`, sub: 'variation order with the client', href: `/variations/${v.id}` }))] },
      { title: 'Invoices not collected, per client', href: '/collections', empty: 'Everything invoiced is collected.',
        rows: uncollected.map(u => ({ text: u.customer, sub: `${u.n} invoice${u.n === 1 ? '' : 's'}`, value: money(u.open) })) },
    ],
  };
}

async function management(user: User) {
  const now = today();
  const [cash, projects, waiting, [lateTasks], [lateDeliveries]] = await Promise.all([
    cashView(), projectMoney(), waitingForUser(user),
    sql<{ n: number }[]>`select count(*)::int n from tasks where status <> 'done' and due < ${now}::date`,
    sql<{ n: number }[]>`select count(*)::int n from purchase_requests where status = 'approved' and not closed and coalesce(delivery_date, needed_by) < ${now}::date`,
  ]);
  const sum = (k: 'contract' | 'margin') => projects.reduce((t, p) => t + p[k], 0);
  const alerts: Row[] = [];
  if (cash.overdueIn > 0.004) alerts.push({ text: `Collections overdue: ${money(cash.overdueIn)}`, href: '/collections', warn: true });
  if (cash.overdueOut > 0.004) alerts.push({ text: `Vendor invoices overdue: ${money(cash.overdueOut)}`, href: '/payables', warn: true });
  if (cash.closing < 0) alerts.push({ text: `Cash in 30 days goes below zero: ${money(cash.closing)}`, href: '/dashboard', warn: true });
  if (cash.cardLimit && cash.cardAvailable < cash.cardLimit * 0.1) alerts.push({ text: `Credit card nearly used: ${money(cash.cardAvailable)} left`, href: '/banks', warn: true });
  for (const p of projects) if (p.contract && p.margin < 0) alerts.push({ text: `${p.code} expected margin is negative: ${money(p.margin)}`, href: `/cost-centers/${p.id}`, warn: true });
  if (lateTasks.n) alerts.push({ text: `${lateTasks.n} task${lateTasks.n === 1 ? '' : 's'} overdue`, href: '/tasks', warn: true });
  if (lateDeliveries.n) alerts.push({ text: `${lateDeliveries.n} delivery${lateDeliveries.n === 1 ? '' : 'ies'} late`, href: '/purchasing/orders', warn: true });
  return {
    tiles: [
      { label: 'Cash today (bank + petty cash)', value: money(cash.opening), sub: `bank ${money(cash.bank)} · petty cash ${money(cash.pettyCash)}`, href: '/dashboard' },
      { label: 'In 30 days, if all is paid on time', value: money(cash.closing), href: '/dashboard', warn: cash.closing < 0 },
      { label: 'Open contracts · expected margin', value: money(sum('contract')), sub: `margin ${money(sum('margin'))}`, href: '/dashboard' },
      { label: 'Credit card available', value: money(cash.cardAvailable), sub: `owed ${money(cash.card)}`, href: '/banks' },
      { label: 'Approvals waiting for me', value: String(waiting.length), href: '/approvals', warn: waiting.length > 0 },
    ],
    lists: [
      { title: 'Alerts', empty: 'Nothing needs your attention.', rows: alerts },
      { title: 'Approvals waiting for me', href: '/approvals', empty: 'Nothing is waiting for you.',
        rows: waiting.slice(0, 8).map(w => ({ text: `${w.no} · ${w.type}`, sub: w.memo, value: w.amount ? money(w.amount) : undefined, href: w.href })) },
    ],
  };
}

const lastMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

