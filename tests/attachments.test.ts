// Receipt photos on payment requests, stored on disk in the test run.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rsa-uploads-'));
const { sql } = await import('@/lib/db');
const docs = await import('@/lib/documents');
const att = await import('@/lib/attachments');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');

type U = { id: string; email: string; name: string; roles: ('finance' | 'engineering' | 'management')[] };
const fin: U = { id: '', email: 'fin@x.test', name: 'Fatma Finance', roles: ['finance'] };
const eng: U = { id: '', email: 'eng@x.test', name: 'Omar Engineer', roles: ['engineering'] };
const other: U = { id: '', email: 'sara@x.test', name: 'Sara Site', roles: ['engineering'] };

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const pdf = Buffer.from('%PDF-1.4 fake');

beforeAll(async () => {
  const ctx = { window: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
  await sql`truncate sessions, users, attachments cascade`;
  await importOld(sql, ctx.window.__SEED, { replace: true });
  for (const u of [fin, eng, other]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
});
afterAll(async () => { await sql.end(); fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }); });

describe('receipt photos', () => {
  let id = '', fileId = '';
  it('an engineer attaches a photo to a draft request; the real type wins over the file name', async () => {
    id = await docs.savePaymentRequest(eng as never, { date: '2026-10-12', party: 'vc0003', project: 'ph-b1302', ref: '', vatRate: 14, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0,
      lines: [{ acc: '25001-1', desc: 'Tiles', qty: 1, price: 1000 }] }, false);
    fileId = await att.addAttachment(eng as never, 'invoice', id, 'receipt.png', jpeg);
    const [a] = await att.listAttachments('invoice', id);
    expect(a).toMatchObject({ id: fileId, file_name: 'receipt.png', mime_type: 'image/jpeg', size_bytes: jpeg.length, who: 'Omar Engineer' });
    const back = await att.readAttachment(fileId);
    expect(back?.body.equals(jpeg)).toBe(true);
    expect(fs.readdirSync(path.join(process.env.UPLOAD_DIR!, 'invoice', id))).toHaveLength(1);
  });
  it('refuses files that are not photos or PDFs, and empty or oversized ones', async () => {
    await expect(att.addAttachment(eng as never, 'invoice', id, 'x.exe', Buffer.from('MZ....'))).rejects.toThrow(/Only photos/);
    await expect(att.addAttachment(eng as never, 'invoice', id, 'x.jpg', Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(att.addAttachment(eng as never, 'invoice', id, 'x.jpg', Buffer.concat([jpeg, Buffer.alloc(att.MAX_BYTES)]))).rejects.toThrow(/4 MB/);
    expect(await att.listAttachments('invoice', id)).toHaveLength(1);
  });
  it('only the uploader or Finance can remove a file', async () => {
    const pdfId = await att.addAttachment(eng as never, 'invoice', id, 'quote.pdf', pdf);
    await expect(att.removeAttachment(other as never, pdfId)).rejects.toThrow(/Only the person/);
    await att.removeAttachment(fin as never, pdfId);
    expect(await att.listAttachments('invoice', id)).toHaveLength(1);
    expect(await att.readAttachment(pdfId)).toBeNull();
    const log = await sql`select action, note from audit_log where entity = 'invoice' and entity_id = ${id} and action like '%file' order by at`;
    expect(log.map(l => l.action)).toEqual(['Attached file', 'Attached file', 'Removed file']);
  });
  it('once the request is posted, files can still be added but never removed', async () => {
    await docs.savePaymentRequest(eng as never, { id, date: '2026-10-12', party: 'vc0003', project: 'ph-b1302', ref: '', vatRate: 14, whtRate: 0, siRate: 0, retRate: 0, dpAmount: 0,
      lines: [{ acc: '25001-1', desc: 'Tiles', qty: 1, price: 1000 }] }, true);
    await sql`update invoices set status = 'posted' where id = ${id}`; // shortcut past the approval chain, tested elsewhere
    const late = await att.addAttachment(fin as never, 'invoice', id, 'stamped.jpg', jpeg);
    await expect(att.removeAttachment(fin as never, late)).rejects.toThrow(/posted/);
    await expect(att.removeAttachment(fin as never, fileId)).rejects.toThrow(/posted/);
    expect(await att.attachmentCounts('invoice', [id, 'nope'])).toEqual({ [id]: 2 });
  });
});
