import 'server-only';
import { sql, type Tx } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ } from './dates';
import { r2 } from './money';
import { guessAccount } from './boq-parse';
import { projectAccounts } from './boq';
import { movePhase } from './projects';
import { positionsOf } from './org';
import { CALCULATORS, PARTS, type Inputs, type Part, compute, defaults, parsePart, statusLabel } from './qs-calc';
import { BATHROOM, ELECFIN, ELECTRICAL, KITCHEN, SANITARY, SEED_RATES, type QsMaterial } from './qs-data';

// QS and pricing: an estimate per project (with revisions) holds the calculators' inputs; the app works out the quantities,
// the Master BOQ, the dry cost and the client price. The client's acceptance makes the estimate the contract: the project's
// contract value, its BOQ budget per GL code and its material plan come from it, and the project moves on to Planning.

export const canQs = (u: User) => hasRole(u, 'engineering', 'projects');
export const canSeeQs = (u: User) => hasRole(u, 'finance', 'engineering', 'projects');
const need = (u: User, what: string) => { if (!canQs(u)) throw new RuleError(`Only the engineers (Technical Office) can ${what}.`); };

/** The rate table: material unit prices by key (the workbook's prices until Procurement changes them). */
export async function getRates(tx: Tx = sql): Promise<Record<string, number>> {
  const rows = await tx<{ key: string; price: number }[]>`select key, price::float price from qs_rates`;
  return { ...SEED_RATES, ...Object.fromEntries(rows.map(r => [r.key, r.price])) };
}
export const ALL_MATERIALS: (QsMaterial & { calculator: string })[] = ([['bathroom', BATHROOM], ['kitchen', KITCHEN], ['electrical', ELECTRICAL], ['sanitary', SANITARY], ['elecfin', ELECFIN]] as const)
  .flatMap(([c, d]) => d.materials.map(m => ({ ...m, calculator: c })));

/** Procurement (the org chart's procurement people), the engineers, Finance and Management keep the rate table. */
export async function canEditRates(u: User) {
  if (hasRole(u, 'finance', 'engineering', 'projects')) return true;
  const pos = await positionsOf(u.id);
  return pos.includes('procurement') || pos.includes('procurement_head');
}
export async function saveRates(user: User, prices: Record<string, string | number>) {
  if (!(await canEditRates(user))) throw new RuleError('Only Procurement, the engineers or Finance can change the rate table.');
  const known = new Set(ALL_MATERIALS.map(m => m.key));
  return sql.begin(async tx => {
    let changed = 0;
    for (const [key, raw] of Object.entries(prices)) {
      if (!known.has(key)) continue;
      const x = Number(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(x) || x < 0) throw new RuleError(`${ALL_MATERIALS.find(m => m.key === key)?.no ?? key}: the price must be a number.`);
      const [old] = await tx<{ price: number }[]>`select price::float price from qs_rates where key = ${key}`;
      if (r2(old?.price ?? SEED_RATES[key]) === r2(x)) continue;
      await tx`insert into qs_rates (key, calculator, price, updated_by, updated_at) values (${key}, ${ALL_MATERIALS.find(m => m.key === key)!.calculator}, ${r2(x)}, ${user.id}, now())
        on conflict (key) do update set price = excluded.price, updated_by = excluded.updated_by, updated_at = now()`;
      changed++;
    }
    if (changed) await audit(tx, user, 'qs_rates', 'table', 'Rate table changed', `${changed} prices`);
    return changed;
  });
}
export const rateHistory = () => sql<{ key: string; price: number; who: string | null; at: string }[]>`
  select r.key, r.price::float price, u.name who, to_char(r.updated_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at from qs_rates r left join users u on u.id = r.updated_by where r.updated_by is not null order by r.updated_at desc limit 50`;

