import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt, parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { openInvoices, postCustomerReceipt } from '@/lib/sales';
import { collectionTypes } from '@/lib/collections';
import { today } from '@/lib/dates';

async function receive(form: FormData) {
  'use server';
  const user = await requireUser('finance');
  const party = String(form.get('party') ?? '');
  const alloc = [...form.keys()].filter(k => k.startsWith('alloc_')).map(k => ({ invoice: k.slice(6), amount: parseAmount(form.get(k)) }));
  let id = '', err = '';
  try {
    id = await postCustomerReceipt(user, {
      date: String(form.get('date')), party, project: String(form.get('project') ?? '') || null, bank: String(form.get('bank') ?? ''),
      received: parseAmount(form.get('received')), wht: parseAmount(form.get('wht')), memo: String(form.get('memo') ?? ''), ref: String(form.get('ref') ?? ''), alloc,
    });
  } catch (e) { err = e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was posted.'); }
  revalidatePath('/', 'layout');
  redirect(err ? `/receipts/new?customer=${party}&error=${encodeURIComponent(err)}` : `/receipts/${id}?done=1`);
}

/** Money received from a client: cash or a bank transfer, against their invoices or as an advance. A receipt is printed for them. */
export default async function NewReceipt({ searchParams }: { searchParams: Promise<{ customer?: string; invoice?: string; error?: string }> }) {
  await requireUser('finance');
  const { invoice = '', error } = await searchParams;
  let { customer = '' } = await searchParams;
  const inv = invoice ? (await sql<{ id: string; no: string; party_id: string; project_id: string | null }[]>`select id, no, party_id, project_id from invoices where id = ${invoice} and kind = 'sales'`)[0] : null;
  if (inv) customer = inv.party_id;
  const [customers, accounts, projects, open, types] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'customer' order by name`,
    sql<{ code: string; name: string; kind: string }[]>`select a.code, a.name, coalesce(b.kind, 'bank') kind from accounts a left join bank_accounts b on b.account = a.code
      where a.is_bank and a.postable and coalesce(b.kind, 'bank') in ('bank', 'cash') order by (coalesce(b.kind, 'bank') = 'bank') desc, a.code`,
    sql<{ id: string; code: string; name: string }[]>`select id, code, name from projects where not is_office and status <> 'Closed' order by code`,
    customer ? openInvoices(sql, customer) : Promise.resolve([]),
    collectionTypes(),
  ]);
  const due = open.filter(o => o.open > 0.004);
  const typeName = (c: string | null) => types.find(t => t.id === c)?.name ?? '—';
  const settle = (o: (typeof due)[number]) => (inv ? (o.id === inv.id ? o.open : 0) : o.open);
  const total = due.reduce((s, o) => s + settle(o), 0);
  const project = inv?.project_id ?? due[0]?.project_id ?? '';
  const byKind = (k: string) => accounts.filter(a => a.kind === k);
  return (
    <>
      <div className="head"><div><h1>Money received</h1><p>Cash or a bank transfer from a client, for a project, against their invoices. The receipt prints as a cash receipt or a bank transfer receipt.</p></div>
        <div className="row"><Link className="btn" href="/sales-invoices?tab=open">Not yet received</Link><Link className="btn" href="/collections">Collections</Link></div></div>
      {error && <div className="msg bad">{error}</div>}
      <form className="row card" style={{ alignItems: 'end' }}>
        <label className="f" style={{ minWidth: 260 }}><span>Client</span><select className="inp" name="customer" defaultValue={customer}>
          <option value="">Select…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="btn">Show open invoices</button>
      </form>
      {customer && (
        <form action={receive} className="card">
          <input type="hidden" name="party" value={customer} />
          <div className="grid g4">
            <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
            <label className="f"><span>Project</span><select className="inp" name="project" defaultValue={project}>
              <option value="">— None —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code === p.name ? p.name : `${p.code} · ${p.name}`}</option>)}</select></label>
            <label className="f"><span>How · received into</span><select className="inp" name="bank">
              <optgroup label="Bank transfer">{byKind('bank').map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</optgroup>
              <optgroup label="Cash">{byKind('cash').map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</optgroup></select></label>
            <label className="f"><span>Amount received (EGP)</span><input className="inp mono" name="received" inputMode="decimal" defaultValue={total ? String(total) : ''} required /></label>
            <label className="f"><span>WHT withheld by the client</span><input className="inp mono" name="wht" inputMode="decimal" defaultValue="0" /></label>
            <label className="f"><span>Transfer / cheque no.</span><input className="inp" name="ref" placeholder="Optional" /></label>
            <label className="f" style={{ gridColumn: 'span 2' }}><span>Description</span><input className="inp" name="memo" dir="auto" placeholder={inv ? `Against ${inv.no}` : 'e.g. Second instalment'} /></label>
          </div>
          <h2 style={{ marginTop: 14 }}>Against invoices</h2>
          {due.length === 0 ? <p className="muted">No open invoices for this client; the amount is recorded as an advance on their account for the project.</p> : (
            <div className="tw"><table><thead><tr><th>Invoice</th><th>Date</th><th className="hide-sm">Type</th><th className="num">Total</th><th className="num">Open</th><th className="num">Settle now</th></tr></thead>
              <tbody>{due.map(o => <tr key={o.id}><td className="mono"><Link href={`/sales-invoices/${o.id}`}>{o.no}</Link></td><td className="mono">{o.date}</td><td className="hide-sm">{typeName(o.category)}</td>
                <td className="num">{fmt(o.total)}</td><td className="num">{fmt(o.open)}</td>
                <td className="num"><input className="inp mono" style={{ maxWidth: 140 }} name={'alloc_' + o.id} inputMode="decimal" defaultValue={settle(o)} /></td></tr>)}</tbody></table></div>)}
          <p className="muted" style={{ fontSize: 13 }}>Allocations may total the amount received plus the WHT withheld; anything left over stays on the client's account as an advance.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn pri">Post and print receipt</button></div>
        </form>)}
    </>
  );
}
