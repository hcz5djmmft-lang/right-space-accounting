import { requireUser } from '@/lib/auth';
import { listParties, listProjects } from '@/lib/queries';
import { collectionTypes } from '@/lib/collections';
import { InvoiceForm } from '@/components/InvoiceForm';
import { saveInvoiceAction } from '../actions';
import { today } from '@/lib/dates';

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ customer?: string; project?: string }> }) {
  await requireUser('finance');
  const { customer = '', project = '' } = await searchParams;
  const [types, projects, parties] = await Promise.all([collectionTypes(), listProjects(), listParties()]);
  return (
    <>
      <div className="head"><div><h1>New sales invoice</h1><p>Design, fit-out or furniture: the type decides the collection code. Posting debits the client's account and credits revenue and output VAT.</p></div></div>
      <InvoiceForm types={types} projects={projects} customers={parties.filter(p => p.type === 'customer')} save={saveInvoiceAction} initial={{
        date: today(), due: '', party: customer, project, category: '', ref: '', vatRate: '14',
        lines: [{ desc: '', qty: '1', price: '' }] }} />
    </>
  );
}