export type EstimateRow = {
  id: string; project_id: string; project_code: string; project_name: string; phase: string | null; rev: number; status: string; status_label: string; title: string; area: number | null;
  dry_cost: number; client_price: number; risk_pct: number; margin_pct: number; vat_pct: number; created_at: string; updated_at: string; who: string | null;
  sent_at: string | null; decided_at: string | null; decided_by_name: string | null; decision_note: string;
};
const select = (tx: Tx, where = sql``) => tx<EstimateRow[]>`
  select e.id, e.project_id, p.code project_code, p.name project_name, p.phase, e.rev, e.status, e.status status_label, e.title, e.area::float area,
    e.dry_cost::float dry_cost, e.client_price::float client_price, e.risk_pct::float risk_pct, e.margin_pct::float margin_pct, e.vat_pct::float vat_pct,
    to_char(e.created_at at time zone ${TZ},'YYYY-MM-DD') created_at, to_char(e.updated_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') updated_at, u.name who,
    to_char(e.sent_at at time zone ${TZ},'YYYY-MM-DD') sent_at, to_char(e.decided_at at time zone ${TZ},'YYYY-MM-DD') decided_at, du.name decided_by_name, e.decision_note
  from estimates e join projects p on p.id = e.project_id left join users u on u.id = e.updated_by left join users du on du.id = e.decided_by
  ${where} order by p.code, e.rev desc`;
const label = (rows: EstimateRow[]) => rows.map(r => ({ ...r, status_label: statusLabel(r.status) }));

export const listEstimates = async (projectId?: string) => label(await select(sql, projectId ? sql`where e.project_id = ${projectId}` : sql``));
export const getEstimateRow = async (id: string, tx: Tx = sql) => label(await select(tx, sql`where e.id = ${id}`))[0];

/** The estimate with its inputs (missing keys filled from the defaults so old estimates survive new fields) and everything computed. */
export async function getEstimate(id: string, tx: Tx = sql) {
  const row = await getEstimateRow(id, tx);
  if (!row) return null;
  const [{ inputs }] = await tx<{ inputs: Partial<Inputs> }[]>`select inputs from estimates where id = ${id}`;
  const base = defaults();
  const full = Object.fromEntries(PARTS.map(p => [p, { ...base[p], ...(inputs[p] ?? {}) }])) as Inputs;
  return { ...row, inputs: full, calc: compute(full), editable: ['draft', 'rejected'].includes(row.status) };
}
export type EstimateFull = NonNullable<Awaited<ReturnType<typeof getEstimate>>>;

/** Projects that are in QS and pricing or already have an estimate, for the QS page. */
export const qsProjects = () => sql<{ id: string; code: string; name: string; phase: string | null; contract: number | null }[]>`
  select id, code, name, phase, contract::float contract from projects where not is_office and (phase = 'qs' or exists (select 1 from estimates e where e.project_id = projects.id)) order by code`;

