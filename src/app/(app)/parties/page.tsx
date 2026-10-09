import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { audit, getSettings } from '@/lib/books';
import { sql } from '@/lib/db';
import { fmt, parseAmount } from '@/lib/money';

async function addParty(form: FormData) {
  'use server';
  const user = await requireUser('finance');
  const v = (k: string) => String(form.get(k) ?? '').trim() || null;
  const type = v('type') === 'customer' ? 'customer' : 'vendor';
  const name = v('name');
  if (!name) redirect('/parties?error=' + encodeURIComponent('Enter a name.'));
  await sql.begin(async tx => {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int + 1 n from parties where type = ${type}`;
    const code = (type === 'customer' ? 'CU' : 'VC') + String(n).padStart(4, '0');
    const [p] = await tx<{ id: string }[]>`insert into parties (code, type, name, phone, email, tax_id, bank_name, account_no, iban, wht_rate)
      values (${code}, ${type}, ${name}, ${v('phone')}, ${v('email')}, ${v('tax_id')}, ${v('bank_name')}, ${v('account_no')}, ${v('iban')}, ${parseAmount(v('wht_rate'))})
      on conflict (code) do nothing returning id`;
    if (p) await audit(tx, user, 'party', p.id, 'Created');
  });
  revalidatePath('/parties');
  redirect('/parties?tab=' + type);
}

export default async function Parties({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const user = await requireUser();
  const { tab = 'vendor', error } = await searchParams;
  const s = await getSettings();
  const ctrl = tab === 'customer' ? s.account_map.ar : s.account_map.ap;
  const rows = await sql<{ id: string; code: string | null; name: string; phone: string | null; tax_id: string | null; wht_rate: number; bal: number }[]>`
    select p.id, p.code, p.name, p.phone, p.tax_id, p.wht_rate,
      coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        where l.party_id = p.id and l.account = ${ctrl}),0) bal
    from parties p where p.type = ${tab} order by p.name`;
  const sign = tab === 'customer' ? 1 : -1;
  return (
    <>
      <div className="head"><div><h1>Customers &amp; vendors</h1><p>Balances come from posted receivables and payables.</p></div></div>
      <div className="tabs">
        <a href="/parties?tab=vendor" className={tab === 'vendor' ? 'on' : ''}>Vendors</a>
        <a href="/parties?tab=customer" className={tab === 'customer' ? 'on' : ''}>Customers</a>
      </div>
      {error && <div className="msg bad">{error}</div>}
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>Code</th><th>Name</th><th className="hide-sm">Phone</th><th className="hide-sm">Tax ID</th><th className="num hide-sm">WHT %</th><th className="num">{tab === 'customer' ? 'They owe us' : 'We owe them'}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td className="mono">{r.code}</td><td dir="auto">{r.name}</td><td className="hide-sm">{r.phone}</td><td className="hide-sm">{r.tax_id}</td>
          <td className="num hide-sm">{r.wht_rate || ''}</td><td className="num">{fmt(sign * r.bal)}</td></tr>)}</tbody>
      </table></div>
      {hasRole(user, 'finance') && (
        <form action={addParty} className="card">
          <h2>Add {tab === 'customer' ? 'customer' : 'vendor'}</h2>
          <input type="hidden" name="type" value={tab} />
          <div className="grid g4">
            <label className="f"><span>Name</span><input className="inp" name="name" dir="auto" required /></label>
            <label className="f"><span>Phone</span><input className="inp" name="phone" /></label>
            <label className="f"><span>Email</span><input className="inp" name="email" type="email" /></label>
            <label className="f"><span>Tax ID</span><input className="inp" name="tax_id" /></label>
            <label className="f"><span>Bank</span><input className="inp" name="bank_name" /></label>
            <label className="f"><span>Account no.</span><input className="inp" name="account_no" /></label>
            <label className="f"><span>IBAN</span><input className="inp" name="iban" /></label>
            <label className="f"><span>WHT %</span><select className="inp" name="wht_rate"><option>0</option><option>1</option><option>3</option><option>5</option></select></label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn pri">Add</button></div>
        </form>)}
    </>
  );
}
