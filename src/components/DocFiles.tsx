'use client';
import { useRef, useState, useTransition } from 'react';
import { removeAction, uploadAction } from '@/app/(app)/attachments/actions';
import type { Attachment, Entity } from '@/lib/attachments';
import { shrink } from './shrink';

/** The files of one document in a checklist row: small buttons (camera on a phone) and the files as links. */
export function DocFiles({ entity, id, path, tag, items, canRemove }: { entity: Entity; id: string; path: string; tag: string; items: Attachment[]; canRemove: boolean }) {
  const cam = useRef<HTMLInputElement>(null), lib = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const send = (input: HTMLInputElement | null) => {
    if (!input?.files?.length) return;
    const files = Array.from(input.files);
    input.value = '';
    start(async () => {
      setError('');
      for (const f of files) {
        const fd = new FormData(); fd.append('files', await shrink(f));
        try {
          const r = await uploadAction(entity, id, path, fd, tag);
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
    <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
      {items.map(a => (
        <div key={a.id} className="row" style={{ gap: 6 }}>
          <a href={`/files/${a.id}`} target="_blank" rel="noopener" dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{a.mime_type === 'application/pdf' ? '📄' : '🖼'} {a.file_name}</a>
          {canRemove && <button type="button" className="lnk bad" disabled={pending} onClick={() => remove(a)} style={{ fontSize: 12 }}>remove</button>}
        </div>))}
      <div className="row" style={{ gap: 6 }}>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => send(e.currentTarget)} />
        <input ref={lib} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => send(e.currentTarget)} />
        <button type="button" className="btn sm" disabled={pending} onClick={() => cam.current?.click()} title="Take a photo">📷</button>
        <button type="button" className="btn sm" disabled={pending} onClick={() => lib.current?.click()}>{pending ? 'Uploading…' : 'Add file'}</button>
      </div>
      {error && <div className="muted" style={{ color: 'var(--bad)' }}>{error}</div>}
    </div>
  );
}