/** A new estimate for a project: the workbook's inputs with today's rate table; rev 0 or the next number. */
export async function createEstimate(user: User, projectId: string) {
  need(user, 'start an estimate');
  return sql.begin(async tx => {
    const [p] = await tx<{ id: string; name: string; area: number | null; is_office: boolean }[]>`select id, name, area::float area, is_office from projects where id = ${projectId}`;
    if (!p || p.is_office) throw new RuleError('Project not found.');
    const [open] = await tx<{ rev: number }[]>`select rev from estimates where project_id = ${projectId} and status in ('draft','sent') limit 1`;
    if (open) throw new RuleError(`Estimate rev ${open.rev} is still open: finish it or make a new revision from it.`);
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(rev) + 1, 0)::int next from estimates where project_id = ${projectId}`;
    const inputs = defaults(await getRates(tx));
    const c = compute(inputs);
    const [e] = await tx<{ id: string }[]>`insert into estimates (project_id, rev, title, area, inputs, dry_cost, client_price, created_by, updated_by)
      values (${projectId}, ${next}, ${p.name}, ${p.area}, ${tx.json(inputs as never)}, ${c.dry}, ${c.pricing.client}, ${user.id}, ${user.id}) returning id`;
    await audit(tx, user, 'estimate', e.id, 'Started', `rev ${next}`);
    return e.id;
  });
}

/** Saves one part's inputs (a calculator, the Master BOQ quantities and rates, or the pricing) and recomputes the totals. */
export async function saveInputs(user: User, id: string, part: Part, get: (name: string) => string | null) {
  need(user, 'change an estimate');
  if (!PARTS.includes(part)) throw new RuleError('Unknown part.');
  await sql.begin(async tx => {
    const e = await getEstimate(id, tx);
    if (!e) throw new RuleError('Estimate not found.');
    if (!e.editable) throw new RuleError(`This estimate is ${e.status_label.toLowerCase()}: make a new revision to change it.`);
    let values;
    try { values = parsePart(part, get, e.inputs[part]); } catch (err) { throw new RuleError(err instanceof Error ? err.message : 'Bad input.'); }
    const inputs = { ...e.inputs, [part]: values };
    const c = compute(inputs);
    await tx`update estimates set inputs = ${tx.json(inputs as never)}, dry_cost = ${c.dry}, client_price = ${c.pricing.client},
      risk_pct = ${c.pricing.risk_pct}, margin_pct = ${c.pricing.margin_pct}, vat_pct = ${c.pricing.vat_pct}, updated_by = ${user.id}, updated_at = now() where id = ${id}`;
    await audit(tx, user, 'estimate', id, `${part === 'master' ? 'Master BOQ' : part === 'pricing' ? 'Pricing' : CALCULATORS.find(x => x[0] === part)?.[1] ?? part} saved`, `dry cost ${c.dry.toFixed(2)} · client ${c.pricing.client.toFixed(2)}`);
  });
}

/** The quotation goes to the client: the estimate is frozen until the client answers (or a new revision is made). */
export async function sendEstimate(user: User, id: string) {
  need(user, 'send an estimate');
  await sql.begin(async tx => {
    const [e] = await tx<{ status: string; dry_cost: number }[]>`select status, dry_cost::float dry_cost from estimates where id = ${id} for update`;
    if (!e) throw new RuleError('Estimate not found.');
    if (!['draft', 'rejected'].includes(e.status)) throw new RuleError('This estimate was already sent.');
    if (e.dry_cost <= 0) throw new RuleError('The estimate is empty: fill the calculators and the Master BOQ first.');
    await tx`update estimates set status = 'sent', sent_by = ${user.id}, sent_at = now(), decision_note = '', updated_by = ${user.id}, updated_at = now() where id = ${id}`;
    await audit(tx, user, 'estimate', id, 'Sent to the client');
  });
}

/** The client's answer. Accepted: the contract value, the BOQ budget per GL code and the material plan come from the estimate and the project moves to Planning. */
export async function decideEstimate(user: User, id: string, accepted: boolean, note = '') {
  if (!canQs(user) && !hasRole(user, 'finance')) throw new RuleError('Only the engineers or Finance can record the client\'s answer.');
  await sql.begin(async tx => {
    const e = await getEstimate(id, tx);
    if (!e) throw new RuleError('Estimate not found.');
    if (e.status !== 'sent') throw new RuleError('Only an estimate that was sent to the client can be accepted or declined.');
    if (!accepted) {
      await tx`update estimates set status = 'rejected', decided_by = ${user.id}, decided_at = now(), decision_note = ${note.trim()}, updated_by = ${user.id}, updated_at = now() where id = ${id}`;
      await audit(tx, user, 'estimate', id, 'Client declined', note.trim());
      return;
    }
    await tx`update estimates set status = 'accepted', decided_by = ${user.id}, decided_at = now(), decision_note = ${note.trim()}, dry_cost = ${e.calc.dry}, client_price = ${e.calc.pricing.client}, updated_by = ${user.id}, updated_at = now() where id = ${id}`;
    await tx`update estimates set status = 'superseded' where project_id = ${e.project_id} and id <> ${id} and status in ('draft','sent','rejected')`;
    // the contract
    await tx`update projects set contract = ${e.calc.pricing.client} where id = ${e.project_id}`;
    // the budget: the Master BOQ items as the project's BOQ, each matched to one of its GL codes where a name fits
    const accounts = await projectAccounts(e.project_id);
    await tx`delete from boqs where project_id = ${e.project_id}`;
    const [{ id: boqId }] = await tx<{ id: string }[]>`insert into boqs (project_id, file_name, uploaded_by) values (${e.project_id}, ${`Estimate rev ${e.rev}`}, ${user.id}) returning id`;
    let n = 0;
    for (const r of e.calc.rows) {
      if (!r.total) continue;
      const account = guessAccount({ code: '', description: r.desc }, accounts);
      await tx`insert into boq_lines (boq_id, line_no, item_no, description, unit, qty, rate, amount, account)
        values (${boqId}, ${++n}, ${r.no}, ${r.desc}, ${r.unit}, ${r.qty ?? 0}, ${r.rate ?? 0}, ${r.total}, ${account})`;
    }
    // the material plan
    await tx`delete from material_plan where project_id = ${e.project_id}`;
    for (const m of e.calc.materials) {
      await tx`insert into material_plan (project_id, estimate_id, calculator, key, no, description, size, brand, unit, qty, price, amount)
        values (${e.project_id}, ${id}, ${m.calculator}, ${m.key}, ${m.no}, ${m.desc}, ${m.size}, ${m.brand}, ${m.unit}, ${m.qty}, ${m.price}, ${m.total})`;
    }
    await audit(tx, user, 'estimate', id, 'Client accepted', `${note.trim()} contract ${e.calc.pricing.client.toFixed(2)} · ${n} BOQ lines · ${e.calc.materials.length} materials`.trim());
    await audit(tx, user, 'boq', e.project_id, 'BOQ set from the accepted estimate', `rev ${e.rev} · ${n} lines · ${e.calc.dry.toFixed(2)}`);
    const [p] = await tx<{ phase: string | null }[]>`select phase from projects where id = ${e.project_id}`;
    if (p?.phase === 'qs') await movePhase(tx, user, e.project_id, 'planning', `Estimate rev ${e.rev} accepted by the client`);
  });
}

/** A new revision copies the inputs; the old one is superseded unless it is the accepted contract. */
export async function newRevision(user: User, id: string) {
  need(user, 'revise an estimate');
  return sql.begin(async tx => {
    const [e] = await tx<{ project_id: string; rev: number; status: string; title: string; area: number | null; inputs: Inputs }[]>`select project_id, rev, status, title, area::float area, inputs from estimates where id = ${id} for update`;
    if (!e) throw new RuleError('Estimate not found.');
    const [open] = await tx<{ rev: number }[]>`select rev from estimates where project_id = ${e.project_id} and status in ('draft','sent') and id <> ${id} limit 1`;
    if (open) throw new RuleError(`Estimate rev ${open.rev} is still open.`);
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(rev) + 1, 0)::int next from estimates where project_id = ${e.project_id}`;
    const c = compute({ ...defaults(), ...e.inputs });
    const [n] = await tx<{ id: string }[]>`insert into estimates (project_id, rev, title, area, inputs, dry_cost, client_price, risk_pct, margin_pct, vat_pct, created_by, updated_by)
      values (${e.project_id}, ${next}, ${e.title}, ${e.area}, ${tx.json(e.inputs as never)}, ${c.dry}, ${c.pricing.client}, ${c.pricing.risk_pct}, ${c.pricing.margin_pct}, ${c.pricing.vat_pct}, ${user.id}, ${user.id}) returning id`;
    if (['draft', 'sent', 'rejected'].includes(e.status)) await tx`update estimates set status = 'superseded', updated_at = now() where id = ${id}`;
    await audit(tx, user, 'estimate', n.id, 'Started', `rev ${next} from rev ${e.rev}`);
    return n.id;
  });
}

