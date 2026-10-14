import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { today } from '@/lib/dates';
import { canSign, getSteps, stepLabel } from '@/lib/documents';
import { getExpense, paidFromOptions } from '@/lib/expenses';
import { listAttachments } from '@/lib/attachments';
import { formLists } from '@/lib/form-data';
import { Attachments } from '@/components/Attachments';
import { ExpenseForm } from '@/components/ExpenseForm';
import { approveExpenseAction, cancelExpenseAction, correctExpenseAction, reimburseExpenseAction, returnExpenseAction } from '../actions';

export default async function ExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { ok, error } = await searchParams;
  const x = await getExpense(id);
  if (!x) notFound();
  const fin = hasRole(user, 'finance'), mine = x.created_by === user.id;
  const [steps, files, signed, banks] = await Promise.all([
    getSteps(), listAttachments('expense', id),
    sql<{ step_name: string; who: string | null; at: string }[]>`select a.step_name, u.name who, to_char(a.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at from expense_approvals a left join users u on u.id = a.user_id where a.expense_id = ${id} order by a.step`,
    fin ? sql<{ code: string; name: string }[]>`select code, name from accounts where is_bank and postable and type = 'asset' order by code` : [],
  ]);
  const step = x.status === 'pending' ? steps[x.signed] : undefined;
  const mySign = !!step && canSign(user, step, x) && (!mine || hasRole(user, 'management'));
  const correcting = x.status === 'rejected' && (mine || fin);
  const lists = correcting ? await formLists() : null;
  const paidFrom = correcting ? await paidFromOptions() : [];
  return (
    <>
      <div className="head"><div><h1>{x.no}</h1><p dir="auto">{x.description} · {x.who} · {x.date}</p></div><Link className="btn" href="/expenses">All expenses</Link></div>
      {ok && <div className="msg good">{ok}</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Amount</div><div className="v mono">{fmt(x.amount)}</div></div>
        <div className="tile"><div className="k">For</div><div className="v" style={{ fontSize: 16 }}>{x.project_code ?? x.dept_name}</div><div className="muted" style={{ fontSize: 12 }}>{x.account} · {x.account_name}</div></div>
        <div className="tile"><div className="k">Paid from</div><div className="v" style={{ fontSize: 16 }}>{x.paid_from_name}</div></div>
        <div className="tile"><div className="k">State</div><div className="v" style={{ fontSize: 16 }}>{x.status === 'pending' ? `Waiting for ${stepLabel(steps[x.signed], x)}` : x.status === 'rejected' ? 'Returned for changes' : x.status === 'posted' ? 'Approved and posted' : 'Cancelled'}</div>
          {x.entry_id && <div className="muted" style={{ fontSize: 12 }}>Entry <Link href={`/entries/${x.entry_id}`}>{x.entry_no}</Link></div>}</div>
      </div>
      <Attachments entity="expense" id={id} path={`/expenses/${id}`} items={files} userId={user.id} canRemove={fin} locked={x.status === 'posted'} />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Approvals</h2>
        {signed.length === 0 ? <p className="muted">No one has signed yet.</p> : <div className="log">{signed.map((s, i) => <div key={i}>{s.at} · {s.step_name} · {s.who}</div>)}</div>}
        {mySign && <div className="row" style={{ marginTop: 10, alignItems: 'end' }}>
          <form action={approveExpenseAction.bind(null, id)}><button className="btn pri">Approve</button></form>
          <form action={returnExpenseAction.bind(null, id)} className="row"><input className="inp" name="reason" placeholder="What needs changing" dir="auto" required /><button className="btn">Return</button></form>
        </div>}
        {(x.status === 'pending' || x.status === 'rejected') && (mine || fin) && <form action={cancelExpenseAction.bind(null, id)} style={{ marginTop: 10 }}><button className="btn sm bad">Cancel this expense</button></form>}
      </div>
      {fin && x.status === 'posted' && x.paid_from === 'own' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Reimbursement</h2>
          {x.reimbursed_entry_id ? <p>Reimbursed · entry <Link href={`/entries/${x.reimbursed_entry_id}`}>{x.reimbursed_no}</Link></p> : (
            <form action={reimburseExpenseAction.bind(null, id)} className="row" style={{ alignItems: 'end' }}>
              <label className="f"><span>Paid from</span><select className="inp" name="bank">{banks.map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</select></label>
              <label className="f"><span>Date</span><input className="inp" type="date" name="date" defaultValue={today()} /></label>
              <button className="btn pri">Record reimbursement of {fmt(x.amount)} to {x.who}</button>
            </form>)}
        </div>)}
      {correcting && lists && <>
        <h2>Correct and send again</h2>
        <ExpenseForm action={correctExpenseAction.bind(null, id)} accounts={lists.accounts} projects={lists.projects} departments={lists.departments} paidFrom={paidFrom} submitLabel="Send again"
            initial={{ date: x.date, amount: String(x.amount), assign: x.project_id ? 'p:' + x.project_id : 'd:' + x.dept_id, account: x.account, description: x.description, paid_from: x.paid_from }} />
      </>}
    </>
  );
}
