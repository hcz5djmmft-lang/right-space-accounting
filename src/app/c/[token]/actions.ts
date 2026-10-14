'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { RuleError } from '@/lib/ledger';
import { clientAnswersConcept, clientAnswersVariation, clientSignsHandover } from '@/lib/client-link';

// The client's answers from their link. No login: the link's secret is the permission, checked again on every answer.
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const msg = (e: unknown) => (e instanceof RuleError ? e.message : (console.error(e), 'Something went wrong. Nothing was changed; please try again.'));
function back(token: string, q: Record<string, string>, anchor = ''): never {
  revalidatePath(`/c/${token}`);
  redirect(`/c/${token}?${new URLSearchParams(q)}${anchor}`);
}

export async function answerVariationAction(token: string, id: string, f: FormData) {
  const approve = str(f, 'answer') === 'approve';
  try { await clientAnswersVariation(token, id, approve, str(f, 'note'), str(f, 'name')); }
  catch (e) { back(token, { error: msg(e) }, '#variations'); }
  back(token, { ok: approve ? 'Thank you. The variation order is approved.' : 'Thank you. The team will revise the variation order.' }, '#variations');
}
export async function answerConceptAction(token: string, id: string, f: FormData) {
  const approve = str(f, 'answer') === 'approve';
  try { await clientAnswersConcept(token, id, approve, str(f, 'note'), str(f, 'name')); }
  catch (e) { back(token, { error: msg(e) }, '#design'); }
  back(token, { ok: approve ? 'Thank you. The design is approved.' : 'Thank you. The designer will work on your comments.' }, '#design');
}
export async function signHandoverAction(token: string, f: FormData) {
  try { await clientSignsHandover(token, str(f, 'name'), str(f, 'signature')); }
  catch (e) { back(token, { error: msg(e) }, '#handover'); }
  back(token, { ok: 'Thank you. The handover certificate is signed.' }, '#handover');
}
