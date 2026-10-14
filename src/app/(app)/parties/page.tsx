import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { getSettings } from '@/lib/books';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { RuleError } from '@/lib/ledger';
import Link from 'next/link';
import { isProcurement } from '@/lib/purchasing';
import { KIND_NAME, type PartyKind, addParty, partyFromForm, payLabel, vendorTypes } from '@/lib/parties';
import { PartyFields } from '@/components/PartyFields';

async function add(form: FormData) {
  'use server';
  const user = await requireUser();
  const kind = (['customer', 'vendor', 'sub'].includes(String(form.get('kind'))) ? String(form.get('kind')) : 'vendor') as PartyKind;
  try { await addParty(user, kind, partyFromForm(form)); }
  catch (e) { redirect(`/parties?tab=${kind}&error=${encodeURIComponent(e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was added.'))}`); }
  revalidatePath('/parties');
  redirect('/parties?tab=' + kind);
}

const TABS: [PartyKind, string][] = [['vendor', 'Vendors'], ['sub', 'Subcontractors'], ['customer', 'Customers']];

export default async function Parties({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const user = await requireUser();
  const q = await searchParams;
  const tab: PartyKind = q.tab === 'customer' || q.tab === 'sub' ? q.tab : 'vendor';
  const s = await getSettings();
  const customer = tab === 'customer';
  const ctrl = customer ? s.account_map.ar : s.account_map.ap;
  const [rows, types] = await Promise.all([
    sql<{ id: string; code: string | null; name: string; phone: string | null; tax_id: string | null; wht_rate: number; vendor_type: string | null; pay_method: string | null; bank_name: string | null; instapay_no: string | null; instapay_to: string | null; bal: number }[]>`
      select p.id, p.code, p.name, p.phone, p.tax_id, p.wht_rate, p.vendor_type, p.pay_method, p.bank_name, p.instapay_no, p.instapay_to,
        coalesce((select sum(l.dr - l.cr) from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
          where l.party_id = p.id and l.account = ${ctrl}),0) bal
      from parties p where p.type = ${customer ? 'customer' : 'vendor'} and (${customer} or p.is_sub = ${tab === 'sub'}) order by p.name`,
    vendorTypes(),
  ]);
  const sign = customer ? 1 : -1;
  const may = hasRole(user, 'finance') || (!customer && await isProcurement(user));
  return (
    <>
      <div className="head"><div><h1>Customers &amp; vendors</h1><p>Balances come from posted receivables and payables. Subcontractors are paid like vendors.</p></div></div>
      <div className="tabs">{TABS.map(([k, l]) => <a key={k} href={`/parties?tab=${k}`} className={tab === k ? 'on' : ''}>{l}</a>)}</div>
      {q.error && <div className="msg bad">{q.error}</div>}
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>Code</th><th>Name</th>{customer ? null : <th>Vendor type</th>}<th className="hide-sm">Phone</th>
          {customer ? <th className="hide-sm">ID number</th> : <th className="hide-sm">Paid by</th>}<th className="num hide-sm">WHT %</th><th className="num">{customer ? 'They owe us' : 'We owe them'}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td className="mono">{r.code}</td><td dir="auto"><Link href={`/parties/${r.id}`}>{r.name}</Link></td>{customer ? null : <td dir="auto">{r.vendor_type ?? <span className="muted">—</span>}</td>}
          <td className="hide-sm">{r.phone}</td><td className="hide-sm">{customer ? r.tax_id : payLabel(r)}</td>
          <td className="num hide-sm">{r.wht_rate || ''}</td><td className="num">{fmt(sign * r.bal)}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">No {KIND_NAME[tab]} yet.</td></tr>}</tbody>
      </table></div>
      {may && (
        <form action={add} className="card">
          <h2>Add {KIND_NAME[tab]}</h2>
          <input type="hidden" name="kind" value={tab} />
          <PartyFields kind={tab} types={types} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn pri">Add</button></div>
        </form>)}
    </>
  );
}
