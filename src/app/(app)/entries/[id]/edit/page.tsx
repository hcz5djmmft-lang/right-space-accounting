import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { canPostDirect, getSettings } from '@/lib/books';
import { sql } from '@/lib/db';
import { listAccounts, listDepartments, listParties, listProjects } from '@/lib/queries';
import { EntryForm } from '@/components/EntryForm';
import type { EntryForm as Form } from '@/lib/ledger';
import { saveEntryAction } from '../../actions';

export default async function EditEntry({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [e] = await sql<{ id: string; date: string; ref: string; status: string; form: Form; kind: string }[]>`
    select id, to_char(date,'YYYY-MM-DD') date, ref, status, form, kind from journal_entries where id = ${id}`;
  if (!e) notFound();
  if (!['draft', 'rejected'].includes(e.status) || !['expense', 'collection', 'transfer'].includes(e.kind)) redirect(`/entries/${id}`);
  const [settings, accounts, projects, departments, parties] = await Promise.all([getSettings(), listAccounts(), listProjects(), listDepartments(), listParties()]);
  const f = e.form;
  return (
    <>
      <div className="head"><div><h1>Edit entry</h1></div></div>
      <EntryForm
        initial={{ id: e.id, date: e.date, ref: e.ref, memo: f.memo ?? '', type: e.kind as Form['type'], bank: f.bank ?? '', toBank: f.toBank ?? '',
          party: f.party ?? '', vatRate: String(f.vatRate ?? 0), amount: f.amount ? String(f.amount) : '',
          items: (f.items?.length ? f.items : [{ acc: '', amount: 0 }]).map(i => ({
            assign: i.project ? 'p:' + i.project : i.dept ? 'd:' + i.dept : '', acc: i.acc, desc: i.desc ?? '', amount: i.amount ? String(i.amount) : '' })) }}
        accounts={accounts} projects={projects} departments={departments} parties={parties}
        arCode={settings.account_map.ar ?? 'A130'} canPost={canPostDirect(user, settings)} save={saveEntryAction} />
    </>
  );
}
