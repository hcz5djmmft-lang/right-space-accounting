import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { sql } from '@/lib/db';
import { fmt } from '@/lib/money';
import { CALCULATORS, PRICING, type CalcResult, type Part, type Rec, statusClass } from '@/lib/qs-calc';
import { BATHROOM, ELECFIN, ELECTRICAL, KITCHEN, MASTER, SANITARY, type QsParam } from '@/lib/qs-data';
import { canQs, getEstimate, materialPlan, type EstimateFull } from '@/lib/qs';
import { decideEstimateAction, newRevisionAction, saveInputsAction, sendEstimateAction } from '../actions';

const TABS = [['master', 'Master BOQ'], ['bathroom', 'Bathroom'], ['kitchen', 'Kitchen'], ['electrical', 'Electrical'], ['sanitary', 'Sanitary'], ['elecfin', 'Electrical finishing'], ['materials', 'Material plan']] as const;
const num = (v: number | null | undefined, d = 2) => (v == null ? '' : Number.isInteger(v) ? String(v) : v.toFixed(d).replace(/\.?0+$/, ''));

export default async function EstimatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string; error?: string }> }) {
  const user = await requireUser('finance', 'engineering', 'projects');
  const { id } = await params;
  const { tab = 'master', saved, error } = await searchParams;
  const e = await getEstimate(id);
  if (!e) notFound();
  const edit = e.editable && canQs(user);
  const log = await sql<{ at: string; who: string | null; action: string; note: string }[]>`select to_char(g.at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') at, u.name who, g.action, g.note from audit_log g left join users u on u.id = g.user_id where g.entity = 'estimate' and g.entity_id = ${id} order by g.at desc limit 30`;
  const c = e.calc;
  const needed = e.status === 'accepted' ? Object.fromEntries((await materialPlan(e.project_id)).filter(m => m.needed_by).map(m => [`${m.calculator}-${m.no}`, m.needed_by!])) : {};
  return (
    <>
      <div className="head"><div><h1><Link href={`/cost-centers/${e.project_id}`}>{e.project_code}</Link> · Estimate <span className="muted">rev {e.rev}</span></h1>
        <p dir="auto">{e.project_name} · <span className={statusClass(e.status)}>{e.status_label}</span>{e.decision_note ? ` · ${e.decision_note}` : ''}</p></div>
        <div className="row"><Link className="btn" href="/qs">All estimates</Link><a className="btn" href={`/print/boq/${id}`} target="_blank" rel="noopener">Client BOQ (print)</a></div></div>
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      <div className="tiles">
        <div className="tile"><div className="k">Dry cost</div><div className="v mono">{fmt(c.dry)}</div></div>
        <div className="tile"><div className="k">Client price</div><div className="v mono">{fmt(c.pricing.client)}</div></div>
        <div className="tile"><div className="k">Risk {num(c.pricing.risk_pct)} % · margin {num(c.pricing.margin_pct)} %</div><div className="v mono">{fmt(c.pricing.risk)} · {fmt(c.pricing.margin)}</div></div>
        <div className="tile"><div className="k">With VAT {num(c.pricing.vat_pct)} %</div><div className="v mono">{fmt(c.pricing.total)}</div></div>
      </div>
      <div className="tabs">{TABS.map(([k, v]) => <Link key={k} href={`/qs/${id}?tab=${k}`} className={tab === k ? 'on' : ''}>{v}</Link>)}</div>
      {!e.editable && <p className="muted" style={{ fontSize: 13 }}>This estimate is {e.status_label.toLowerCase()}; its figures are frozen. Make a new revision to change anything.</p>}
      {tab === 'master' && <Master e={e} edit={edit} canDecide={canQs(user) || hasRole(user, 'finance')} />}
      {tab === 'bathroom' && <Plumbing e={e} edit={edit} part="bathroom" />}
      {tab === 'kitchen' && <Plumbing e={e} edit={edit} part="kitchen" />}
      {tab === 'electrical' && <Electrical e={e} edit={edit} />}
      {tab === 'sanitary' && <Finishing e={e} edit={edit} part="sanitary" />}
      {tab === 'elecfin' && <Finishing e={e} edit={edit} part="elecfin" />}
      {tab === 'materials' && <Materials e={e} needed={needed} />}
      <div className="card log"><h2 style={{ marginTop: 0 }}>History</h2>{log.map((g, i) => <div key={i}>{g.at} · {g.who ?? ''} · {g.action}{g.note ? ` — ${g.note}` : ''}</div>)}</div>
    </>
  );
}

