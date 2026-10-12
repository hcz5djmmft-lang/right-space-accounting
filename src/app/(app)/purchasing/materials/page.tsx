import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { fmt } from '@/lib/money';
import { isProcurement, listMaterials } from '@/lib/purchasing';
import { materialAction } from '../actions';

/** The material list: what can be ordered, its unit and the GL code it is bought on (the project's copy on a project). */
export default async function Materials({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; edit?: string }> }) {
  const user = await requireUser();
  const { error, ok, edit } = await searchParams;
  const [list, proc] = await Promise.all([listMaterials(true), isProcurement(user)]);
  const may = proc || hasRole(user, 'finance');
  const cur = list.find(m => m.id === edit);
  return (
    <>
      <div className="head"><div><h1>Materials</h1><p>What can be ordered on a purchase request. Each material has its GL code: on a project it goes to that project&apos;s copy of the code (24001 becomes 24001-3), for a department to the Office code.</p></div>
        <Link className="btn" href="/purchasing">Purchasing</Link></div>
      {error && <div className="msg bad">{error}</div>}
      {ok && <div className="msg good">{ok}</div>}
      {may && (
        <form action={materialAction} className="card grid g4" key={cur?.id ?? 'new'}>
          <h2 style={{ gridColumn: '1 / -1', margin: 0 }}>{cur ? `Edit ${cur.code}` : 'Add material'}</h2>
          {cur && <input type="hidden" name="id" value={cur.id} />}
          <label className="f"><span>Name</span><input className="inp" name="name" dir="auto" defaultValue={cur?.name} required /></label>
          <label className="f"><span>Arabic name</span><input className="inp" name="name_ar" dir="auto" defaultValue={cur?.name_ar ?? ''} /></label>
          <label className="f"><span>Unit</span><input className="inp" name="unit" defaultValue={cur?.unit ?? 'pc'} /></label>
          <label className="f"><span>GL code</span><input className="inp mono" name="account" defaultValue={cur?.account_base} placeholder="24001" required /></label>
          {cur && <label className="f"><span>In use</span><select className="inp" name="active" defaultValue={cur.active ? '1' : '0'}><option value="1">Yes</option><option value="0">No, hide it</option></select></label>}
          <div className="row" style={{ alignItems: 'end' }}><button className="btn pri">{cur ? 'Save' : 'Add material'}</button>{cur && <Link className="btn" href="/purchasing/materials">Cancel</Link>}</div>
        </form>)}
      <div className="tw"><table>
        <thead><tr><th>Code</th><th>Material</th><th>Unit</th><th>GL code</th><th className="num hide-sm">Last price</th>{may && <th></th>}</tr></thead>
        <tbody>{list.map(m => (
          <tr key={m.id} style={m.active ? undefined : { opacity: 0.5 }}><td className="mono">{m.code}</td><td dir="auto">{m.name}{m.name_ar ? <span className="muted"> · {m.name_ar}</span> : null}{m.active ? '' : ' (hidden)'}</td>
            <td>{m.unit}</td><td dir="auto"><span className="mono">{m.account_base}</span>{m.account_name ? ` · ${m.account_name}` : ''}</td><td className="num hide-sm">{m.last_price == null ? '—' : fmt(m.last_price)}</td>
            {may && <td><Link href={`/purchasing/materials?edit=${m.id}`}>Edit</Link></td>}</tr>))}</tbody>
      </table></div>
    </>
  );
}
