import { requireUser } from '@/lib/auth';
import { ROLES, type Role } from '@/lib/roles';
import { sql } from '@/lib/db';
import { getSettings } from '@/lib/books';
import { getSteps } from '@/lib/documents';
import { addUser, resetPassword, saveCompany, saveSteps, updateUser } from './actions';

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const me = await requireUser('management');
  const { saved, error } = await searchParams;
  const [s, steps, users] = await Promise.all([
    getSettings(), getSteps(),
    sql<{ id: string; email: string; name: string; roles: Role[]; active: boolean }[]>`select id, email, name, roles, active from users order by active desc, name`,
  ]);
  const active = users.filter(u => u.active);
  return (
    <>
      <div className="head"><div><h1>Settings</h1><p>Only Management sees this page. Every change here is recorded with who made it.</p></div></div>
      {saved && <div className="msg good">{saved}</div>}
      {error && <div className="msg bad">{error}</div>}

      <form action={saveSteps} className="card">
        <h2>Approvers for payment requests</h2>
        <p className="muted" style={{ marginTop: 0 }}>Tick who signs each step. With nobody ticked, anyone holding that role can sign. Management can always sign any step.</p>
        <div className="grid g3">{steps.map(st => (
          <fieldset key={st.position} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
            <legend><b>{st.position}. {st.name}</b></legend>
            {active.map(u => <label key={u.id} className="row" style={{ fontSize: 14 }}>
              <input type="checkbox" name={'step_' + st.position} value={u.id} defaultChecked={st.user_ids.includes(u.id)} /> {u.name}</label>)}
          </fieldset>))}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Save approvers</button></div>
      </form>

      <div className="card">
        <h2>People and roles</h2>
        <div className="tw" style={{ marginBottom: 12 }}><table>
          <thead><tr><th>Name</th><th className="hide-sm">Email</th><th>Roles</th><th>Active</th><th></th></tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id}><td colSpan={5} style={{ padding: 0 }}>
              <form action={updateUser.bind(null, u.id)} className="row" style={{ padding: '8px 10px', justifyContent: 'space-between' }}>
                <input className="inp" name="name" defaultValue={u.name} style={{ maxWidth: 200 }} />
                <span className="hide-sm muted" style={{ minWidth: 180 }}>{u.email}</span>
                <span className="row">{(Object.keys(ROLES) as Role[]).map(r => <label key={r} className="row" style={{ fontSize: 13, gap: 3 }}>
                  <input type="checkbox" name="roles" value={r} defaultChecked={u.roles.includes(r)} />{ROLES[r].split(' ')[0]}</label>)}</span>
                <label className="row" style={{ fontSize: 13 }}><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                <span className="row"><button className="btn sm">Save</button>
                  {u.id !== me.id && <button className="btn sm" formAction={resetPassword.bind(null, u.id)}>Reset password</button>}</span>
              </form></td></tr>))}
          </tbody></table></div>
        <form action={addUser} className="grid g4" style={{ alignItems: 'end' }}>
          <label className="f"><span>Name</span><input className="inp" name="name" required /></label>
          <label className="f"><span>Email</span><input className="inp" name="email" type="email" required /></label>
          <div className="row" style={{ gridColumn: 'span 1' }}>{(Object.keys(ROLES) as Role[]).map(r => <label key={r} className="row" style={{ fontSize: 13, gap: 3 }}>
            <input type="checkbox" name="roles" value={r} />{ROLES[r].split(' ')[0]}</label>)}</div>
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