const Num = ({ name, value, edit, step = 'any', width = 90, options }: { name: string; value: number | null | undefined; edit: boolean; step?: string; width?: number; options?: number[] }) =>
  !edit ? <span className="mono">{num(value)}</span>
  : options ? <select className="inp" name={name} defaultValue={value ?? 0} style={{ width: width + 10 }}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>
  : <input className="inp mono" name={name} type="number" step={step} min="0" defaultValue={value ?? ''} style={{ width, textAlign: 'right' }} />;

function Master({ e, edit, canDecide }: { e: EstimateFull; edit: boolean; canDecide: boolean }) {
  const c = e.calc;
  const sourceNote = (src: string) => ({ bathroom: `bathroom calculator × ${num(e.inputs.pricing.bathrooms)} + ${fmt(e.inputs.pricing.bath_labour)}`, kitchen: `kitchen calculator + ${fmt(e.inputs.pricing.kitchen_labour)}`, electrical: 'electrical calculator', san_bath: 'sanitary finishing · bathroom', san_kitchen: 'sanitary finishing · kitchen', elecfin: 'electrical finishing' } as Record<string, string>)[src] ?? '';
  return (
    <>
      <form action={saveInputsAction.bind(null, e.id, 'master' as Part)} className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }} dir="auto">{MASTER.title}</h2>{edit && <button className="btn pri">Save Master BOQ</button>}</div>
        <p className="muted" style={{ fontSize: 13 }}>Type the quantities, and the rates of the items the calculators do not price. A blank quantity or rate leaves the item at 0.</p>
        <div className="tw"><table>
          <thead><tr><th>No.</th><th>Item</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Total</th></tr></thead>
          <tbody>{MASTER.sections.map(s => (
            <Sec key={s.no} title={`${s.no}. ${s.title}`}>{c.rows.filter(r => r.section === s.no).map(r => (
              <tr key={r.key}><td className="mono">{r.no}</td>
                <td dir="auto" style={{ minWidth: 220, maxWidth: 520, fontSize: 13 }}>{r.desc}{r.linked && <div className="muted" style={{ fontSize: 12 }}>Rate from the {sourceNote(r.source)}</div>}</td>
                <td dir="auto">{r.unit}</td>
                <td className="num"><Num name={`q_${r.key}`} value={r.qty} edit={edit} /></td>
                <td className="num">{r.linked ? <span className="mono">{fmt(r.rate)}</span> : <Num name={`r_${r.key}`} value={r.rate} edit={edit} step="0.01" width={110} />}</td>
                <td className="num mono">{fmt(r.total)}</td></tr>))}</Sec>))}
            <tr className="tot"><td colSpan={5} dir="auto"><b>{MASTER.dryLabel}</b> <span className="muted">· {MASTER.dryNote}</span></td><td className="num mono"><b>{fmt(c.dry)}</b></td></tr>
          </tbody></table></div>
      </form>

      <form action={saveInputsAction.bind(null, e.id, 'pricing' as Part)} className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Pricing</h2>{edit && <button className="btn pri">Save pricing</button>}</div>
        <p className="muted" style={{ fontSize: 13 }}>The dry cost is 70 % of the client price: risk 10 % and margin 20 % (Adel's rule). VAT 14 % is shown apart on the client BOQ.</p>
        <div className="grid g3">{PRICING.map(([k, label]) => <label key={k} className="f"><span>{label}</span><Num name={k} value={e.inputs.pricing[k]} edit={edit} step="0.01" width={140} /></label>)}</div>
        <div className="tw" style={{ marginTop: 10 }}><table><tbody>
          <tr><td>Dry cost (materials and labour)</td><td className="num mono">{fmt(c.dry)}</td></tr>
          <tr><td>Risk {num(c.pricing.risk_pct)} %</td><td className="num mono">{fmt(c.pricing.risk)}</td></tr>
          <tr><td>Margin {num(c.pricing.margin_pct)} %</td><td className="num mono">{fmt(c.pricing.margin)}</td></tr>
          <tr className="tot"><td>Client price (dry cost ÷ {num(c.pricing.factor, 4)})</td><td className="num mono"><b>{fmt(c.pricing.client)}</b></td></tr>
          <tr><td>VAT {num(c.pricing.vat_pct)} %</td><td className="num mono">{fmt(c.pricing.vat)}</td></tr>
          <tr><td>Total with VAT</td><td className="num mono">{fmt(c.pricing.total)}</td></tr>
        </tbody></table></div>
      </form>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The client</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {['draft', 'rejected'].includes(e.status) && edit && <form action={sendEstimateAction.bind(null, e.id)}><button className="btn pri">Send to the client</button></form>}
          {e.status === 'sent' && canDecide && (
            <form className="row" style={{ flexWrap: 'wrap' }}><input className="inp" name="note" dir="auto" placeholder="The client's answer or the contract reference" style={{ minWidth: 240 }} />
              <button className="btn pri" formAction={decideEstimateAction.bind(null, e.id, true)}>Client accepted</button>
              <button className="btn bad" formAction={decideEstimateAction.bind(null, e.id, false)}>Client declined</button></form>)}
          {e.status !== 'draft' && canDecide && <form action={newRevisionAction.bind(null, e.id)}><button className="btn">New revision (rev {e.rev + 1})</button></form>}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{e.status === 'sent' ? `Sent ${e.sent_at}. ` : ''}{e.status === 'accepted' ? `Accepted ${e.decided_at}${e.decided_by_name ? ` by ${e.decided_by_name}` : ''}: the client price is the project's contract, the Master BOQ is its budget (BOQ vs actual) and the materials are its material plan.` : 'When the client accepts, the client price becomes the project\'s contract, the Master BOQ its budget per GL code and the materials its material plan for procurement, and the project moves to Planning.'}</p>
      </div>
    </>
  );
}

