import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from './db';
import { audit } from './books';
import { RuleError } from './ledger';
import { hasRole, type User } from './roles';
import { storage } from './storage';
import { TZ } from './dates';

/** Documents that can carry files. The names match audit_log.entity so the history shows uploads. */
export const ENTITIES = { invoice: 'invoices', journal: 'journal_entries' } as const;
export type Entity = keyof typeof ENTITIES;

/** 4 MB: phones shrink photos before sending, and the host refuses request bodies above 4.5 MB. */
export const MAX_BYTES = 4 * 1024 * 1024;

export type Attachment = { id: string; file_name: string; mime_type: string; size_bytes: number; uploaded_by: string | null; who: string | null; at: string };

/** Work out the real file type from its first bytes; the browser's claim is not trusted. */
export function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)$/.test(b.toString('latin1', 8, 12))) return { mime: 'image/heic', ext: 'heic' };
  return null;
}

async function docStatus(entity: Entity, id: string): Promise<string> {
  const [d] = entity === 'invoice'
    ? await sql<{ status: string }[]>`select status from invoices where id = ${id}`
    : await sql<{ status: string }[]>`select status from journal_entries where id = ${id}`;
  if (!d) throw new RuleError('That document no longer exists.');
  return d.status;
}

export async function listAttachments(entity: Entity, id: string) {
  return sql<Attachment[]>`
    select a.id, a.file_name, a.mime_type, a.size_bytes::int size_bytes, a.uploaded_by, u.name who,
      to_char(a.uploaded_at at time zone ${TZ},'YYYY-MM-DD HH24:MI') at
    from attachments a left join users u on u.id = a.uploaded_by
    where a.entity = ${entity} and a.entity_id = ${id} order by a.uploaded_at`;
}

/** Anyone signed in can add a receipt, also after posting (receipts often arrive later). */
export async function addAttachment(user: User, entity: Entity, id: string, name: string, body: Buffer): Promise<string> {
  if (!(entity in ENTITIES)) throw new RuleError('Unknown document.');
  if (!body.length) throw new RuleError('The file is empty.');
  if (body.length > MAX_BYTES) throw new RuleError('That file is over 4 MB. Take a smaller photo or send a smaller PDF.');
  const t = sniff(body);
  if (!t) throw new RuleError('Only photos (JPEG, PNG, WebP, HEIC) and PDF files can be attached.');
  await docStatus(entity, id);
  const fileName = (name || `receipt.${t.ext}`).replace(/[\\/\0-\x1f]/g, '_').slice(0, 120);
  const key = `${entity}/${id}/${randomUUID()}.${t.ext}`;
  await storage().put(key, body, t.mime);
  try {
    return await sql.begin(async tx => {
      const [a] = await tx<{ id: string }[]>`
        insert into attachments (entity, entity_id, file_name, mime_type, size_bytes, storage_key, uploaded_by)
        values (${entity}, ${id}, ${fileName}, ${t.mime}, ${body.length}, ${key}, ${user.id}) returning id`;
      await audit(tx, user, entity, id, 'Attached file', fileName);
      return a.id;
    });
  } catch (e) { await storage().remove(key).catch(() => {}); throw e; }
}

/** Only the uploader or Finance can remove, and never once the document is posted (the books keep their evidence). */
export async function removeAttachment(user: User, attachmentId: string) {
  const [a] = await sql<{ entity: Entity; entity_id: string; file_name: string; storage_key: string; uploaded_by: string | null }[]>`
    select entity, entity_id, file_name, storage_key, uploaded_by from attachments where id = ${attachmentId}`;
  if (!a) return;
  if (a.uploaded_by !== user.id && !hasRole(user, 'finance')) throw new RuleError('Only the person who attached it, or Finance, can remove this file.');
  if ((await docStatus(a.entity, a.entity_id)) === 'posted') throw new RuleError('This document is posted, so its files are kept.');
  await sql.begin(async tx => {
    await tx`delete from attachments where id = ${attachmentId}`;
    await audit(tx, user, a.entity, a.entity_id, 'Removed file', a.file_name);
  });
  await storage().remove(a.storage_key).catch(e => console.error('Could not delete stored file', a.storage_key, e));
}

export async function readAttachment(attachmentId: string) {
  const [a] = await sql<{ file_name: string; mime_type: string; storage_key: string }[]>`
    select file_name, mime_type, storage_key from attachments where id = ${attachmentId}`;
  if (!a) return null;
  return { ...a, body: await storage().get(a.storage_key) };
}

export async function attachmentCounts(entity: Entity, ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = await sql<{ entity_id: string; n: number }[]>`
    select entity_id, count(*)::int n from attachments where entity = ${entity} and entity_id in ${sql(ids)} group by entity_id`;
  return Object.fromEntries(rows.map(r => [r.entity_id, r.n]));
}
