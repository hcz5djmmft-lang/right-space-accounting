'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { MAX_BYTES, addAttachment, sniff } from '@/lib/attachments';
import * as site from '@/lib/site';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const go = (path: string, err?: string, ok?: string) => { revalidatePath('/', 'layout'); redirect(`${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams(err ? { error: err } : ok ? { ok } : {})}`); };
async function run(path: string, fn: () => Promise<unknown>, ok: string) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  go(path, err || undefined, err ? undefined : ok);
}

// ---- daily site reports
export async function reportAction(f: FormData) {
  const u = await requireUser();
  const editId = s(f, 'id') || undefined;
  const project = s(f, 'project'), day = s(f, 'day');
  const manpower = Array.from({ length: site.MANPOWER_ROWS }, (_, i) => ({ trade: s(f, `trade_${i}`), headcount: s(f, `head_${i}`) || 0, hours: s(f, `hours_${i}`) }));
  const activities = f.getAll('activity').map(String);
  const submit = f.get('submit') === '1';
  let id = '', err = '';
  try {
    id = await site.saveReport(u, { id: editId, project, day, weather: s(f, 'weather'), work_done: s(f, 'work_done'), materials: s(f, 'materials'), issues: s(f, 'issues'), visitors: s(f, 'visitors'), manpower, activities });
    if (submit) await site.submitReport(u, id);
  } catch (e) { err = msg(e); }
  if (err && !id) go(editId ? `/site/reports/new?edit=${editId}` : `/site/reports/new?project=${encodeURIComponent(project)}&day=${encodeURIComponent(day)}`, err);
  go(`/site/reports/${id}`, err || undefined, err ? undefined : submit ? 'Report sent.' : 'Draft saved. Add the photos, then send the report.');
}
export async function submitReportAction(id: string) { const u = await requireUser(); await run(`/site/reports/${id}`, () => site.submitReport(u, id), 'Report sent.'); }
export async function reviewReportAction(id: string, f: FormData) { const u = await requireUser(); await run(`/site/reports/${id}`, () => site.reviewReport(u, id, s(f, 'note')), 'Marked as reviewed.'); }
export async function deleteReportAction(id: string) {
  const u = await requireUser();
  try { await site.deleteReport(u, id); } catch (e) { go(`/site/reports/${id}`, msg(e)); }
  go('/site?tab=reports', undefined, 'Draft deleted.');
}

// ---- inspections
export async function inspectionAction(f: FormData) {
  const u = await requireUser();
  const project = s(f, 'project');
  let id = '', err = '';
  try { id = await site.raiseInspection(u, { project, activity: s(f, 'activity') || null, title: s(f, 'title'), location: s(f, 'location'), requested_for: s(f, 'requested_for'), inspector: s(f, 'inspector') || null }); } catch (e) { err = msg(e); }
  if (err) go(`/site/inspections/new?project=${encodeURIComponent(project)}`, err);
  go(`/site/inspections/${id}`, undefined, 'Inspection requested; the inspector has a task for it. Add photos if they help.');
}
export async function decideInspectionAction(id: string, passed: boolean, f: FormData) {
  const u = await requireUser();
  let snag: string | null = null, err = '';
  try { snag = await site.decideInspection(u, id, passed, s(f, 'note')); } catch (e) { err = msg(e); }
  go(`/site/inspections/${id}`, err || undefined, err ? undefined : passed ? 'Inspection passed.' : snag ? 'Inspection failed: the point is on the snag list for the site engineer.' : 'Inspection failed.');
}
export async function cancelInspectionAction(id: string) { const u = await requireUser(); await run(`/site/inspections/${id}`, () => site.cancelInspection(u, id), 'Inspection request cancelled.'); }

// ---- snags
export async function snagAction(f: FormData) {
  const u = await requireUser();
  const project = s(f, 'project');
  await run(`/site/snags?project=${encodeURIComponent(project)}`, () => site.addSnag(u, { project, area: s(f, 'area'), description: s(f, 'description'), trade: s(f, 'trade'), priority: s(f, 'priority'), vendor: s(f, 'vendor') || null, assignee: s(f, 'assignee') || null, due: s(f, 'due') || null }), 'Snag added.');
}
export async function snagPhotoAction(project: string, id: string, f: FormData) {
  const u = await requireUser();
  await run(`/site/snags?project=${encodeURIComponent(project)}`, async () => {
    const file = f.get('file');
    if (!(file instanceof File) || !file.size) throw new RuleError('Pick a photo first.');
    const body = Buffer.from(await file.arrayBuffer());
    if (body.length > MAX_BYTES) throw new RuleError('That photo is over 4 MB. Take a smaller one.');
    if (!sniff(body)) throw new RuleError('Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.');
    await addAttachment(u, 'snag', id, file.name, body);
  }, 'Photo added.');
}
export async function snagStatusAction(id: string, status: string, project: string, f: FormData) {
  const u = await requireUser();
  await run(`/site/snags?project=${encodeURIComponent(project)}`, () => site.setSnagStatus(u, id, status, s(f, 'note')), `Snag marked ${site.label(site.SNAG_STATUSES, status).toLowerCase()}.`);
}

// ---- handover
export async function handoverAction(project: string, f: FormData) {
  const u = await requireUser();
  await run(`/site/handover/${project}`, () => site.saveHandover(u, project, { date: s(f, 'date'), client_rep: s(f, 'client_rep'), company_rep: s(f, 'company_rep') || null, defects_months: s(f, 'defects_months') || 12, outstanding: s(f, 'outstanding'), notes: s(f, 'notes') }), 'Certificate saved.');
}
export async function signHandoverAction(project: string) { const u = await requireUser(); await run(`/site/handover/${project}`, () => site.signHandover(u, project), 'Handover certificate signed.'); }
