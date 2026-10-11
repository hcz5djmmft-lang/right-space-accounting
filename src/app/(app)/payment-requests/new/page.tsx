import { requireUser } from '@/lib/auth';
import { formLists } from '@/lib/form-data';
import { PRForm } from '@/components/PRForm';
import { unpaidBills } from '@/lib/purchasing';
import { savePRAction } from '../actions';
import { today } from '@/lib/dates';

export default async function NewPR() {
  await requireUser();
  const [lists, bills] = await Promise.all([formLists(), unpaidBills()]);
  return (
    <>
      <div className="head"><div><h1>New payment request</h1><p>إذن صرف · paid by bank transfer · goes to the head of its department (a project: the head of Engineering), then to Management.</p></div></div>
      <PRForm {...lists} bills={bills} save={savePRAction} initial={{
        date: today(), due: '', party: '', assign: '', costType: 'Opex', ref: '', requester: '',
        vatRate: '0', whtRate: '0', siRate: '0', retRate: '0', dpAmount: '0', lines: [{ assign: '', acc: '', desc: '', qty: '1', price: '' }] }} />
    </>
  );
}
