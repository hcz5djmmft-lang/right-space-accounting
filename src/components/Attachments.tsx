'use client';
import { useRef, useState, useTransition } from 'react';
import { removeAction, uploadAction } from '@/app/(app)/attachments/actions';
import type { Attachment, Entity } from '@/lib/attachments';

const MAX_SIDE = 2000, SHRINK_ABOVE = 1.5 * 1024 * 1024;
/** Phone photos are 3–8 MB; a receipt is readable at 2000px. Big images are resized in the browser so uploads stay small and quick. PDFs and small files go up as they are. */
async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.size <= SHRINK_ABOVE || typeof createImageBitmap !== 'function') return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; } // HEIC or an odd file: the server still checks the size and the type
}

/** Receipts and photos on a document. On a phone the two buttons open the camera or the photo library. */
export function Attachments({ entity, id, path, items, userId, canRemove, locked }: {
  entity: Entity; id: string; path: string; items: Attachment[]; userId: string; canRemove: boolean; locked: boolean;
}) {
  const cam = useRef<HTMLInputElement>(null), lib = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const send = (input: HTMLInputElement | null) => {
    if (!input?.files?.length) return;
    const files = Array.from(input.files);
    input.value = '';
    start(async () => {
      setError('');
      // one request per file: the host accepts about 4.5 MB per request, so several files never share one
      for (const f of files) {
        const fd = new FormData(); fd.append('files', await shrink(f));
        try {
          const r = await uploadAction(entity, id, path, fd);
          if (r.error) { setError(r.error); break; }
        } catch { setError(`${f.name} could not be uploaded: it is too large (max 4 MB).`); break; }
      }
    });
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
