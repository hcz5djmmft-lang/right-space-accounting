'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { RuleError } from '@/lib/ledger';
import { partyFromForm, setSubcontractor, updateParty } from '@/lib/parties';

const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed.'));

const home = (id: string, type: 'customer' | 'vendor') => `/${type === 'customer' ? 'customers' : 'vendors'}/${id}`;

export async function updatePartyAction(id: string, type: 'customer' | 'vendor', f: FormData) {
  const user = await requireUser();
  let err = '';
  try { await updateParty(user, id, partyFromForm(f)); } catch (e) { err = msg(e); }
  revalidatePath(type === 'customer' ? '/customers' : '/vendors');
  redirect(`${home(id, type)}?${err ? `error=${encodeURIComponent(err)}` : 'ok=Saved.'}`);
}
export async function subAction(id: string, sub: boolean) {
  const user = await requireUser();
  let err = '';
  try { await setSubcontractor(user, id, sub); } catch (e) { err = msg(e); }
  revalidatePath('/vendors');
  redirect(`${home(id, 'vendor')}?${err ? `error=${encodeURIComponent(err)}` : `ok=${encodeURIComponent(sub ? 'Moved to Subcontractors.' : 'Moved to Vendors.')}`}`);
}
