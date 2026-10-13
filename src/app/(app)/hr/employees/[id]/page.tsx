import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { listAttachments } from '@/lib/attachments';
import { DOCUMENTS, DOC_STATUSES, getEmployeeFile, listDocuments } from '@/lib/hr';
import { listDepartments, listProjects } from '@/lib/queries';
import { EmployeeFileFields } from '@/components/EmployeeFileFields';
import { DocFiles } from '@/components/DocFiles';
import { createLoginAction, linkLoginAction, saveDocumentsAction, saveFileAction } from '../../actions';

export default async function EmployeeFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string; error?: string }> }) {
  const user = await requireUser('hr', 'finance');
  const { id } = await params;
  const { tab = 'file', saved, error } = await searchParams;
  const e = await getEmployeeFile(id);
  if (!e) notFound();
  const flash = (await cookies()).get('rsa_flash')?.value;
  const [departments, projects, docs, files, logins, history] = await Promise.all([
    listDepartments(), listProjects(), listDocuments(id), listAttachments('employee', id),
    sql<{ id: string; name: string; email: string }[]>`select u.id, u.name, u.email from users u where u.active and not exists (select 1 from employees x where x.user_id = u.id and x.id <> ${id}) order by u.name`,
    sql<{ at: string; who: string | null; action: string; note: string }[]>`
      select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note
      from audit_log g left join users u on u.id = g.user_id where g.entity = 'employee' and g.entity_id = ${id} order by g.at desc limit 30`,
  ]);
  const canLogin = hasRole(user, 'hr');
  const path = `/hr/employees/${id}`;
  const tabs = [['file', 'File'], ['documents', `Documents (${e.docs_received} of ${DOCUMENTS.length})`], ['login', 'Login'], ['history', 'History']] as const;
  return (
    <>
      <div className="head"><div><h1 dir="auto">{e.name}</h1><p>{e.code}{e.job_title ? ` · ${e.job_title}` : ''}{e.dept_name ? ` · ${e.dept_name}` : ''} · {e.work_location === 'site' ? 'Site' : 'Office'}{e.active ? '' : ' · inactive'}</p></div>
        <div className="row"><Link className="btn" href="/hr">All employees</Link><Link className="btn" href={`/attendance/${id}`}>Attendance</Link>{hasRole(user, 'finance') && <Link className="btn" href={`/payroll/employees/${id}`}>Salary (Payroll)</Link>}</div></div>
      <div className="tabs">{tabs.map(([k, v]) => <Link key={k} href={`${path}?tab=${k}`} className={tab === k ? 'on' : ''}>{v}</Link>)}</div>
      {flash && <div className="msg good">{flash}</div>}
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}

      {tab === 'file' && (
        <form action={saveFileAction.bind(null, id)} className="card">
          <EmployeeFileFields e={e} departments={departments} projects={projects} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
            <label className="row" style={{ fontSize: 14 }}><input type="checkbox" name="active" defaultChecked={e.active} /> Active employee (on the HR list, in task pickers and in new payroll runs)</label>
            <button className="btn pri">Save file</button></div>
        </form>)}

      {tab === 'documents' && (
        <form action={saveDocumentsAction.bind(null, id)} className="card">
          <h2 style={{ marginTop: 0 }}>Employment documents</h2>
          <p className="muted" style={{ marginTop: 0 }}>The company&apos;s Employment Documents form. Mark each one as it is handed in and attach a photo or scan; documents that do not apply to this person are marked &quot;Not applicable&quot;.</p>
          {(['original', 'copy'] as const).map(kind => (
            <div key={kind} style={{ marginBottom: 14 }}>
              <h3 style={{ margin: '8px 0' }}>{kind === 'original' ? 'Originals' : 'Photocopies'}</h3>
              <div className="tw"><table>
                <thead><tr><th>Document</th><th>Status</th><th className="hide-sm">Received on</th><th className="hide-sm">Note</th><th>Files</th></tr></thead>
                <tbody>{DOCUMENTS.filter(d => d.kind === kind).map(d => {
                  const row = docs.find(r => r.key === d.key)!;
                  return (
                    <tr key={d.key}>
                      <td dir="auto">{d.name}{d.copies > 1 && !('counted' in d) ? <span className="muted"> · {d.copies} copies</span> : null}{d.who && <div className="muted" style={{ fontSize: 12 }}>{d.who} only</div>}
                        {'counted' in d && <div className="row" style={{ marginTop: 4, fontSize: 12 }}><span className="muted">How many:</span><input className="inp mono" name={`qty_${d.key}`} defaultValue={row.qty ?? ''} inputMode="numeric" style={{ width: 70, minHeight: 32, padding: '4px 8px' }} placeholder={String(d.copies)} /></div>}</td>
                      <td><select className="inp" name={`st_${d.key}`} defaultValue={row.status} style={{ minWidth: 130 }}>{DOC_STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                      <td className="hide-sm"><input className="inp" type="date" name={`on_${d.key}`} defaultValue={row.received_on ?? ''} style={{ minWidth: 150 }} /></td>
                      <td className="hide-sm"><input className="inp" name={`note_${d.key}`} defaultValue={row.note} dir="auto" style={{ minWidth: 140 }} /></td>
                      <td><DocFiles entity="employee" id={id} path={`${path}?tab=documents`} tag={d.key} items={files.filter(f => f.tag === d.key)} canRemove /></td>
                    </tr>);
                })}</tbody></table></div>
            </div>))}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri">Save documents</button></div>
        </form>)}

      {tab === 'login' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Login to the system</h2>
          {e.user_id ? (
            <>
              <p>This employee signs in as <b>{e.login_email}</b>{e.login_active ? '' : ' (login switched off under Settings)'}. Passwords are reset under Settings &rsaquo; People.</p>
              {canLogin && <form action={linkLoginAction.bind(null, id)}><input type="hidden" name="user_id" value="" /><button className="btn">Unlink this login</button></form>}
            </>
          ) : !canLogin ? <p className="muted">No login yet. HR or Management creates it from this page.</p> : (
            <div className="grid g2">
              <form action={createLoginAction.bind(null, id)} className="card" style={{ margin: 0 }}>
                <h3 style={{ marginTop: 0 }}>Create a new login</h3>
                <p className="muted" style={{ fontSize: 13 }}>The login gets this employee&apos;s name and department; a temporary password is shown once.</p>
                <label className="f"><span>Email for signing in</span><input className="inp" type="email" name="email" defaultValue={e.personal_email ?? ''} required /></label>
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn pri">Create login</button></div>
              </form>
              <form action={linkLoginAction.bind(null, id)} className="card" style={{ margin: 0 }}>
                <h3 style={{ marginTop: 0 }}>Link to an existing login</h3>
                <p className="muted" style={{ fontSize: 13 }}>For people who already sign in (added under Settings &rsaquo; People).</p>
                <label className="f"><span>Login</span><select className="inp" name="user_id" required><option value="">Choose…</option>{logins.map(u => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select></label>
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn">Link login</button></div>
              </form>
            </div>)}
        </div>)}

      {tab === 'history' && (
        <div className="card log">{history.length === 0 ? <p className="muted">Nothing recorded yet.</p> : history.map((h, k) => <div key={k}>{h.at} · {h.who ?? '—'} · {h.action}{h.note ? ` · ${h.note}` : ''}</div>)}</div>)}
    </>
  );
}
