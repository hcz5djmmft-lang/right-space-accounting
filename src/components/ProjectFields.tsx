type P = Partial<Record<'code' | 'name' | 'client_id' | 'type' | 'service' | 'unit' | 'location' | 'description' | 'status' | 'start' | 'end', string | null>> &
  Partial<Record<'area' | 'contract' | 'budget', number | null>>;

export function ProjectFields({ p = {}, cats, customers, isNew }: {
  p?: P; cats: Record<string, string[]>; customers: { id: string; name: string }[]; isNew?: boolean;
}) {
  const pick = (name: string, label: string, list: string[], v?: string | null) => (
    <label className="f"><span>{label}</span><select className="inp" name={name} defaultValue={v ?? ''}><option value="">—</option>{list.map(x => <option key={x}>{x}</option>)}</select></label>);
  return (
    <div className="grid g3">
      {isNew && <label className="f"><span>Project code</span><input className="inp" name="code" required placeholder="e.g. PH-B1402" /></label>}
      <label className="f"><span>Name</span><input className="inp" name="name" dir="auto" defaultValue={p.name ?? ''} /></label>
      <label className="f"><span>Client</span><select className="inp" name="client" defaultValue={p.client_id ?? ''}><option value="">—</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {pick('type', 'Project type', cats.type ?? [], p.type)}
      {pick('service', 'Service', cats.service ?? [], p.service)}
      {pick('unit', 'Unit type', cats.unit ?? [], p.unit)}
      <label className="f"><span>Location</span><input className="inp" name="location" dir="auto" defaultValue={p.location ?? ''} /></label>
      <label className="f"><span>Area (m²)</span><input className="inp mono" name="area" inputMode="decimal" defaultValue={p.area ?? ''} /></label>
      <label className="f"><span>Contract value (EGP)</span><input className="inp mono" name="contract" inputMode="decimal" defaultValue={p.contract ?? ''} /></label>
      <label className="f"><span>Cost budget (EGP)</span><input className="inp mono" name="budget" inputMode="decimal" defaultValue={p.budget ?? ''} /></label>
      <label className="f"><span>Start</span><input className="inp" type="date" name="start" defaultValue={p.start ?? ''} /></label>
      <label className="f"><span>End</span><input className="inp" type="date" name="end" defaultValue={p.end ?? ''} /></label>
      {!isNew && pick('status', 'Status', ['Active', 'On hold', 'Completed', 'Closed'], p.status)}
      <label className="f" style={{ gridColumn: '1 / -1' }}><span>Notes</span><input className="inp" name="description" dir="auto" defaultValue={p.description ?? ''} /></label>
    </div>
  );
}
