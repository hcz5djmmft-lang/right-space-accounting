'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';

/** The Approve button on a row of Approvals (update 20): signs that document at its current step, as its own page would. */
export async function approveRow(act: string) {
  const user = await requireUser();
  const [kind, id] = act.split(':');
  let err = '';
  try {
    if (kind === 'pr') await (await import('@/lib/documents')).approveRequest(user, id);
    else if (kind === 'purchase') await (await import('@/lib/purchasing')).approvePurchaseRequest(user, id);
    else if (kind === 'entry') await (await import('@/lib/books')).approveEntry(user, id);
    else if (kind === 'petty') await (await import('@/lib/petty-docs')).approvePetty(user, id);
    else if (kind === 'sales') await (await import('@/lib/sales')).approveSales(user, id);
    else if (kind === 'leave') await (await import('@/lib/leave')).decideLeave(user, id, true);
    else if (kind === 'design') await (await import('@/lib/design')).decideSet(user, id, true);
    else if (kind === 'task') await (await import('@/lib/tasks')).reviewTask(user, id, true);
    else throw new RuleError('Open the document to approve it.');
  } catch (e) {
    err = e instanceof RuleError || (e instanceof Error && /locked|balanced|posted|cannot|enough/i.test(e.message)) ? (e as Error).message : 'Something went wrong. Nothing was changed.';
    if (!(e instanceof RuleError)) console.error(e);
  }
  revalidatePath('/', 'layout');
  redirect(err ? `/approvals?error=${encodeURIComponent(err)}` : '/approvals?ok=1');
}
