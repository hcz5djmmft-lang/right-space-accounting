import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/books';
import { listDepartments, listProjects } from '@/lib/queries';
import { getEmployee } from '@/lib/payroll';
import { rates } from '@/lib/payroll-calc';
import { EmployeeForm } from '@/components/EmployeeForm';
import { deleteEmployeeAction, saveEmployeeAction } from '../../actions';

export default async function EditEmployee({ params }: { params: Promise<{ id: string }> }) {
  await requireUser('finance');
  const { id } = await params;
  const e = await getEmployee(id);
  if (!e) notFound();
  const [projects, departments, settings] = await Promise.all([listProjects(), listDepartments(), getSettings()]);
  const s = (n: number | null) => (n ? String(n) : '');
  return (
    <>
      <div className="head"><div><h1>{e.name}</h1><p>{e.code}{e.job_title ? ` · ${e.job_title}` : ''}{e.in_runs ? ' · in payroll runs' : ''}</p></div></div>
      <EmployeeForm projects={projects} departments={departments} rates={rates(settings.payroll)} inRuns={e.in_runs} save={saveEmployeeAction} remove={deleteEmployeeAction.bind(null, id)}
        initial={{ id, code: e.code ?? '', name: e.name, job_title: e.job_title ?? '', dept_id: e.dept_id ?? '', project_id: e.project_id ?? '', hire_date: e.hire_date ?? '',
          basic: s(e.basic), allowances: s(e.allowances), insurable: s(e.insurable), no_deductions: e.no_deductions, bank_account: e.bank_account ?? '', active: e.active }} />
    </>
  );
}
