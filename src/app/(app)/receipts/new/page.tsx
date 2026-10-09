import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt, parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { openInvoices, postCustomerReceipt } from '@/lib/sales';

async function receive(form: FormData) {
  'use server';
  const user = await requireUser('finance');
  const party = String(form.get('party') ?? '');
  const alloc = [...form.keys()].filter(k => k.startsWith('alloc_')).map(k => ({ invoice: k.slice(6), amount: parseAmount(form.get(k)) }));
  let id = '', err = '';
  try {
    id = await postCustomerReceipt(user, {
      date: String(form.get('date')), party, bank: String(form.get('bank') ?? ''), received: parseAmount(form.get('received')), wht: parseAmount(form.get('wht')),
      memo: String(form.get('memo') ?? ''), ref: String(form.get('ref') ?? ''), alloc,
    });
  } catch (e) { err = e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was posted.'); }
  revalidatePath('/', 'layout');
  redirect(err ? `/receipts/new?customer=${party}&error=${encodeURIComponent(err)}` : `/receipts/new?customer=${party}&done=${id}`);
}

export default async function NewReceipt({ searchParams }: { searchParams: Promise<{ customer?: string; error?: string; done?: string }> }) {
  await requireUser('finance');
  const { customer = '', error, done } = await searchParams;
  const [customers, banks, open] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'customer' order by name`,
    sql<{ code: string; name: string }[]>`select code, name from accounts where is_bank and postable order by code`,
    customer ? openInvoices(sql, customer) : Promise.resolve([]),
  ]);
  const due = open.filter(o => o.open > 0.004);
  const [posted] = done ? await sql<{ no: string }[]>`select no from payments where id = ${done}` : [];
  return (
    <>
      <div className="head"><div><h1>Record a receipt</h1><p>Money received from a customer, allocated to their invoices. If the customer withheld tax, enter it so the invoice is fully settled.</p></div>
        <Link className="btn" href="/sales-invoices?tab=open">Not yet received</Link></div>
      {error && <div className="msg bad">{error}</div>}
      {posted && <div className="msg good">Receipt {posted.no} posted.</div>}
      <form className="row card" style={{ alignItems: 'end' }}>
        <label className="f" style={{ minWidth: 260 }}><span>Customer</span><select className="inp" name="customer" defaultValue={customer}>
          <option value="">Select…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="btn">Show open invoices</button>
      </form>
      {customer && (
        <form action={receive} className="card">
          <input type="hidden" name="party" value={customer} />
          <div className="grid g4">
            <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label className="f"><span>Received into</span><select className="inp" name="bank">{banks.map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</select></label>
            <label className="f"><span>Amount received (EGP)</span><input className="inp mono" name="received" inputMode="decimal" defaultValue={due.length ? String(due.reduce((s, d) => s + d.open, 0)) : ''} required /></label>
            <label className="f"><span>WHT withheld by customer</span><input className="inp mono" name="wht" inputMode="decimal" defaultValue="0" /></label>
            <label className="f" style={{ gridColumn: 'span 2' }}><span>Reference</span><input className="inp" name="ref" placeholder="Transfer / cheque no." /></label>
            <label className="f" style={{ gridColumn: 'span 2' }}><span>Description</span><input className="inp" name="memo" dir="auto" /></label>
          </div>
          <h2 style={{ marginTop: 14 }}>Allocate to invoices</h2>
          {due.length === 0 ? <p className="muted">No open invoices for this customer; the amount will sit on their account as an advance.</p> : (
            <div className="tw"><table><thead><tr><th>Invoice</th><th>Date</th><th className="num">Total</th><th className="num">Open</th><th className="num">Settle now</th></tr></thead>
              <tbody>{due.map(o => <tr key={o.id}><td className="mono"><Link href={`/sales-invoices/${o.id}`}>{o.no}</Link></td><td className="mono">{o.date}</td>
                <td className="num">{fmt(o.total)}</td><td className="num">{fmt(o.open)}</td>
                <td className="num"><input className="inp mono" style={{ maxWidth: 140 }} name={'alloc_' + o.id} inputMode="decimal" defaultValue={o.open} /></td></tr>)}</tbody></table></div>)}
          <p className="muted" style={{ fontSize: 13 }}>Allocations may total the amount received plus the WHT withheld.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn pri">Post receipt</button></div>
        </form>)}
    </>
  );
}
