import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { ROLES, type Role } from '@/lib/roles';
import { sql } from '@/lib/db';
import { getSettings } from '@/lib/books';
import { getSteps, isHeadStep } from '@/lib/documents';
import { addDepartment, addUser, resetPassword, saveCompany, saveDepartment, saveSteps, updateUser } from './actions';

type Dept = { id: string; code: string; name: string; head_user_id: string | null; roles: Role[]; active: boolean; members: number };

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const me = await requireUser('management');
  const { saved, error } = await searchParams;
  const flash = (await cookies()).get('rsa_flash')?.value; // a temporary password, set by actions.ts for one minute
  const [s, steps, users, depts] = await Promise.all([
    getSettings(), getSteps(),
    sql<{ id: string; email: string; name: string; roles: Role[]; dept_id: string | null; active: boolean }[]>`select id, email, name, roles, dept_id, active from users order by active desc, name`,
    sql<Dept[]>`select d.id, d.code, d.name, d.head_user_id, d.roles, d.active, (select count(*)::int from users u where u.dept_id = d.id and u.active) members
      from departments d order by d.active desc, d.code`,
  ]);
  const active = users.filter(u => u.active);
  const roleTicks = (name: string, picked: readonly Role[]) => (Object.keys(ROLES) as Role[]).map(r => (
    <label key={r} className="row" style={{ fontSize: 13, gap: 3 }}><input type="checkbox" name={name} value={r} defaultChecked={picked.includes(r)} />{ROLES[r].split(' ')[0]}</label>));
  const deptSelect = (name: string, value: string | null) => (
    <select className="inp" name={name} defaultValue={value ?? ''} style={{ maxWidth: 180 }}>
      <option value="">No department</option>{depts.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>);
  return (
    <>
      <div className="head"><div><h1>Settings</h1><p>Only Management sees this page. Every change here is recorded with who made it.</p></div></div>
      {flash && <div className="msg good">{flash}</div>}
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
        <p className="muted" style={{ marginTop: 0 }}>Each department is a group: its head signs its payment requests, and &quot;members can&quot; is what everyone in it may do in the app.
          People join a department under People below. Projects are separate from departments and belong to Engineering.</p>
        <div className="tw" style={{ marginBottom: 12 }}><table>
          <thead><tr><th>Code</th><th>Name</th><th>Head</th><th>Members can</th><th className="hide-sm">Members</th><th>Active</th><th></th></tr></thead>
          <tbody>{depts.map(d => (
            <tr key={d.id}><td colSpan={7} style={{ padding: 0 }}>
              <form action={saveDepartment.bind(null, d.id)} className="row" style={{ padding: '8px 10px', justifyContent: 'space-between' }}>
                <span className="mono" style={{ minWidth: 48 }}>{d.code}</span>
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
        <p className="muted" style={{ marginTop: 0 }}>Everyone gets what their department&apos;s members can do; &quot;extra&quot; adds more for one person (Management may do anything).</p>
        <div className="tw" style={{ marginBottom: 12 }}><table>
          <thead><tr><th>Name</th><th className="hide-sm">Email</th><th>Department</th><th>Extra</th><th>Active</th><th></th></tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id}><td colSpan={6} style={{ padding: 0 }}>
              <form action={updateUser.bind(null, u.id)} className="row" style={{ padding: '8px 10px', justifyContent: 'space-between' }}>
                <input className="inp" name="name" defaultValue={u.name} style={{ maxWidth: 200 }} />
                <span className="hide-sm muted" style={{ minWidth: 180 }}>{u.email}</span>
                {deptSelect('dept', u.dept_id)}
                <span className="row">{roleTicks('roles', u.roles)}</span>
                <label className="row" style={{ fontSize: 13 }}><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                <span className="row"><button className="btn sm">Save</button>
                  {u.id !== me.id && <button className="btn sm" formAction={resetPassword.bind(null, u.id)}>Reset password</button>}</span>
              </form></td></tr>))}
          </tbody></table></div>
        <form action={addUser} className="grid g4" style={{ alignItems: 'end' }}>
          <label className="f"><span>Name</span><input className="inp" name="name" required /></label>
          <label className="f"><span>Email</span><input className="inp" name="email" type="email" required /></label>
          <label className="f"><span>Department</span>{deptSelect('dept', null)}</label>
          <div className="row">{roleTicks('roles', [])}</div>
          <button className="btn pri">Add person</button>
        </form>
      </div>

      <form action={saveCompany} className="card">
        <h2>Company rules</h2>
        <div className="grid g3">
          <label className="f"><span>Company name</span><input className="inp" name="company_name" defaultValue={s.company_name} /></label>
          <label className="f"><span>Standard VAT %</span><input className="inp mono" name="vat_rate" defaultValue={s.vat_rate} inputMode="decimal" /></label>
          <label className="f"><span>Payment request prefix</span><input className="inp mono" name="pr_prefix" defaultValue={s.pr_prefix} /></label>
          <label className="f"><span>Books locked up to (no posting on or before)</span><input className="inp" type="date" name="lock_date" defaultValue={s.lock_date ?? ''} /></label>
          <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="require_approval" defaultChecked={s.require_approval} /> Entries by non-Finance staff need approval</label>
          <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="require_cc" defaultChecked={s.require_cc} /> Every expense must have a project or department</label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Save company rules</button></div>
      </form>
    </>
  );
}
