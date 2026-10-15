import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { ROLES, type Role, resolveUser } from '@/lib/roles';
import { AREAS, AREA_HEADINGS, accessFromRoles, rolesFromAccess } from '@/lib/access';
import { sql } from '@/lib/db';
import { getSettings } from '@/lib/books';
import { getSteps, isHeadStep } from '@/lib/documents';
import { GROUPS, POSITIONS } from '@/lib/org-chart';
import { positionHolders } from '@/lib/org';
import { ConfirmButton } from '@/components/ConfirmButton';
import { addDepartment, addUser, deleteUser, importStaffAction, resetPassword, saveCompany, saveDepartment, savePositionsAction, saveSteps, updateUser } from './actions';

type Dept = { id: string; code: string; name: string; parent_name: string | null; head_user_id: string | null; roles: Role[]; active: boolean; members: number };

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const me = await requireUser('management');
  const { saved, error } = await searchParams;
  const flash = (await cookies()).get('rsa_flash')?.value; // a temporary password, set by actions.ts for one minute
  const [s, steps, users, depts, holders] = await Promise.all([
    getSettings(), getSteps(),
    sql<{ id: string; email: string; name: string; roles: Role[]; access: string[] | null; dept_roles: string[] | null; dept_id: string | null; active: boolean }[]>`
      select u.id, u.email, u.name, u.roles, u.access, d.roles || coalesce(p.roles, '{}') dept_roles, u.dept_id, u.active
      from users u left join departments d on d.id = u.dept_id and d.active left join departments p on p.id = d.parent_id and p.active order by u.active desc, u.name`,
    sql<Dept[]>`select d.id, d.code, d.name, p.name parent_name, d.head_user_id, d.roles, d.active, (select count(*)::int from users u where u.dept_id = d.id and u.active) members
      from departments d left join departments p on p.id = d.parent_id order by d.active desc, coalesce(p.code, d.code), d.parent_id nulls first, d.code`,
    positionHolders(),
  ]);
  const active = users.filter(u => u.active);
  const roleTicks = (name: string, picked: readonly Role[]) => (Object.keys(ROLES) as Role[]).map(r => (
    <label key={r} className="row" style={{ fontSize: 13, gap: 3 }}><input type="checkbox" name={name} value={r} defaultChecked={picked.includes(r)} />{ROLES[r].split(' ')[0]}</label>));
  // what each person may open today: their ticks, or (never set one by one) what their roles and department gave
  const accessOf = (u: (typeof users)[number]) => resolveUser({ roles: u.roles, access: u.access }, u.dept_roles, accessFromRoles, rolesFromAccess);
  const accessTicks = (picked: readonly string[], management: boolean) => (
    <span className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
      <label className="row" style={{ fontSize: 13, gap: 3 }}><input type="checkbox" name="management" defaultChecked={management} /><b>Management (everything)</b></label>
      {AREA_HEADINGS.map(h => (
        <span key={h} className="row" style={{ fontSize: 13, gap: 6 }}><span className="muted">{h}:</span>
          {AREAS.filter(a => a.heading === h).map(a => <label key={a.key} className="row" style={{ gap: 3 }} title={a.label}><input type="checkbox" name="access" value={a.key} defaultChecked={picked.includes(a.key)} />{a.label.split(',')[0]}</label>)}</span>))}
    </span>);
  const deptSelect = (name: string, value: string | null) => (
    <select className="inp" name={name} defaultValue={value ?? ''} style={{ maxWidth: 180 }}>
      <option value="">No department</option>{depts.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.parent_name ? `${d.parent_name} › ${d.name}` : d.name}</option>)}</select>);
  return (
    <>
      <div className="head"><div><h1>Settings</h1><p>Only Management sees this page. Every change here is recorded with who made it.</p></div><Link className="btn" href="/settings/audit">Audit log</Link></div>
      {flash && <div className="msg good" style={{ whiteSpace: 'pre-line' }}>{flash}</div>}
      {saved && <div className="msg good">{saved}</div>}
      {error && <div className="msg bad">{error}</div>}

      <form action={saveSteps} className="card">
        <h2>Approvals for payment requests</h2>
        <p className="muted" style={{ marginTop: 0 }}>A request is signed first by the head of its department (a project&apos;s request by the head of Engineering, set under Departments below), then by Management.
          Tick who gives the final approval; with nobody ticked, anyone in Management can.</p>
        <div className="grid g3">{steps.filter(st => !isHeadStep(st)).map(st => (
          <fieldset key={st.position} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
            <legend><b>{st.name} · final approval</b></legend>
            {active.map(u => <label key={u.id} className="row" style={{ fontSize: 14 }}>
              <input type="checkbox" name={'step_' + st.position} value={u.id} defaultChecked={st.user_ids.includes(u.id)} /> {u.name}</label>)}
          </fieldset>))}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Save approvers</button></div>
      </form>

      <div className="card">
        <h2>Departments</h2>
        <p className="muted" style={{ marginTop: 0 }}>Each department is a group: its head signs its payment requests and petty cash, and assigns its tasks. &quot;Members can&quot; still applies to a person whose sub-categories were never ticked under People.
          People join a department under People below. Projects are separate from departments and belong to Engineering.</p>
        <div className="tw" style={{ marginBottom: 12 }}><table>
          <thead><tr><th>Code</th><th>Name</th><th>Head</th><th>Members can</th><th className="hide-sm">Members</th><th>Active</th><th></th></tr></thead>
          <tbody>{depts.map(d => (
            <tr key={d.id}><td colSpan={7} style={{ padding: 0 }}>
              <form action={saveDepartment.bind(null, d.id)} className="row" style={{ padding: '8px 10px', justifyContent: 'space-between' }}>
                <span className="mono" style={{ minWidth: 48 }} title={d.parent_name ? `Section of ${d.parent_name}` : undefined}>{d.parent_name ? '↳ ' : ''}{d.code}</span>
                <input className="inp" name="name" defaultValue={d.name} style={{ maxWidth: 180 }} />
                <select className="inp" name="head" defaultValue={d.head_user_id ?? ''} style={{ maxWidth: 180 }}>
                  <option value="">No head yet (Management signs)</option>{active.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                <span className="row">{roleTicks('droles', d.roles)}</span>
                <span className="hide-sm muted">{d.members}</span>
                <label className="row" style={{ fontSize: 13 }}><input type="checkbox" name="active" defaultChecked={d.active} /> Active</label>
                <button className="btn sm">Save</button>
              </form></td></tr>))}
          </tbody></table></div>
        <form action={addDepartment} className="row">
          <input className="inp" name="code" placeholder="Code" style={{ width: 100 }} required />
          <input className="inp" name="name" placeholder="Department name" style={{ flex: 1, minWidth: 160 }} required />
          <button className="btn">Add department</button>
        </form>
      </div>

      <div className="card">
        <h2>People</h2>
        <p className="muted" style={{ marginTop: 0 }}>Everyone gets Overview, Clock in, Leave, Approvals, Tasks, New purchase request and My account. Tick the sub-categories each person may open
          (a designer gets Engineering &gt; Design only); Management opens everything. The department decides who signs the person&apos;s requests.</p>
        <div className="tw" style={{ marginBottom: 12 }}><table>
          <thead><tr><th>Name</th><th className="hide-sm">Email</th><th>Department</th><th>May open</th><th>Active</th><th></th></tr></thead>
          <tbody>{users.map(u => {
            const a = accessOf(u);
            return (
            <tr key={u.id} style={u.active ? undefined : { opacity: 0.6 }}><td colSpan={6} style={{ padding: 0 }}>
              <form action={updateUser.bind(null, u.id)} style={{ padding: '8px 10px' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <input className="inp" name="name" defaultValue={u.name} style={{ maxWidth: 200 }} />
                  <span className="hide-sm muted" style={{ minWidth: 180 }}>{u.email}</span>
                  {deptSelect('dept', u.dept_id)}
                  <label className="row" style={{ fontSize: 13 }}><input type="checkbox" name="active" defaultChecked={u.active} /> Active <span className="muted">(untick and Save to stop the login)</span></label>
                  <span className="row"><button className="btn sm">Save</button>
                    {u.id !== me.id && <button className="btn sm" formAction={resetPassword.bind(null, u.id)}>Reset password</button>}
                    {u.id !== me.id && <ConfirmButton action={deleteUser.bind(null, u.id)} label="Delete" question={`Delete ${u.name}'s login? If they already have records in the system the login is stopped instead.`} />}</span>
                </div>
                <div style={{ marginTop: 6 }}>{accessTicks(a.access, a.roles.includes('management'))}</div>
              </form></td></tr>);
          })}
          </tbody></table></div>
        <form action={addUser}>
          <div className="grid g3" style={{ alignItems: 'end' }}>
            <label className="f"><span>Name</span><input className="inp" name="name" required /></label>
            <label className="f"><span>Email</span><input className="inp" name="email" type="email" required /></label>
            <label className="f"><span>Department</span>{deptSelect('dept', null)}</label>
          </div>
          <div style={{ margin: '8px 0' }}>{accessTicks([], false)}</div>
          <button className="btn pri">Add person</button>
        </form>
        <form action={importStaffAction} className="row" style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <span style={{ flex: 1, minWidth: 220 }}><b>Create logins from the staff sheet</b><br /><span className="muted" style={{ fontSize: 13 }}>The Excel sheet with Emp ID, Full Name and Email. Each person gets the access you set for them, the departments get their heads and the org chart its holders; the temporary passwords show here once.</span></span>
          <input className="inp" type="file" name="sheet" accept=".xlsx,.csv" required style={{ maxWidth: 260 }} />
          <button className="btn pri">Create logins</button>
        </form>
      </div>

      <form action={savePositionsAction} className="card">
        <h2>Org chart</h2>
        <p className="muted" style={{ marginTop: 0 }}>Who holds each position of the company&apos;s org chart. The engineering workflows use them: a drawing set goes to the head of design, then the technical office head, then the director of engineering; purchases to the head of procurement. One person can hold several positions.</p>
        <div className="grid g2">{GROUPS.map(g => (
          <fieldset key={g} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
            <legend><b>{g}</b></legend>
            {POSITIONS.filter(p => p.group === g).map(p => (
              <div key={p.key} className="f" style={{ marginBottom: 8 }}><span>{p.label}</span>
                {p.single ? (
                  <select className="inp" name={`pos_${p.key}`} defaultValue={holders[p.key]?.[0]?.id ?? ''}><option value="">Nobody yet</option>{active.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                ) : (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>{active.map(u => <label key={u.id} className="row" style={{ fontSize: 13, gap: 3 }}><input type="checkbox" name={`pos_${p.key}`} value={u.id} defaultChecked={holders[p.key]?.some(h => h.id === u.id)} />{u.name}</label>)}</div>)}
              </div>))}
          </fieldset>))}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Save org chart</button></div>
      </form>

      <form action={saveCompany} className="card">
        <h2>Company rules</h2>
        <div className="grid g3">
          <label className="f"><span>Company name</span><input className="inp" name="company_name" defaultValue={s.company_name} /></label>
          <label className="f"><span>Tax registration no. (on WHT certificates)</span><input className="inp mono" name="company_tax_id" defaultValue={s.company_tax_id} /></label>
          <label className="f"><span>Standard VAT %</span><input className="inp mono" name="vat_rate" defaultValue={s.vat_rate} inputMode="decimal" /></label>
          <label className="f"><span>Payment request prefix</span><input className="inp mono" name="pr_prefix" defaultValue={s.pr_prefix} /></label>
          <label className="f"><span>Books locked up to (no posting on or before) · <a href="/close">Month-end close</a></span><input className="inp" type="date" name="lock_date" defaultValue={s.lock_date ?? ''} /></label>
          <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="require_approval" defaultChecked={s.require_approval} /> Entries by non-Finance staff need approval</label>
          <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="require_cc" defaultChecked={s.require_cc} /> Every expense must have a project or department</label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Save company rules</button></div>
      </form>
    </>
  );
}
