import { requireUser } from '@/lib/auth';
import { formLists } from '@/lib/form-data';
import { PRForm } from '@/components/PRForm';
import { savePRAction } from '../actions';

export default async function NewPR() {
  await requireUser();
  const lists = await formLists();
  return (
    <>
      <div className="head"><div><h1>New payment request</h1><p>إذن صرف · goes to Finance, then Engineering, then Management.</p></div></div>
      <PRForm {...lists} save={savePRAction} initial={{
        date: new Date().toISOString().slice(0, 10), due: '', party: '', assign: '', costType: 'Opex', ref: '', requester: '',
        vatRate: '0', whtRate: '0', siRate: '0', retRate: '0', dpAmount: '0', lines: [{ assign: '', acc: '', desc: '', qty: '1', price: '' }] }} />
    </>
  );
}
