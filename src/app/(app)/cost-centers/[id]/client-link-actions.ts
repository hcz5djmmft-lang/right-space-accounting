'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { makeLink, revokeLink } from '@/lib/client-link';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));

export async function makeLinkAction(projectId: string) {
  const user = await requireUser();
  try { await makeLink(user, projectId); } catch (e) { redirect(`/cost-centers/${projectId}?error=${encodeURIComponent(msg(e))}#client-link`); }
  revalidatePath(`/cost-centers/${projectId}`);
  redirect(`/cost-centers/${projectId}#client-link`);
}
export async function revokeLinkAction(projectId: string) {
  const user = await requireUser();
  try { await revokeLink(user, projectId); } catch (e) { redirect(`/cost-centers/${projectId}?error=${encodeURIComponent(msg(e))}#client-link`); }
  revalidatePath(`/cost-centers/${projectId}`);
  redirect(`/cost-centers/${projectId}#client-link`);
}
