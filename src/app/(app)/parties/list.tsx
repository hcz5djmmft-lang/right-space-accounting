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

/** Where a kind's list lives (update 19): Customers under AR, Vendors & subcontractors (two tabs) under AP. */
export const listHref = (kind: PartyKind) => (kind === 'customer' ? '/customers' : kind === 'sub' ? '/vendors?tab=sub' : '/vendors');
/** A party's own page, under the list it belongs to. */
export const partyHref = (id: string, type: 'customer' | 'vendor') => `/${type === 'customer' ? 'customers' : 'vendors'}/${id}`;

async function add(form: FormData) {
  'use server';
  const user = await requireUser();
  const kind = (['customer', 'vendor', 'sub'].includes(String(form.get('kind'))) ? String(form.get('kind')) : 'vendor') as PartyKind;
  const back = listHref(kind);
  try { await addParty(user, kind, partyFromForm(form)); }
  catch (e) { redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was added.'))}`); }
  revalidatePath(back.split('?')[0]);
  redirect(back);
}

const TABS: [PartyKind, string][] = [['vendor', 'Vendors'], ['sub', 'Subcontractors']];

/** The Customers page (side 'ar') or the Vendors & subcontractors page (side 'ap'). */
export async function PartyList({ side, q }: { side: 'ar' | 'ap'; q: { tab?: string; error?: string } }) {
  const user = await requireUser();
  const tab: PartyKind = side === 'ar' ? 'customer' : q.tab === 'sub' ? 'sub' : 'vendor';
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
      <div className="head"><div>{customer
        ? <><h1>Customers</h1><p>Balances come from posted receivables.</p></>
        : <><h1>Vendors &amp; subcontractors</h1><p>Balances come from posted payables. Subcontractors are paid like vendors.</p></>}</div></div>
      {!customer && <div className="tabs">{TABS.map(([k, l]) => <a key={k} href={listHref(k)} className={tab === k ? 'on' : ''}>{l}</a>)}</div>}
      {q.error && <div className="msg bad">{q.error}</div>}
      <div className="tw" style={{ marginBottom: 14 }}><table>
        <thead><tr><th>Code</th><th>Name</th>{customer ? null : <th>Vendor type</th>}<th className="hide-sm">Phone</th>
          {customer ? <th className="hide-sm">ID number</th> : <th className="hide-sm">Paid by</th>}<th className="num hide-sm">WHT %</th><th className="num">{customer ? 'They owe us' : 'We owe them'}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td className="mono">{r.code}</td><td dir="auto"><Link href={partyHref(r.id, customer ? 'customer' : 'vendor')}>{r.name}</Link></td>{customer ? null : <td dir="auto">{r.vendor_type ?? <span className="muted">—</span>}</td>}
          <td className="hide-sm">{r.phone}</td><td className="hide-sm">{customer ? r.tax_id : payLabel(r, may)}</td>
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
