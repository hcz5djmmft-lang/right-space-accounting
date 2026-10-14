import 'server-only';
import { sql } from './db';
import { r2 } from './money';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { audit, getSettings } from './books';
import { TZ, lastDay as monthEnd } from './dates';

// VAT return and WHT certificates (improvement 10). The monthly VAT 14% return: output VAT on the sales invoices posted
// in the month, input VAT on the vendor invoices and payment requests, any other VAT posted by typed entries or
// expenses, and the net to pay (or carry forward). Finance marks it prepared, which ticks it on the month-end close.
// WHT certificates: per supplier and period, the payments' base and the tax withheld, printed to PDF for the supplier.

export type VatDoc = { id: string; no: string; date: string; party: string; tax_id: string | null; base: number | null; vat: number; href: string };
export type VatReturn = {
  period: string; from: string; to: string; sales: VatDoc[]; purchases: VatDoc[]; otherOut: VatDoc[]; otherIn: VatDoc[];
  outputVat: number; inputVat: number; netVat: number; booksOut: number; booksIn: number; agrees: boolean;
  prepared: { by: string | null; at: string; output: number; input: number; net: number; changed: boolean } | null;
};

const docHref = (kind: string, id: string, po: string | null) => kind === 'sales' ? `/sales-invoices/${id}` : po ? `/purchasing/invoices/${id}` : `/payment-requests/${id}`;

export async function vatReturn(period: string): Promise<VatReturn> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new RuleError('Pick a month.');
  const s = await getSettings();
  const from = period + '-01', to = monthEnd(period), out = s.account_map.vatOut ?? '', inn = s.account_map.vatIn ?? '';
  const [docs, other, [gl], [saved]] = await Promise.all([
    sql<{ id: string; kind: string; no: string; date: string; party: string; tax_id: string | null; base: number; vat: number; po_id: string | null }[]>`
      select i.id, i.kind, i.no, to_char(i.date,'YYYY-MM-DD') date, coalesce(p.full_name, p.name) party, p.tax_id, i.subtotal::float base, i.vat::float vat, i.po_id
      from invoices i join parties p on p.id = i.party_id
      where i.status = 'posted' and i.vat <> 0 and i.date between ${from}::date and ${to}::date
        and not exists (select 1 from payment_request_bills b where b.request_id = i.id)
      order by i.date, i.no`,
    // VAT lines not from an invoice: typed expense entries with VAT, expense claims, adjustments
    sql<{ id: string; no: string; date: string; memo: string; party: string | null; tax_id: string | null; account: string; amount: number }[]>`
      select e.id, e.no, to_char(e.date,'YYYY-MM-DD') date, coalesce(nullif(l.description, ''), e.memo) memo, coalesce(p.full_name, p.name) party, p.tax_id, l.account,
        (case when l.account = ${out} then l.cr - l.dr else l.dr - l.cr end)::float amount
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' left join parties p on p.id = l.party_id
      where l.account in (${out}, ${inn}) and e.date between ${from}::date and ${to}::date
        and not exists (select 1 from invoices i where i.entry_id = e.id)
      order by e.date, e.no`,
    sql<{ out: number; inn: number }[]>`
      select coalesce(sum(case when l.account = ${out} then l.cr - l.dr end), 0)::float out, coalesce(sum(case when l.account = ${inn} then l.dr - l.cr end), 0)::float inn
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where l.account in (${out}, ${inn}) and e.date between ${from}::date and ${to}::date`,
    sql<{ by: string | null; at: string; output: number; input: number; net: number }[]>`
      select u.name by, to_char(v.prepared_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, v.output_vat::float output, v.input_vat::float input, v.net_vat::float net
      from vat_returns v left join users u on u.id = v.prepared_by where v.period = ${period}`,
  ]);
  const doc = (d: (typeof docs)[number]): VatDoc => ({ id: d.id, no: d.no, date: d.date, party: d.party, tax_id: d.tax_id, base: r2(d.base), vat: r2(d.vat), href: docHref(d.kind, d.id, d.po_id) });
  const oth = (o: (typeof other)[number]): VatDoc => ({ id: o.id, no: o.no, date: o.date, party: o.party ?? o.memo, tax_id: o.tax_id, base: null, vat: r2(o.amount), href: `/entries/${o.id}` });
  const sales = docs.filter(d => d.kind === 'sales').map(doc), purchases = docs.filter(d => d.kind === 'purchase').map(doc);
  const otherOut = other.filter(o => o.account === out && o.amount).map(oth), otherIn = other.filter(o => o.account === inn && o.amount).map(oth);
  const sum = (xs: VatDoc[]) => xs.reduce((t, x) => t + x.vat, 0);
  const outputVat = r2(sum(sales) + sum(otherOut)), inputVat = r2(sum(purchases) + sum(otherIn)), netVat = r2(outputVat - inputVat);
  const booksOut = r2(gl.out), booksIn = r2(gl.inn);
  return {
    period, from, to, sales, purchases, otherOut, otherIn, outputVat, inputVat, netVat, booksOut, booksIn,
    agrees: Math.abs(booksOut - outputVat) < 0.005 && Math.abs(booksIn - inputVat) < 0.005,
    prepared: saved ? { ...saved, changed: Math.abs(saved.net - netVat) >= 0.005 || Math.abs(saved.output - outputVat) >= 0.005 } : null,
  };
}

