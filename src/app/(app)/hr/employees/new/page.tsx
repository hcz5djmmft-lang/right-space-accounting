import { requireUser } from '@/lib/auth';
import { listDepartments, listProjects } from '@/lib/queries';
import { EmployeeFileFields } from '@/components/EmployeeFileFields';
import { createFileAction } from '../../actions';

export default async function NewEmployeeFile({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser('hr', 'finance');
  const { error } = await searchParams;
  const [departments, projects] = await Promise.all([listDepartments(), listProjects()]);
  return (
    <>
      <div className="head"><div><h1>New employee</h1><p>Save the file first; the documents, the login and the salary come on the file&apos;s own page.</p></div></div>
      {error && <div className="msg bad">{error}</div>}
      <form action={createFileAction} className="card">
        <EmployeeFileFields departments={departments} projects={projects} isNew />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn pri">Create employee file</button></div>
      </form>
    </>
  );
}
