import { requireUser } from '@/lib/auth';
import { canPostDirect, getSettings } from '@/lib/books';
import { listAccounts, listDepartments, listParties, listProjects } from '@/lib/queries';
import { EntryForm } from '@/components/EntryForm';
import { saveEntryAction } from '../actions';

export default async function NewEntry({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const user = await requireUser();
  const { type } = await searchParams;
  const [settings, accounts, projects, departments, parties] = await Promise.all([getSettings(), listAccounts(), listProjects(), listDepartments(), listParties()]);
  const kind = type === 'collection' || type === 'transfer' ? type : 'expense';
  const bank = accounts.find(a => a.is_bank && a.postable)?.code ?? '';
  return (
    <>
      <div className="head"><div><h1>New entry</h1><p>Pick the project or department on each line; the debit and credit lines are built for you.</p></div></div>
      <EntryForm
        initial={{ date: new Date().toISOString().slice(0, 10), ref: '', memo: '', type: kind, bank, toBank: '', party: '', vatRate: '0', amount: '',
          items: [{ assign: '', acc: kind === 'collection' ? 'R110' : '', desc: '', amount: '' }] }}
        accounts={accounts} projects={projects} departments={departments} parties={parties}
        arCode={settings.account_map.ar ?? 'A130'} canPost={canPostDirect(user, settings)} save={saveEntryAction} />
    </>
  );
}