/** Finance marks the month's return prepared, keeping its figures. Marking again takes the current figures. */
export async function prepareVatReturn(user: User, period: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance prepares the VAT return.');
  const v = await vatReturn(period);
  await sql.begin(async tx => {
    await tx`insert into vat_returns (period, output_vat, input_vat, net_vat, prepared_by) values (${period}, ${v.outputVat}, ${v.inputVat}, ${v.netVat}, ${user.id})
      on conflict (period) do update set output_vat = excluded.output_vat, input_vat = excluded.input_vat, net_vat = excluded.net_vat, prepared_by = excluded.prepared_by, prepared_at = now()`;
    await audit(tx, user, 'vat-return', period, 'VAT return prepared', `output ${v.outputVat.toFixed(2)}, input ${v.inputVat.toFixed(2)}, net ${v.netVat.toFixed(2)}`);
  });
  return v;
}
export async function unprepareVatReturn(user: User, period: string) {
  if (!hasRole(user, 'finance')) throw new RuleError('Only Finance changes the VAT return.');
  await sql.begin(async tx => {
    const r = await tx`delete from vat_returns where period = ${period}`;
    if (r.count) await audit(tx, user, 'vat-return', period, 'VAT return marked not prepared');
  });
}

export type WhtSupplier = { party_id: string; party: string; full_name: string | null; tax_id: string | null; docs: number; base: number; wht: number };
export type WhtLine = { id: string; no: string; date: string; ref: string; base: number; rate: number; wht: number; href: string };

/** Suppliers with tax withheld from them in the period. */
export async function whtSuppliers(from: string, to: string) {
  return sql<WhtSupplier[]>`
    select p.id party_id, p.name party, p.full_name, p.tax_id, count(*)::int docs, sum(i.subtotal)::float base, sum(i.wht)::float wht
    from invoices i join parties p on p.id = i.party_id
    where i.kind = 'purchase' and i.status = 'posted' and i.wht > 0 and i.date between ${from}::date and ${to}::date
      and not exists (select 1 from payment_request_bills b where b.request_id = i.id)
    group by p.id order by p.name`;
}

/** One supplier's WHT certificate: who, the period, and each invoice or payment request with its base and the tax withheld. */
export async function whtCertificate(partyId: string, from: string, to: string) {
  const [[party], lines, s] = await Promise.all([
    sql<{ id: string; name: string; full_name: string | null; tax_id: string | null; code: string | null }[]>`select id, name, full_name, tax_id, code from parties where id = ${partyId}`,
    sql<{ id: string; no: string; date: string; ref: string; base: number; rate: number; wht: number; po_id: string | null }[]>`
      select i.id, i.no, to_char(i.date,'YYYY-MM-DD') date, i.ref, i.subtotal::float base, i.wht_rate::float rate, i.wht::float wht, i.po_id
      from invoices i where i.kind = 'purchase' and i.status = 'posted' and i.wht > 0 and i.party_id = ${partyId} and i.date between ${from}::date and ${to}::date
        and not exists (select 1 from payment_request_bills b where b.request_id = i.id)
      order by i.date, i.no`,
    getSettings(),
  ]);
  if (!party) return null;
  const rows: WhtLine[] = lines.map(l => ({ id: l.id, no: l.no, date: l.date, ref: l.ref, base: r2(l.base), rate: l.rate, wht: r2(l.wht), href: docHref('purchase', l.id, l.po_id) }));
  return { party, lines: rows, base: r2(rows.reduce((t, l) => t + l.base, 0)), wht: r2(rows.reduce((t, l) => t + l.wht, 0)), company: s.company_name, companyTaxId: s.company_tax_id };
}

/** The quarter (Egypt's WHT return period) a date falls in. */
export function quarterOf(date: string) {
  const y = date.slice(0, 4), q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  const from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  return { from, to: monthEnd(`${y}-${String(q * 3 + 3).padStart(2, '0')}`), label: `Q${q + 1} ${y}` };
}
