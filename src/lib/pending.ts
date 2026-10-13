import 'server-only';
import { sql } from './db';
import { hasRole, type User } from './roles';
import { today } from './dates';
import { waitingForUser } from './documents';
import { canProjects } from './projects';
import { canDesign, signersFor } from './design';
import { kindLabel } from './design-calc';
import { canQs } from './qs';
import { canPlan, progressDue } from './planning';
import { canEngineer } from './claims';

// Every pending step that needs someone's input shows as a task for that person until it is done (Adel's item 18):
// a form to complete, a drawing set to upload or approve, an estimate to finish or answer, a schedule to set, this
// week's progress, and every approval waiting for them. Computed from the records, so nothing is ever out of date.

export type Step = { kind: string; title: string; href: string; since?: string | null };

export async function pendingSteps(user: User): Promise<Step[]> {
  const out: Step[] = [];
  const now = today();
  const [waiting, forms, sets, qsProjects, estimates, plans, due] = await Promise.all([
    waitingForUser(user),
    canProjects(user) ? sql<{ id: string; code: string; at: string }[]>`select id, code, to_char(phase_at,'YYYY-MM-DD') at from projects where phase = 'form' and not is_office order by code` : [],
    sql<{ id: string; kind: string; version: number; status: string; designer_id: string | null; code: string; at: string }[]>`
      select s.id, s.kind, s.version, s.status, s.designer_id, p.code, to_char(s.step_at,'YYYY-MM-DD') at from drawing_sets s join projects p on p.id = s.project_id
      where s.status in ('draft','rejected','approved','client') order by p.code, s.kind`,
    canQs(user) ? sql<{ id: string; code: string; at: string }[]>`select id, code, to_char(phase_at,'YYYY-MM-DD') at from projects p where phase = 'qs' and not is_office and not exists (select 1 from estimates e where e.project_id = p.id and e.status in ('draft','sent')) order by code` : [],
    canQs(user) || hasRole(user, 'finance') ? sql<{ id: string; rev: number; status: string; code: string; at: string }[]>`select e.id, e.rev, e.status, p.code, to_char(e.updated_at,'YYYY-MM-DD') at from estimates e join projects p on p.id = e.project_id where e.status in ('draft','sent') order by p.code` : [],
    canPlan(user) ? sql<{ id: string; code: string; at: string }[]>`select p.id, p.code, to_char(p.phase_at,'YYYY-MM-DD') at from projects p left join schedules s on s.project_id = p.id where p.phase = 'planning' and not p.is_office and s.baselined_at is null order by p.code` : [],
    progressDue(now),
  ]);
  for (const w of waiting) out.push({ kind: 'approval', title: `Approve ${w.type} ${w.no}${w.memo ? ` · ${w.memo}` : ''}`, href: w.href, since: w.date });
  for (const f of forms) out.push({ kind: 'form', title: `Complete the Project Information form of ${f.code}`, href: `/cost-centers/${f.id}/form`, since: f.at });
  const ifc = hasRole(user, 'management') || (await signersFor('to_head')).includes(user.id) || (await signersFor('director')).includes(user.id);
  for (const s of sets) {
    const name = `${kindLabel(s.kind)} v${s.version} of ${s.code}`;
    const mine = s.designer_id === user.id || (!s.designer_id && canDesign(user));
    if (['draft', 'rejected'].includes(s.status) && mine) out.push({ kind: 'design', title: `${s.status === 'rejected' ? 'Revise and resubmit' : 'Upload and submit'} the ${name}`, href: `/design/${s.id}`, since: s.at });
    if (s.status === 'approved' && s.kind !== 'shop' && mine) out.push({ kind: 'design', title: `Send the ${name} to the client`, href: `/design/${s.id}`, since: s.at });
    if (s.status === 'approved' && s.kind === 'shop' && ifc) out.push({ kind: 'design', title: `Issue the ${name} for construction`, href: `/design/${s.id}`, since: s.at });
    if (s.status === 'client' && mine) out.push({ kind: 'design', title: `Record the client's answer on the ${name}`, href: `/design/${s.id}`, since: s.at });
  }
  for (const p of qsProjects) out.push({ kind: 'qs', title: `Start the estimate of ${p.code}`, href: '/qs', since: p.at });
  for (const e of estimates) {
    if (e.status === 'draft' && canQs(user)) out.push({ kind: 'qs', title: `Finish estimate rev ${e.rev} of ${e.code} and send it to the client`, href: `/qs/${e.id}`, since: e.at });
    if (e.status === 'sent') out.push({ kind: 'qs', title: `Record the client's answer on estimate rev ${e.rev} of ${e.code}`, href: `/qs/${e.id}`, since: e.at });
  }
  for (const p of plans) out.push({ kind: 'planning', title: `Set the schedule of ${p.code} and its baseline`, href: `/planning/${p.id}`, since: p.at });
  for (const p of due) if (p.site_user === user.id || p.manager_user === user.id || canPlan(user)) out.push({ kind: 'progress', title: `Record this week's progress on ${p.code}`, href: `/planning/${p.id}#progress` });
  // claims, variation orders and samples (update 14)
  const eng = canEngineer(user), fin = hasRole(user, 'finance');
  const [myClaims, certified, vos, samples] = await Promise.all([
    sql<{ id: string; no: string; code: string; status: string; at: string }[]>`select c.id, c.no, p.code, c.status, to_char(c.date,'YYYY-MM-DD') at from sub_claims c join projects p on p.id = c.project_id where c.status in ('draft','returned') and c.created_by = ${user.id} order by c.date`,
    fin ? sql<{ id: string; no: string; code: string; at: string }[]>`select c.id, c.no, p.code, to_char(c.certified_at,'YYYY-MM-DD') at from client_claims c join projects p on p.id = c.project_id where c.status = 'certified' order by c.certified_at` : [],
    eng || fin ? sql<{ id: string; no: string; code: string; at: string }[]>`select v.id, v.no, p.code, to_char(v.date,'YYYY-MM-DD') at from variation_orders v join projects p on p.id = v.project_id where v.status = 'sent' order by v.date` : [],
    canDesign(user) ? sql<{ project_id: string; code: string; area: string; item: string; at: string }[]>`select f.project_id, p.code, f.area, f.item, to_char(f.sent_at,'YYYY-MM-DD') at from finishes f join projects p on p.id = f.project_id where f.status = 'sent' order by f.sent_at` : [],
  ]);
  for (const c of myClaims) out.push({ kind: 'claim', title: `${c.status === 'returned' ? 'Correct and resend' : 'Complete and certify'} progress claim ${c.no} of ${c.code}`, href: `/claims/${c.id}`, since: c.at });
  for (const c of certified) out.push({ kind: 'claim', title: `Invoice the client for claim ${c.no} of ${c.code}`, href: `/claims/client/${c.id}`, since: c.at });
  for (const v of vos) out.push({ kind: 'variation', title: `Record the client's answer on variation order ${v.no} of ${v.code}`, href: `/variations/${v.id}`, since: v.at });
  for (const f of samples) out.push({ kind: 'sample', title: `Record the client's answer on the sample ${f.area} · ${f.item} of ${f.code}`, href: `/samples?project=${f.project_id}`, since: f.at });
  return out;
}
