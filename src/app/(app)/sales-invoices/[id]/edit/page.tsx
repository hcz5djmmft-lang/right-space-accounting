import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listAccounts, listParties, listProjects } from '@/lib/queries';
import { getInvoice, getInvoiceLines } from '@/lib/sales-queries';
import { InvoiceForm } from '@/components/InvoiceForm';
import { saveInvoiceAction } from '../../actions';

export default async function EditInvoice({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('finance');
  const { id } = await params;
  const r = await getInvoice(id);
  if (!r) notFound();
  if (r.status !== 'draft') redirect('/sales-invoices/' + id);
  const [accounts, projects, parties, lines] = await Promise.all([listAccounts(), listProjects(), listParties(), getInvoiceLines(id)]);
  const s = (n: number) => String(n ?? 0);
  return (
    <>
      <div className="head"><div><h1>Edit {r.no}</h1><p>Draft invoice</p></div></div>
      <InvoiceForm accounts={accounts} projects={projects} customers={parties.filter(p => p.type === 'customer')} save={saveInvoiceAction} initial={{
        id, date: r.date, due: r.due ?? '', party: r.party_id, project: r.project_id ?? '', ref: r.ref, vatRate: s(r.vat_rate),
        lines: lines.map(l => ({ acc: l.account, desc: l.description, qty: s(l.qty), price: s(l.price) })) }} />
    </>
  );
}
