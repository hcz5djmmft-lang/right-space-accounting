import 'server-only';
import { sql, type Tx } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { TZ } from './dates';
import { type Answers, answered, designIncluded, missing } from './project-form';

// A project's life: the Project Information form, then Design (when the design is still to be prepared), QS and pricing,
// Planning, Execution and Handover. The form is completed by the engineer who adds the project; later phases are moved by
// the steps of each phase, or by hand from the project page.

export const PHASES = [
  ['form', 'Project form'], ['design', 'Design'], ['qs', 'QS and pricing'], ['planning', 'Planning'], ['execution', 'Execution'], ['handover', 'Handover'], ['closed', 'Closed'],
] as const;
export type Phase = typeof PHASES[number][0];
export const phaseLabel = (p: string | null | undefined) => PHASES.find(x => x[0] === p)?.[1] ?? '';
export const isPhase = (p: string): p is Phase => PHASES.some(x => x[0] === p);

/** Finance and the engineers (Engineering and its sections, project managers and designers) add projects and fill the form. */
export const canProjects = (u: User) => hasRole(u, 'finance', 'engineering', 'projects');
const need = (u: User, what: string) => { if (!canProjects(u)) throw new RuleError(`Only Engineering or Finance can ${what}.`); };

export type ProjectInfo = {
  project_id: string; rev: string; data: Answers; notes: Record<string, string>;
  completed_at: string | null; completed_by: string | null; updated_at: string | null; updated_by: string | null; answered: number; missing: string[];
};
export async function getInfo(projectId: string, tx: Tx = sql): Promise<ProjectInfo> {
  const [r] = await tx<Omit<ProjectInfo, 'answered' | 'missing'>[]>`
    select i.project_id, i.rev, i.data, i.notes, to_char(i.completed_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') completed_at, c.name completed_by,
      to_char(i.updated_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') updated_at, u.name updated_by
    from project_info i left join users c on c.id = i.completed_by left join users u on u.id = i.updated_by where i.project_id = ${projectId}`;
  const base = r ?? { project_id: projectId, rev: '', data: {}, notes: {}, completed_at: null, completed_by: null, updated_at: null, updated_by: null };
  return { ...base, answered: answered(base.data), missing: missing(base.data) };
}

/** Saves the answers and the notes as they stand; nothing is required until the form is marked complete. */
export async function saveInfo(user: User, projectId: string, i: { rev?: string; data: Answers; notes: Record<string, string> }) {
  need(user, 'fill the project form');
  const notes = Object.fromEntries(Object.entries(i.notes).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 2000)]).filter(([, v]) => v));
  await sql.begin(async tx => {
    const [p] = await tx<{ id: string }[]>`select id from projects where id = ${projectId} and not is_office`;
    if (!p) throw new RuleError('Project not found.');
    await tx`insert into project_info (project_id, rev, data, notes, updated_at, updated_by) values (${projectId}, ${(i.rev ?? '').trim()}, ${tx.json(i.data as never)}, ${tx.json(notes as never)}, now(), ${user.id})
      on conflict (project_id) do update set rev = excluded.rev, data = excluded.data, notes = excluded.notes, updated_at = now(), updated_by = ${user.id}`;
    await audit(tx, user, 'project', projectId, 'Project form saved', `${answered(i.data)} answers`);
  });
}

/** Marks the form complete (every required field answered) and moves a project still at the form step on to Design or QS. */
export async function completeForm(user: User, projectId: string) {
  need(user, 'complete the project form');
  return sql.begin(async tx => {
    const info = await getInfo(projectId, tx);
    if (info.missing.length) throw new RuleError(`Still to answer: ${info.missing.join(', ')}.`);
    const [p] = await tx<{ phase: Phase | null }[]>`select phase from projects where id = ${projectId} for update`;
    if (!p) throw new RuleError('Project not found.');
    await tx`update project_info set completed_at = coalesce(completed_at, now()), completed_by = coalesce(completed_by, ${user.id}) where project_id = ${projectId}`;
    await audit(tx, user, 'project', projectId, 'Project form complete');
    let next: Phase | null = null;
    if (p.phase === 'form') { next = designIncluded(info.data) ? 'design' : 'qs'; await movePhase(tx, user, projectId, next, designIncluded(info.data) ? 'Form complete; the design is to be prepared' : 'Form complete; the design is ready, so no design phase'); }
    return next;
  });
}

/** Moves a project within a transaction (the phase steps call this when their work is done). */
export async function movePhase(tx: Tx, user: User, projectId: string, phase: Phase, note: string) {
  await tx`update projects set phase = ${phase}, phase_at = now() where id = ${projectId}`;
  await tx`insert into project_phases (project_id, phase, user_id, note) values (${projectId}, ${phase}, ${user.id}, ${note})`;
  await audit(tx, user, 'project', projectId, `Moved to ${phaseLabel(phase)}`, note);
}

/** Moves a project to any phase by hand (Finance or the engineers), with a note saying why. */
export async function setPhase(user: User, projectId: string, phase: string, note = '') {
  need(user, 'move a project between phases');
  if (!isPhase(phase)) throw new RuleError('Choose the phase.');
  await sql.begin(async tx => {
    const [p] = await tx<{ phase: Phase | null; is_office: boolean }[]>`select phase, is_office from projects where id = ${projectId} for update`;
    if (!p || p.is_office) throw new RuleError('Project not found.');
    if (p.phase === phase) throw new RuleError(`The project is already at ${phaseLabel(phase)}.`);
    await movePhase(tx, user, projectId, phase, note.trim());
  });
}

export const phaseLog = (projectId: string) => sql<{ phase: string; label: string; at: string; who: string | null; note: string }[]>`
  select h.phase, h.phase label, to_char(h.at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at, u.name who, h.note
  from project_phases h left join users u on u.id = h.user_id where h.project_id = ${projectId} order by h.at desc`
  .then(rows => rows.map(r => ({ ...r, label: phaseLabel(r.phase) })));

/** Projects per phase for the lists: how many stand at each step. */
export const phaseCounts = () => sql<{ phase: string; n: number }[]>`select phase, count(*)::int n from projects where phase is not null and status = 'Active' group by phase`;
