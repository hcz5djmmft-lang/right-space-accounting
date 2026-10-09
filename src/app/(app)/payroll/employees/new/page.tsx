import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/books';
import { listDepartments, listProjects } from '@/lib/queries';
import { rates } from '@/lib/payroll-calc';
import { EmployeeForm } from '@/components/EmployeeForm';
import { saveEmployeeAction } from '../../actions';

export default async function NewEmployee() {
  await requireUser('finance');
  const [projects, departments, settings] = await Promise.all([listProjects(), listDepartments(), getSettings()]);
  return (
    <>
      <div className="head"><div><h1>New employee</h1><p>Salary figures are monthly, in EGP.</p></div></div>
      <EmployeeForm projects={projects} departments={departments} rates={rates(settings.payroll)} inRuns={false} save={saveEmployeeAction}
        initial={{ code: '', name: '', job_title: '', dept_id: '', project_id: '', hire_date: '', basic: '', allowances: '', insurable: '', bank_account: '', active: true }} />
    </>
  );
}
