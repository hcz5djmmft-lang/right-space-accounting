import 'server-only';
import { sql } from './db';
import { audit, getSettings } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { isProcurement } from './purchasing';
import { parseAmount } from './money';

// Customers, vendors and subcontractors (update 18). A customer carries a national ID number (kept in the old tax_id column).
// A vendor or subcontractor (a subcontractor is a vendor in the books, so its invoices are paid like a vendor's) is paid to
// a bank account (bank name, account no., IBAN) or InstaPay (the number, and whether it lands in a bank account or a wallet),
// and carries a vendor type from a list that grows when a new type is typed.

export type PartyKind = 'customer' | 'vendor' | 'sub';
export const KIND_NAME: Record<PartyKind, string> = { customer: 'customer', vendor: 'vendor', sub: 'subcontractor' };

export type PartyInput = {
  name: string; phone?: string | null; email?: string | null; tax_id?: string | null; wht_rate?: number;
  vendor_type?: string | null; new_type?: string | null; pay_method?: 'bank' | 'instapay' | null;
  bank_name?: string | null; account_no?: string | null; iban?: string | null; instapay_no?: string | null; instapay_to?: 'account' | 'wallet' | null;
};

/** The starting list (migration 050 puts it in settings, where new types are added). */
export const DEFAULT_VENDOR_TYPES = ['Plumbing', 'Electricity', 'Carpentry', 'Painting', 'HVAC', 'Gypsum', 'Flooring', 'Glass and aluminium', 'Furniture', 'Materials supplier', 'Other'];
export async function vendorTypes(): Promise<string[]> {
  const s = await getSettings();
  return Array.isArray(s.cats?.vendor_type) ? s.cats.vendor_type : DEFAULT_VENDOR_TYPES;
}

async function mayEdit(user: User, kind: PartyKind) {
  if (hasRole(user, 'finance')) return;
  if (kind !== 'customer' && await isProcurement(user)) return;
  throw new RuleError('Only Finance, or Procurement for vendors and subcontractors, can change this list.');
}

/** Cleans the form: a vendor's payment details are either the bank's or InstaPay's, never half of each. A new type joins the list. */
async function fields(kind: PartyKind, i: PartyInput) {
  const t = (v: string | null | undefined) => (v ?? '').trim() || null;
  const name = t(i.name);
  if (!name) throw new RuleError('Enter a name.');
  const base = { name, phone: t(i.phone), email: t(i.email), tax_id: t(i.tax_id), wht_rate: Number(i.wht_rate) || 0 };
  if (kind === 'customer') return { ...base, bank_name: t(i.bank_name), account_no: t(i.account_no), iban: t(i.iban) };
  let type = t(i.new_type) ?? (i.vendor_type === '+' ? null : t(i.vendor_type));
  if (t(i.new_type)) {
    const list = await vendorTypes();
    const same = list.find(x => x.toLowerCase() === type!.toLowerCase());
    if (same) type = same;
    else await sql`update settings set cats = jsonb_set(cats, '{vendor_type}', ${sql.json([...list, type!])}) where id = 1`;
  }
  const method = i.pay_method === 'instapay' ? 'instapay' : i.pay_method === 'bank' ? 'bank' : null;
  if (method === 'instapay') {
    if (!t(i.instapay_no)) throw new RuleError('Enter the InstaPay number.');
    if (i.instapay_to !== 'account' && i.instapay_to !== 'wallet') throw new RuleError('Choose where the InstaPay transfer goes: bank account or wallet.');
  }
  return {
    ...base, vendor_type: type, pay_method: method, is_sub: kind === 'sub',
    bank_name: method === 'bank' ? t(i.bank_name) : null, account_no: method === 'bank' ? t(i.account_no) : null, iban: method === 'bank' ? t(i.iban) : null,
    instapay_no: method === 'instapay' ? t(i.instapay_no) : null, instapay_to: method === 'instapay' ? i.instapay_to! : null,
  };
}

export async function addParty(user: User, kind: PartyKind, i: PartyInput) {
  await mayEdit(user, kind);
  const v = await fields(kind, i);
  return sql.begin(async tx => {
    const type = kind === 'customer' ? 'customer' : 'vendor';
    const prefix = kind === 'customer' ? 'CU' : kind === 'sub' ? 'SC' : 'VC';
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(max(substring(code from 3)::int), 0) + 1 n from parties where code ~ ${'^' + prefix + '[0-9]+$'}`;
    const [p] = await tx<{ id: string }[]>`insert into parties ${tx({ ...v, type, code: prefix + String(n).padStart(4, '0') })} returning id`;
    await audit(tx, user, 'party', p.id, 'Created');
    return p.id;
  });
}

export async function updateParty(user: User, id: string, i: PartyInput) {
  const [p] = await sql<{ type: 'customer' | 'vendor'; is_sub: boolean }[]>`select type, is_sub from parties where id = ${id}`;
  if (!p) throw new RuleError('Not found.');
  const kind: PartyKind = p.type === 'customer' ? 'customer' : p.is_sub ? 'sub' : 'vendor';
  await mayEdit(user, kind);
  const v = await fields(kind, i);
  await sql.begin(async tx => {
    await tx`update parties set ${tx(v)} where id = ${id}`;
    await audit(tx, user, 'party', id, 'Edited');
  });
}

/** A vendor becomes a subcontractor or back (same books, other tab). */
export async function setSubcontractor(user: User, id: string, sub: boolean) {
  await mayEdit(user, 'vendor');
  const n = await sql`update parties set is_sub = ${sub} where id = ${id} and type = 'vendor'`;
  if (!n.count) throw new RuleError('Only a vendor can be moved between Vendors and Subcontractors.');
}

/** "InstaPay · 01xxxxxxxxx · wallet" or "Bank · CIB": how the vendor is paid, for lists. Never the account number. */
export const payLabel = (p: { pay_method: string | null; bank_name: string | null; instapay_no: string | null; instapay_to: string | null }) =>
  p.pay_method === 'instapay' ? `InstaPay · ${p.instapay_no ?? ''}${p.instapay_to ? ` · ${p.instapay_to === 'wallet' ? 'wallet' : 'bank account'}` : ''}`
  : p.pay_method === 'bank' || p.bank_name ? `Bank${p.bank_name ? ` · ${p.bank_name}` : ''}` : '';

/** The boxes of the add and edit forms, read the same way by both. */
export function partyFromForm(form: FormData): PartyInput {
  const v = (k: string) => String(form.get(k) ?? '').trim() || null;
  return { name: v('name') ?? '', phone: v('phone'), email: v('email'), tax_id: v('tax_id'), wht_rate: parseAmount(v('wht_rate')), vendor_type: v('vendor_type'), new_type: v('new_type'),
    pay_method: v('pay_method') as PartyInput['pay_method'], bank_name: v('bank_name'), account_no: v('account_no'), iban: v('iban'), instapay_no: v('instapay_no'), instapay_to: v('instapay_to') as PartyInput['instapay_to'] };
}