const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => <>
  <tr><td colSpan={6} dir="auto" style={{ background: 'var(--panel)', fontWeight: 600 }}>{title}</td></tr>{children}</>;

function MaterialRows({ r, edit, groups, hideBrand }: { r: CalcResult; edit: boolean; groups: { title: string }[]; hideBrand?: boolean }) {
  return (
    <div className="tw"><table>
      <thead><tr><th>No.</th><th>Material</th>{!hideBrand && <th className="hide-sm">Size / brand</th>}<th>Unit</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
      <tbody>{groups.map((g, gi) => (
        <Sec key={gi} title={g.title}>{r.lines.filter(l => l.group === gi).map(l => (
          <tr key={l.key}><td className="mono">{l.no}</td>
            <td dir="auto" style={{ minWidth: 180, maxWidth: 420, fontSize: 13 }}>{l.desc}{l.note && <div className="muted" style={{ fontSize: 12 }}>{l.note}</div>}</td>
            {!hideBrand && <td className="hide-sm muted" dir="auto" style={{ fontSize: 12 }}>{[l.size, l.brand].filter(Boolean).join(' · ')}</td>}
            <td dir="auto">{l.unit}</td>
            <td className="num">{l.typed ? <Num name={`q_${l.key}`} value={l.qty} edit={edit} width={80} /> : <span className="mono" title="worked out">{num(l.qty)}</span>}</td>
            <td className="num"><Num name={`p_${l.key}`} value={l.price} edit={edit} step="0.01" width={100} /></td>
            <td className="num mono">{fmt(l.total)}</td></tr>))}
          <tr><td colSpan={hideBrand ? 5 : 6} className="muted" style={{ textAlign: 'right' }}>Subtotal</td><td className="num mono">{fmt(r.groups[gi]?.total)}</td></tr></Sec>))}
        <tr className="tot"><td colSpan={hideBrand ? 5 : 6}><b>Total</b></td><td className="num mono"><b>{fmt(r.total)}</b></td></tr>
      </tbody></table></div>);
}

