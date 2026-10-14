import { requireUser } from '@/lib/auth';
import { formLists } from '@/lib/form-data';
import { today } from '@/lib/dates';
import { paidFromOptions } from '@/lib/expenses';
import { ExpenseForm } from '@/components/ExpenseForm';
import { newExpenseAction } from '../actions';

export default async function NewExpense() {
  await requireUser();
  const [lists, paidFrom] = await Promise.all([formLists(), paidFromOptions()]);
  return (
    <>
      <div className="head"><div><h1>New expense</h1><p>Take a photo of the receipt, fill in the rest and send it. The head of the department approves it, then Management; it posts when approved.</p></div></div>
      <ExpenseForm accounts={lists.accounts} projects={lists.projects} departments={lists.departments} paidFrom={paidFrom} save={newExpenseAction}
        initial={{ date: today(), amount: '', assign: '', account: '', description: '', paid_from: '' }} />
    </>
  );
}
