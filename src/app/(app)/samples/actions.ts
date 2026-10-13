'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { MAX_BYTES, addAttachment, sniff } from '@/lib/attachments';
import * as d from '@/lib/design';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const go = (project: string, err?: string, ok?: string) => { revalidatePath('/', 'layout'); redirect(`/samples?${new URLSearchParams({ ...(project ? { project } : {}), ...(err ? { error: err } : ok ? { ok } : {}) })}`); };
async function photo(f: FormData, user: Awaited<ReturnType<typeof requireUser>>, id: string) {
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) return;
  const body = Buffer.from(await file.arrayBuffer());
  if (body.length > MAX_BYTES) throw new RuleError('That photo is over 4 MB. Take a smaller one.');
  if (!sniff(body)) throw new RuleError('Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.');
  await addAttachment(user, 'finish', id, file.name, body);
}
async function run(project: string, fn: () => Promise<unknown>, ok: string) {
  let err = '';
  try { await fn(); } catch (e) { err = msg(e); }
  go(project, err || undefined, err ? undefined : ok);
}

/** A new finish or material sample on the list, with its photo. */
export async function addSampleAction(project: string, f: FormData) {
  const u = await requireUser();
  await run(project, async () => {
    const id = await d.addFinish(u, project, { area: s(f, 'area'), item: s(f, 'item'), material: s(f, 'material'), ref: s(f, 'ref'), note: s(f, 'note') });
    if (s(f, 'sample_ref')) await d.setSampleRef(u, id, s(f, 'sample_ref'));
    await photo(f, u, id);
  }, 'Added to the samples list.');
}
export async function photoAction(project: string, id: string, f: FormData) { const u = await requireUser(); await run(project, () => photo(f, u, id), 'Photo added.'); }
export async function sendSampleAction(project: string, id: string, f: FormData) {
  const u = await requireUser();
  await run(project, async () => { await photo(f, u, id); await d.sendSample(u, id, s(f, 'sample_ref')); }, 'Sample sent to the client.');
}
export async function decideSampleAction(project: string, id: string, approve: boolean, f: FormData) {
  const u = await requireUser();
  await run(project, () => d.decideFinish(u, id, approve, s(f, 'note')), approve ? 'Approved by the client.' : 'Rejected by the client.');
}
