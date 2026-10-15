import { requireUser } from '@/lib/auth';
import { formLists } from '@/lib/form-data';
import { PRForm } from '@/components/PRForm';
import { unpaidBills } from '@/lib/purchasing';
import { savePRAction } from '../actions';
import { raiseRequestAction } from '../../claims/actions';
import { listSubClaims } from '@/lib/claims';
import { today } from '@/lib/dates';

export default async function NewPR() {
  await requireUser();
  const [lists, bills, claims] = await Promise.all([formLists(), unpaidBills(), listSubClaims({ status: 'finance' })]);
  return (
    <>
      <div className="head"><div><h1>Pay a vendor or subcontractor</h1><p>إذن صرف · type the vendor, then tick its recorded invoices or claims · paid by bank transfer · goes to the head of its department (a project: the head of Engineering), then to Management.</p></div></div>
      <PRForm {...lists} bills={bills} claims={claims.map(c => ({ id: c.id, no: c.no, vendor_id: c.vendor_id, claim_no: c.claim_no, code: c.code, gross: c.gross }))} raiseClaim={raiseRequestAction} save={savePRAction} initial={{
        date: today(), due: '', party: '', assign: '', costType: 'Opex', ref: '', requester: '',
        vatRate: '0', whtRate: '0', siRate: '0', retRate: '0', dpAmount: '0', lines: [{ assign: '', acc: '', desc: '', qty: '1', price: '' }] }} />
    </>
  );
}