/** The BOQ summary report: per project, the latest estimate's dry cost, risk, margin, client price and status, and the accepted contract. */
export const boqSummary = () => sql<{ project_id: string; code: string; name: string; phase: string | null; revs: number; rev: number; status: string; dry_cost: number; client_price: number; risk_pct: number; margin_pct: number; accepted: number | null; estimate_id: string }[]>`
  select p.id project_id, p.code, p.name, p.phase, (select count(*) from estimates x where x.project_id = p.id)::int revs,
    e.rev, e.status, e.dry_cost::float dry_cost, e.client_price::float client_price, e.risk_pct::float risk_pct, e.margin_pct::float margin_pct, e.id estimate_id,
    (select a.client_price::float from estimates a where a.project_id = p.id and a.status = 'accepted' order by a.rev desc limit 1) accepted
  from projects p join lateral (select * from estimates x where x.project_id = p.id order by x.rev desc limit 1) e on true
  where not p.is_office order by p.code`;

export const materialPlan = (projectId: string) => sql<{ id: number; calculator: string; no: string; description: string; size: string; brand: string; unit: string; qty: number; price: number; amount: number; needed_by: string | null; rev: number | null }[]>`
  select m.id, m.calculator, m.no, m.description, m.size, m.brand, m.unit, m.qty::float qty, m.price::float price, m.amount::float amount, to_char(m.needed_by,'YYYY-MM-DD') needed_by, e.rev
  from material_plan m left join estimates e on e.id = m.estimate_id where m.project_id = ${projectId} order by m.calculator, m.id`;