const Params = ({ ps, v, edit }: { ps: QsParam[]; v: Rec; edit: boolean }) => (
  <div className="grid g2">{ps.map(p => <label key={p.key} className="f"><span dir="auto">{p.label}{p.unit ? ` (${p.unit})` : ''}</span><Num name={p.key} value={v[p.key]} edit={edit} options={p.options} width={120} />{p.note && <small className="muted" dir="auto">{p.note}</small>}</label>)}</div>);

function Plumbing({ e, edit, part }: { e: EstimateFull; edit: boolean; part: 'bathroom' | 'kitchen' }) {
  const d = part === 'bathroom' ? BATHROOM : KITCHEN;
  const r = e.calc[part], v = e.inputs[part];
  return (
    <form action={saveInputsAction.bind(null, e.id, part as Part)}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }} dir="auto">{d.title}</h2>{edit && <button className="btn pri">Save and recalculate</button>}</div>
        <p className="muted" style={{ fontSize: 13 }} dir="auto">{d.subtitle}</p>
        <h3 style={{ fontSize: 14 }}>Dimensions and distances</h3><Params ps={d.params} v={v} edit={edit} />
        <h3 style={{ fontSize: 14 }}>Fixtures and outlets</h3><Params ps={d.fixtures} v={v} edit={edit} />
        <h3 style={{ fontSize: 14 }}>Worked out</h3>
        <div className="tiles">{r.indicators.map(i => <div key={i.key} className="tile"><div className="k" dir="auto">{i.label}</div><div className="v mono">{num(i.value, 3)} <small>{i.unit}</small></div></div>)}</div>
      </div>
      <div className="card"><h2 style={{ marginTop: 0 }}>Materials</h2><MaterialRows r={r} edit={edit} groups={d.groups} />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }} dir="auto">{d.totalNote}</p>{edit && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Save and recalculate</button></div>}</div>
    </form>);
}

function Electrical({ e, edit }: { e: EstimateFull; edit: boolean }) {
  const r = e.calc.electrical, v = e.inputs.electrical;
  const totals = ELECTRICAL.points.map((_, j) => ELECTRICAL.rooms.reduce((s, _r, i) => s + (v[`m${i}_${j}`] ?? 0), 0));
  const boxes = ELECTRICAL.rooms.map((_, i) => ELECTRICAL.points.reduce((s, _p, j) => s + (j >= 2 ? v[`m${i}_${j}`] ?? 0 : 0), 0));
  return (
    <form action={saveInputsAction.bind(null, e.id, 'electrical' as Part)}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }} dir="auto">{ELECTRICAL.title}</h2>{edit && <button className="btn pri">Save and recalculate</button>}</div>
        <p className="muted" style={{ fontSize: 13 }} dir="auto">{ELECTRICAL.matrixTitle}</p>
        <div className="tw"><table>
          <thead><tr><th>Room</th>{ELECTRICAL.points.map(p => <th key={p.key} className="num" dir="auto" style={{ fontSize: 11, minWidth: 64 }}>{p.label}</th>)}<th className="num" dir="auto" style={{ fontSize: 11 }}>{ELECTRICAL.boxesLabel}</th></tr></thead>
          <tbody>{ELECTRICAL.rooms.map((room, i) => <tr key={room.key}><td dir="auto" style={{ fontSize: 13, minWidth: 140 }}>{room.label}</td>
            {ELECTRICAL.points.map((_, j) => <td key={j} className="num"><Num name={`m${i}_${j}`} value={v[`m${i}_${j}`] ?? 0} edit={edit} step="1" width={60} /></td>)}
            <td className="num mono">{boxes[i]}</td></tr>)}
            <tr className="tot"><td dir="auto">{ELECTRICAL.totalsLabel}</td>{totals.map((t, j) => <td key={j} className="num mono">{t}</td>)}<td className="num mono">{boxes.reduce((a, b) => a + b, 0)}</td></tr>
          </tbody></table></div>
        <h3 style={{ fontSize: 14 }}>Worked out</h3>
        <div className="tiles">{r.indicators.map(i => <div key={i.key} className="tile"><div className="k" dir="auto">{i.label}</div><div className="v mono">{num(i.value)} <small dir="auto">{i.unit}</small></div></div>)}</div>
      </div>
      <div className="card"><h2 style={{ marginTop: 0 }}>Materials</h2><MaterialRows r={r} edit={edit} groups={ELECTRICAL.groups} />
        {edit && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Save and recalculate</button></div>}</div>
    </form>);
}

