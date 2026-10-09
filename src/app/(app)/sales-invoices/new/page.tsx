import { requireUser } from '@/lib/auth';
import { listAccounts, listParties, listProjects } from '@/lib/queries';
import { InvoiceForm } from '@/components/InvoiceForm';
import { saveInvoiceAction } from '../actions';

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ customer?: string; project?: string }> }) {
  await requireUser('finance');
  const { customer = '', project = '' } = await searchParams;
  const [accounts, projects, parties] = await Promise.all([listAccounts(), listProjects(), listParties()]);
  return (
    <>
      <div className="head"><div><h1>New sales invoice</h1><p>Posting debits the customer's account and credits revenue and output VAT.</p></div></div>
      <InvoiceForm accounts={accounts} projects={projects} customers={parties.filter(p => p.type === 'customer')} save={saveInvoiceAction} initial={{
        date: new Date().toISOString().slice(0, 10), due: '', party: customer, project, ref: '', vatRate: '14',
        lines: [{ acc: '', desc: '', qty: '1', price: '' }] }} />
    </>
  );
}
