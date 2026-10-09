'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { addAttachment, removeAttachment, type Entity } from '@/lib/attachments';
import { RuleError } from '@/lib/ledger';

function msg(e: unknown) {
  if (e instanceof RuleError) return e.message;
  console.error(e);
  return 'The file could not be saved. Nothing was changed.';
}

export async function uploadAction(entity: Entity, id: string, path: string, form: FormData): Promise<{ error?: string; added?: number }> {
  const user = await requireUser();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: 'Pick a photo or file first.' };
  let added = 0;
  try {
    for (const f of files) { await addAttachment(user, entity, id, f.name, Buffer.from(await f.arrayBuffer())); added++; }
  } catch (e) { revalidatePath(path); return { error: msg(e), added }; }
  revalidatePath(path);
  return { added };
}

export async function removeAction(attachmentId: string, path: string): Promise<{ error?: string }> {
  const user = await requireUser();
  try { await removeAttachment(user, attachmentId); } catch (e) { return { error: msg(e) }; }
  revalidatePath(path);
  return {};
}
