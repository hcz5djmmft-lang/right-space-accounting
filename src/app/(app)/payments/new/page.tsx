import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { fmt, parseAmount } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import { openRequests, postVendorPayment } from '@/lib/documents';

async function pay(form: FormData) {
  'use server';
  const user = await requireUser('finance');
  const party = String(form.get('party') ?? '');
  const alloc = [...form.keys()].filter(k => k.startsWith('alloc_')).map(k => ({ invoice: k.slice(6), amount: parseAmount(form.get(k)) }));
  let id = '', err = '';
  try {
    id = await postVendorPayment(user, {
      date: String(form.get('date')), party, bank: String(form.get('bank') ?? ''), amount: parseAmount(form.get('amount')),
      memo: String(form.get('memo') ?? ''), ref: String(form.get('ref') ?? ''), alloc,
    });
  } catch (e) { err = e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was posted.'); }
  revalidatePath('/', 'layout');
  redirect(err ? `/payments/new?vendor=${party}&error=${encodeURIComponent(err)}` : `/payments/new?vendor=${party}&done=${id}`);
}

export default async function NewPayment({ searchParams }: { searchParams: Promise<{ vendor?: string; error?: string; done?: string }> }) {
  await requireUser('finance');
  const { vendor = '', error, done } = await searchParams;
  const [vendors, banks, open] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from parties where type = 'vendor' order by name`,
    sql<{ code: string; name: string }[]>`select code, name from accounts where is_bank and postable order by code`,
    vendor ? openRequests(sql, vendor) : Promise.resolve([]),
  ]);
  const due = open.filter(o => o.open > 0.004);
  const [paid] = done ? await sql<{ no: string }[]>`select no from payments where id = ${done}` : [];
  return (
    <>
      <div className="head"><div><h1>Pay a vendor</h1><p>Allocate the payment to approved requests. Anything not allocated is recorded as a down payment (90000).</p></div>
        <Link className="btn" href="/payment-requests?tab=open">Approved, not paid</Link></div>
      {error && <div className="msg bad">{error}</div>}
      {paid && <div className="msg good">Payment {paid.no} posted.</div>}
      <form className="row card" style={{ alignItems: 'end' }}>
        <label className="f" style={{ minWidth: 260 }}><span>Vendor</span><select className="inp" name="vendor" defaultValue={vendor}>
          <option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <button className="btn">Show open requests</button>
      </form>
      {vendor && (
        <form action={pay} className="card">
          <input type="hidden" name="party" value={vendor} />
          <div className="grid g4">
            <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label className="f"><span>Paid from</span><select className="inp" name="bank">{banks.map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</select></label>
            <label className="f"><span>Amount (EGP)</span><input className="inp mono" name="amount" inputMode="decimal" defaultValue={due.length ? String(due.reduce((s, d) => s + d.open, 0)) : ''} required /></label>
            <label className="f"><span>Reference</span><input className="inp" name="ref" placeholder="Transfer / cheque no." /></label>
            <label className="f" style={{ gridColumn: '1 / -1' }}><span>Description</span><input className="inp" name="memo" dir="auto" /></label>
          </div>
          <h2 style={{ marginTop: 14 }}>Allocate to requests</h2>
          {due.length === 0 ? <p className="muted">No approved requests are open for this vendor; the whole amount will be a down payment.</p> : (
            <div className="tw"><table><thead><tr><th>Request</th><th>Date</th><th className="num">Net</th><th className="num">Open</th><th className="num">Pay now</th></tr></thead>
              <tbody>{due.map(o => <tr key={o.id}><td className="mono"><Link href={`/payment-requests/${o.id}`}>{o.no}</Link></td><td className="mono">{o.date}</td>
                <td className="num">{fmt(o.net)}</td><td className="num">{fmt(o.open)}</td>
                <td className="num"><input className="inp mono" style={{ maxWidth: 140 }} name={'alloc_' + o.id} inputMode="decimal" defaultValue={o.open} /></td></tr>)}</tbody></table></div>)}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn pri">Post payment</button></div>
        </form>)}
    </>
  );
}
