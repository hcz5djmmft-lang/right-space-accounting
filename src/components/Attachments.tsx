'use client';
import { useRef, useState, useTransition } from 'react';
import { removeAction, uploadAction } from '@/app/(app)/attachments/actions';
import type { Attachment, Entity } from '@/lib/attachments';

/** Receipts and photos on a document. On a phone the two buttons open the camera or the photo library. */
export function Attachments({ entity, id, path, items, userId, canRemove, locked }: {
  entity: Entity; id: string; path: string; items: Attachment[]; userId: string; canRemove: boolean; locked: boolean;
}) {
  const cam = useRef<HTMLInputElement>(null), lib = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const send = (input: HTMLInputElement | null) => {
    if (!input?.files?.length) return;
    const fd = new FormData();
    for (const f of Array.from(input.files)) fd.append('files', f);
    input.value = '';
    start(async () => { const r = await uploadAction(entity, id, path, fd); setError(r.error ?? ''); });
  };
  const remove = (a: Attachment) => {
    if (!confirm(`Remove ${a.file_name}?`)) return;
    start(async () => { const r = await removeAction(a.id, path); setError(r.error ?? ''); });
  };
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Receipts &amp; photos {items.length ? `(${items.length})` : ''}</h2>
        <div className="row">
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => send(e.currentTarget)} />
          <input ref={lib} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => send(e.currentTarget)} />
          <button type="button" className="btn" disabled={pending} onClick={() => cam.current?.click()}>📷 Take photo</button>
          <button type="button" className="btn" disabled={pending} onClick={() => lib.current?.click()}>{pending ? 'Uploading…' : 'Add file'}</button>
        </div>
      </div>
      {error && <div className="msg bad" style={{ marginTop: 10 }}>{error}</div>}
      {!items.length && <p className="muted" style={{ margin: '10px 0 0' }}>No receipt attached yet. Photos and PDFs up to 4 MB.</p>}
      {items.length > 0 && (
        <div className="thumbs">
          {items.map(a => (
            <figure key={a.id} className="thumb">
              <a href={`/files/${a.id}`} target="_blank" rel="noopener">
                {a.mime_type.startsWith('image/') && a.mime_type !== 'image/heic'
                  ? <img src={`/files/${a.id}`} alt={a.file_name} loading="lazy" />
                  : <div className="thumb-doc">{a.mime_type === 'application/pdf' ? 'PDF' : 'HEIC'}</div>}
              </a>
              <figcaption>
                <span dir="auto" title={a.file_name}>{a.file_name}</span>
                <small className="muted">{a.who ?? ''} · {a.at} · {(a.size_bytes / 1024).toFixed(0)} KB</small>
                {!locked && (canRemove || a.uploaded_by === userId) && (
                  <button type="button" className="lnk bad" disabled={pending} onClick={() => remove(a)}>Remove</button>)}
              </figcaption>
            </figure>))}
        </div>)}
    </div>
  );
}
