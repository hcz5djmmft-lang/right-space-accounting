export function ReportFilter({ from = '', to = '', cc = '', projects, departments, extra }: {
  from?: string; to?: string; cc?: string; projects: { id: string; code: string }[]; departments: { id: string; name: string }[]; extra?: React.ReactNode;
}) {
  return (
    <form className="row card" style={{ alignItems: 'end' }}>
      {extra}
      <label className="f"><span>From</span><input className="inp" type="date" name="from" defaultValue={from} /></label>
      <label className="f"><span>To</span><input className="inp" type="date" name="to" defaultValue={to} /></label>
      <label className="f"><span>Cost center</span><select className="inp" name="cc" defaultValue={cc}>
        <option value="">Whole company</option>
        <optgroup label="Projects">{projects.map(p => <option key={p.id} value={'p:' + p.id}>{p.code}</option>)}</optgroup>
        <optgroup label="Departments">{departments.map(d => <option key={d.id} value={'d:' + d.id}>{d.name}</option>)}</optgroup>
      </select></label>
      <button className="btn">Show</button>
    </form>
  );
}
export const parseCC = (cc = '') => ({ project: cc.startsWith('p:') ? cc.slice(2) : undefined, dept: cc.startsWith('d:') ? cc.slice(2) : undefined });