function Finishing({ e, edit, part }: { e: EstimateFull; edit: boolean; part: 'sanitary' | 'elecfin' }) {
  const d = part === 'sanitary' ? SANITARY : ELECFIN;
  const r = e.calc[part];
  return (
    <form action={saveInputsAction.bind(null, e.id, part as Part)} className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }} dir="auto">{d.title}</h2>{edit && <button className="btn pri">Save and recalculate</button>}</div>
      <p className="muted" style={{ fontSize: 13 }}>{part === 'sanitary' ? 'Type the quantities and prices; the bathroom total prices Master BOQ item 10.1 and the kitchen total item 10.2.' : 'Modules, plates and spots are counted from the electrical points; the LED items are typed. The total prices Master BOQ item 10.3.'}</p>
      <MaterialRows r={r} edit={edit} groups={d.groups} />
    </form>);
}

function Materials({ e, needed }: { e: EstimateFull; needed: Record<string, string> }) {
  const ms = e.calc.materials;
  const dated = Object.keys(needed).length > 0;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Material plan</h2>
      <p className="muted" style={{ fontSize: 13 }}>Every material the calculators count, with its quantity and price. When the client accepts this estimate these lines become the project&apos;s material plan for procurement{dated ? ', and the schedule\'s baseline sets when each is needed on site (a week before its work starts).' : '.'}</p>
      <div className="tw"><table>
        <thead><tr><th>Calculator</th><th>No.</th><th>Material</th><th className="hide-sm">Size / brand</th><th>Unit</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th>{dated && <th>Needed by</th>}</tr></thead>
        <tbody>{ms.map(m => <tr key={`${m.calculator}-${m.key}`}><td>{CALCULATORS.find(c => c[0] === m.calculator)?.[1]}</td><td className="mono">{m.no}</td><td dir="auto" style={{ fontSize: 13, maxWidth: 420 }}>{m.desc}</td>
          <td className="hide-sm muted" dir="auto" style={{ fontSize: 12 }}>{[m.size, m.brand].filter(Boolean).join(' · ')}</td><td dir="auto">{m.unit}</td><td className="num mono">{num(m.qty)}</td><td className="num mono">{fmt(m.price)}</td><td className="num mono">{fmt(m.total)}</td>{dated && <td className="mono">{needed[`${m.calculator}-${m.no}`] ?? ''}</td>}</tr>)}
          <tr className="tot"><td colSpan={dated ? 8 : 7}><b>Materials total</b></td><td className="num mono"><b>{fmt(ms.reduce((t, m) => t + m.total, 0))}</b></td></tr>
        </tbody></table></div>
    </div>);
}
