import { CONTRACT_TYPES, WORK_LOCATIONS, type EmployeeFile } from '@/lib/hr';
import type { Dept, Proj } from '@/lib/queries';

/** The personal, job and contract fields of an employee file (server-rendered; salary lives under Payroll). */
export function EmployeeFileFields({ e, departments, projects, isNew }: { e?: Partial<EmployeeFile>; departments: Dept[]; projects: Proj[]; isNew?: boolean }) {
  const inp = (name: keyof EmployeeFile, label: string, extra: Record<string, unknown> = {}) => (
    <label className="f"><span>{label}</span><input className="inp" name={name} defaultValue={(e?.[name] as string | null | undefined) ?? ''} dir="auto" {...extra} /></label>);
  const pick = (name: keyof EmployeeFile, label: string, list: readonly (readonly [string, string])[], blank = '—') => (
    <label className="f"><span>{label}</span><select className="inp" name={name} defaultValue={(e?.[name] as string | null | undefined) ?? ''}>
      {blank && <option value="">{blank}</option>}{list.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>);
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Job</h2>
      <div className="grid g3">
        {isNew ? inp('code', 'Employee code', { className: 'inp mono', placeholder: 'Blank = next number' }) : <label className="f"><span>Employee code</span><input className="inp mono" value={e?.code ?? ''} disabled /></label>}
        {inp('name', 'Full name', { required: true })}
        {inp('job_title', 'Job title')}
        <label className="f"><span>Department</span><select className="inp" name="dept_id" defaultValue={e?.dept_id ?? ''}><option value="">—</option>{departments.filter(d => d.active || d.id === e?.dept_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="f"><span>Project (site staff and designers)</span><select className="inp" name="project_id" defaultValue={e?.project_id ?? ''}><option value="">—</option>{projects.filter(p => !p.is_office && (p.status !== 'Closed' || p.id === e?.project_id)).map(p => <option key={p.id} value={p.id}>{p.code === p.name ? p.name : `${p.code} · ${p.name}`}</option>)}</select></label>
        {pick('work_location', 'Works at', WORK_LOCATIONS, '')}
        {inp('hire_date', 'Hire date', { type: 'date' })}
        {pick('contract_type', 'Contract type', CONTRACT_TYPES)}
        {inp('contract_start', 'Contract start', { type: 'date' })}
        {inp('contract_end', 'Contract end (fixed term)', { type: 'date' })}
        {inp('probation_end', 'Probation ends', { type: 'date' })}
        {inp('insurance_no', 'Social insurance number', { className: 'inp mono' })}
      </div>
      <h2>Personal</h2>
      <div className="grid g3">
        {inp('national_id', 'National ID number', { className: 'inp mono', inputMode: 'numeric' })}
        {inp('birth_date', 'Date of birth', { type: 'date' })}
        {pick('gender', 'Gender', [['male', 'Male'], ['female', 'Female']])}
        {inp('phone', 'Mobile phone', { type: 'tel', inputMode: 'tel' })}
        {inp('personal_email', 'Email', { type: 'email' })}
        {inp('address', 'Address')}
        {inp('emergency_name', 'Emergency contact')}
        {inp('emergency_phone', 'Emergency phone', { type: 'tel', inputMode: 'tel' })}
        <label className="f" style={{ gridColumn: '1 / -1' }}><span>Notes</span><input className="inp" name="notes" dir="auto" defaultValue={e?.notes ?? ''} /></label>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Office staff clock in only at the office; site staff clock in anywhere and HR sees where. The place is also used by attendance (coming next).</p>
    </>
  );
}
