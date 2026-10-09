import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where uploaded files live. In production: a private Supabase Storage bucket
 * (SUPABASE_URL + SUPABASE_SERVICE_KEY, bucket STORAGE_BUCKET, default "attachments").
 * Locally: a folder on disk (UPLOAD_DIR, default ./uploads). Files are only ever
 * served through /files/<id>, which checks the login first.
 */
export interface Storage {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function supabase(url: string, keyEnv: string, bucket: string): Storage {
  const base = `${url.replace(/\/$/, '')}/storage/v1/object`;
  const auth = { Authorization: `Bearer ${keyEnv}`, apikey: keyEnv };
  const ok = async (r: Response, what: string) => { if (!r.ok) throw new Error(`Storage ${what} failed: ${r.status} ${await r.text()}`); return r; };
  // keys are entity/id/uuid.ext (attachments.ts); anything else would land somewhere else in the bucket
  const safe = (k: string) => { if (!/^[\w-]+\/[\w.-]+\/[\w-]+\.\w+$/.test(k)) throw new Error('Bad storage key'); return k; };
  return {
    async put(key, body, mime) {
      await ok(await fetch(`${base}/${bucket}/${safe(key)}`, { method: 'POST', headers: { ...auth, 'Content-Type': mime, 'x-upsert': 'false' }, body: new Uint8Array(body) }), 'upload');
    },
    async get(key) {
      const r = await ok(await fetch(`${base}/authenticated/${bucket}/${safe(key)}`, { headers: auth }), 'download');
      return Buffer.from(await r.arrayBuffer());
    },
    async remove(key) {
      await ok(await fetch(`${base}/${bucket}`, { method: 'DELETE', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [safe(key)] }) }), 'delete');
    },
  };
}

function disk(dir: string): Storage {
  const at = (key: string) => {
    const p = path.resolve(dir, key);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Bad storage key');
    return p;
  };
  return {
    async put(key, body) { const p = at(key); await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, body, { flag: 'wx' }); },
    async get(key) { return readFile(at(key)); },
    async remove(key) { await rm(at(key), { force: true }); },
  };
}

let cached: Storage | undefined;
export function storage(): Storage {
  if (cached) return cached;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, STORAGE_BUCKET, UPLOAD_DIR } = process.env;
  // on Vercel the disk is read-only, so a missing bucket setting is a configuration error, not a fallback
  if (process.env.VERCEL && !(SUPABASE_URL && SUPABASE_SERVICE_KEY))
    throw new Error('Storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY (and STORAGE_BUCKET) in Vercel and redeploy.');
  cached = SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? supabase(SUPABASE_URL, SUPABASE_SERVICE_KEY, STORAGE_BUCKET || 'attachments')
    : disk(UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  return cached;
}
