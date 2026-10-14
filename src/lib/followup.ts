import 'server-only';
import { sql } from './db';
import { fmt } from './money';
import { today } from './dates';
import { aging, type AgingDoc } from './reports';

// Collections follow-up (improvement 7): the client invoices still owed, aged per customer (current, 1–30, 31–60, 61–90,
// 90+ days past due), a reminder task for Finance on each due date and every seven days after while it is unpaid, and
// a ready WhatsApp message in English and Arabic with the customer's name, the invoice numbers and the amount.

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Who follows up collections: the head of Finance, else the person who issued the invoice. */
async function collector(): Promise<string | null> {
  const [d] = await sql<{ head: string | null }[]>`select u.id head from departments d join users u on u.id = d.head_user_id and u.active where d.code = 'FIN' and d.active`;
  return d?.head ?? null;
}

/**
 * Raises (or renews) the reminder tasks: an invoice due today or earlier with money still owed gets a task on its due
 * date and again every 7 days; the task closes when the invoice is paid. Safe to run many times a day.
 */
export async function raiseCollectionReminders(now = today()) {
  const { docs } = await aging({ side: 'sales', asOf: now });
  const due = docs.filter(d => d.due && d.due <= now);
  const head = await collector();
  let raised = 0;
  for (const d of due) {
    const [r] = await sql<{ task_id: string | null; last_on: string; times: number; status: string | null }[]>`
      select r.task_id, to_char(r.last_on,'YYYY-MM-DD') last_on, r.times, t.status from collection_reminders r left join tasks t on t.id = r.task_id where r.invoice_id = ${d.id}`;
    if (r && daysBetween(r.last_on, now) < 7) continue;
    const late = Math.max(0, d.days);
    const title = `Collect ${d.no} from ${d.party}: ${fmt(d.balance)}${late ? `, ${late} days overdue` : ', due today'}`;
    const [inv] = await sql<{ created_by: string | null; project_id: string | null }[]>`select created_by, project_id from invoices where id = ${d.id}`;
    const assignee = head ?? inv?.created_by ?? null;
    if (r?.task_id && r.status && r.status !== 'done') {
      await sql`update tasks set title = ${title}, due = ${now}, priority = ${late > 30 ? 'high' : 'normal'}, updated_at = now() where id = ${r.task_id}`;
      await sql`insert into task_comments (task_id, user_id, text) values (${r.task_id}, null, ${`Reminder ${r.times + 1}: still ${fmt(d.balance)} open on ${now}.`})`;
      await sql`update collection_reminders set last_on = ${now}, times = times + 1 where invoice_id = ${d.id}`;
    } else {
      const [{ id }] = await sql<{ id: string }[]>`insert into tasks (title, details, status, priority, due, assignee_id, link_type, link_id, link_label, project_id)
        values (${title}, ${'Call or send the WhatsApp message from Collections → Follow-up. The task closes by itself when the invoice is paid.'}, 'todo', ${late > 30 ? 'high' : 'normal'}, ${now}, ${assignee}, 'sales-invoice', ${d.id}, ${d.no}, ${inv?.project_id ?? null}) returning id`;
      await sql`insert into collection_reminders (invoice_id, task_id, last_on, times) values (${d.id}, ${id}, ${now}, 1)
        on conflict (invoice_id) do update set task_id = excluded.task_id, last_on = excluded.last_on, times = collection_reminders.times + 1`;
    }
    raised++;
  }
  // paid invoices: their reminder tasks are done
  const open = new Set(docs.map(d => d.id));
  const stale = await sql<{ invoice_id: string; task_id: string }[]>`select r.invoice_id, r.task_id from collection_reminders r join tasks t on t.id = r.task_id and t.status <> 'done'`;
  for (const s of stale) if (!open.has(s.invoice_id)) await sql`update tasks set status = 'done', done_at = now(), updated_at = now() where id = ${s.task_id}`;
  return raised;
}

export type FollowUp = { party_id: string; party: string; full_name: string | null; phone: string | null; buckets: number[]; total: number; overdue: number; docs: AgingDoc[] };
/** Each customer who owes money, with the aging buckets and the open invoices. */
export async function followUps(now = today()): Promise<{ customers: FollowUp[]; totals: number[] }> {
  const a = await aging({ side: 'sales', asOf: now });
  const ids = a.parties.map(p => p.party_id);
  const info = ids.length ? await sql<{ id: string; full_name: string | null; phone: string | null }[]>`select id, full_name, phone from parties where id = any(${ids})` : [];
  const by = new Map(info.map(i => [i.id, i]));
  const customers = a.parties.map(p => {
    const docs = a.docs.filter(d => d.party_id === p.party_id);
    return { ...p, full_name: by.get(p.party_id)?.full_name ?? null, phone: by.get(p.party_id)?.phone ?? null, docs,
      overdue: Math.round(docs.filter(d => d.days > 0).reduce((t, d) => t + d.balance, 0) * 100) / 100 };
  }).sort((x, y) => y.overdue - x.overdue || y.total - x.total);
  return { customers, totals: a.totals };
}

/** An Egyptian mobile number as WhatsApp wants it (2010…); anything else as typed, digits only. */
export function waNumber(phone: string | null) {
  const d = (phone ?? '').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, '');
  if (!d) return null;
  if (/^01\d{9}$/.test(d)) return '2' + d;
  if (/^0020\d+/.test(d)) return d.slice(2);
  return d;
}

/** The reminder message, in English and Arabic. */
export function reminderMessage(c: Pick<FollowUp, 'party' | 'full_name' | 'docs'>, bank?: { holder: string | null; bank_name: string | null; iban: string | null } | null) {
  const name = c.full_name || c.party;
  const total = c.docs.reduce((t, d) => t + d.balance, 0);
  const list = c.docs.map(d => `${d.no} (${fmt(d.balance)}${d.due ? `, due ${d.due}` : ''})`).join(', ');
  const listAr = c.docs.map(d => `${d.no} (${fmt(d.balance)}${d.due ? ` - تاريخ الاستحقاق ${d.due}` : ''})`).join('، ');
  const pay = bank?.iban ? `\nBank transfer: ${bank.holder ?? 'Right Space Development'}, ${bank.bank_name ?? ''}, IBAN ${bank.iban}` : '';
  const payAr = bank?.iban ? `\nالتحويل البنكي: ${bank.holder ?? 'Right Space Development'}، ${bank.bank_name ?? ''}، IBAN ${bank.iban}` : '';
  const en = `Dear ${name},\nThis is a kind reminder from Right Space Development that EGP ${fmt(total)} is due on invoice${c.docs.length === 1 ? '' : 's'} ${list}.${pay}\nThank you.`;
  const ar = `السيد/ة ${name}،\nنود تذكيركم من رايت سبيس للتطوير بأن مبلغ ${fmt(total)} جنيه مستحق على الفاتورة${c.docs.length === 1 ? '' : ' أرقام'} ${listAr}.${payAr}\nشكراً لكم.`;
  return { en, ar };
}
