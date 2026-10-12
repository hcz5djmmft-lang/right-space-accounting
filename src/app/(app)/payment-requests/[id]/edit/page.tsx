import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { formLists } from '@/lib/form-data';
import { getPR, getPRLines } from '@/lib/pr-queries';
import { requestBills } from '@/lib/documents';
import { PRForm } from '@/components/PRForm';
import { unpaidBills } from '@/lib/purchasing';
import { savePRAction } from '../../actions';

const asg = (p: string | null, d: string | null) => (p ? 'p:' + p : d ? 'd:' + d : '');

export default async function EditPR({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const r = await getPR(id);
  if (!r) notFound();
  if (!['draft', 'rejected'].includes(r.status)) redirect('/payment-requests/' + id);
  const [lists, lines, bills, mine] = await Promise.all([formLists(), getPRLines(id), unpaidBills(), requestBills(id)]);
  const s = (n: number) => String(n ?? 0);
  return (
    <>
      <div className="head"><div><h1>Edit {r.no}</h1><p>Submitting again restarts the approvals from the department head.</p></div></div>
      <PRForm {...lists} bills={bills} save={savePRAction} initial={{ bills: mine.map(b => b.id),
        id, date: r.date, due: r.due ?? '', party: r.party_id, assign: asg(r.project_id, r.dept_id), costType: r.cost_type ?? '', ref: r.ref, requester: r.requester ?? '',
        vatRate: s(r.vat_rate), whtRate: s(r.wht_rate), siRate: s(r.si_rate), retRate: s(r.ret_rate), dpAmount: s(r.dp_amount),
        lines: lines.map(l => ({ assign: asg(l.project_id, l.dept_id), acc: l.account, desc: l.description, qty: s(l.qty), price: s(l.price) })) }} />
    </>
  );
}
