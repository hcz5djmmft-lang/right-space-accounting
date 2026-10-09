'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import * as books from '@/lib/books';
import { RuleError } from '@/lib/ledger';

const Item = z.object({ project: z.string().optional(), dept: z.string().optional(), acc: z.string(), desc: z.string().optional(), amount: z.number() });
const Input = z.object({
  id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  ref: z.string().default(''),
  action: z.enum(['draft', 'submit', 'post']),
  form: z.object({
    type: z.enum(['expense', 'collection', 'transfer']),
    memo: z.string().default(''),
    bank: z.string(),
    toBank: z.string().optional(),
    party: z.string().optional(),
    vatRate: z.number().optional(),
    amount: z.number().optional(),
    items: z.array(Item),
  }),
});

export type SaveResult = { error?: string; id?: string };

export async function saveEntryAction(raw: unknown): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const { action, ...input } = parsed.data;
  try {
    const id = await books.saveEntry(user, input, action);
    revalidatePath('/', 'layout');
    return { id };
  } catch (e) {
    return { error: errorText(e) };
  }
}

function errorText(e: unknown) {
  if (e instanceof RuleError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  // database rule messages are written for users
  if (/locked|balanced|posted|cannot/.test(m)) return m;
  console.error(e);
  return 'Something went wrong while saving. Nothing was changed.';
}

async function run(fn: () => Promise<unknown>, back: string) {
  let err = '';
  try { await fn(); } catch (e) { err = errorText(e); }
  revalidatePath('/', 'layout');
  redirect(back + (err ? `?error=${encodeURIComponent(err)}` : ''));
}

export async function approveAction(id: string) {
  const user = await requireUser();
  await run(() => books.approveEntry(user, id), `/entries/${id}`);
}
export async function returnAction(id: string, form: FormData) {
  const user = await requireUser();
  await run(() => books.returnEntry(user, id, String(form.get('reason') ?? '')), `/entries/${id}`);
}
export async function reverseAction(id: string, form: FormData) {
  const user = await requireUser();
  let rid = '';
  await run(async () => { rid = await books.reverseEntry(user, id, String(form.get('reason') ?? ''), String(form.get('date'))); }, `/entries/${id}`);
  void rid;
}
export async function deleteAction(id: string) {
  const user = await requireUser();
  let err = '';
  try { await books.deleteDraft(user, id); } catch (e) { err = errorText(e); }
  revalidatePath('/', 'layout');
  redirect(err ? `/entries/${id}?error=${encodeURIComponent(err)}` : '/entries');
}
