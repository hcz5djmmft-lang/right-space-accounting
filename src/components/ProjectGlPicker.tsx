'use client';
import { useState } from 'react';

type P = { id: string; code: string; name: string };
type C = { code: string; name: string };

/** The project and its GL code (update 20, item 31): the GL box lists only the codes of the project picked. */
export function ProjectGlPicker({ projects, codes, project, account }: { projects: P[]; codes: Record<string, C[]>; project: string; account: string }) {
  const [pid, setPid] = useState(project);
  const list = codes[pid] ?? [];
  return (
    <>
      <label className="f"><span>Project</span><select className="inp" name="project" required value={pid} onChange={e => setPid(e.target.value)}>
        <option value="">Select…</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` · ${p.name}` : ''}</option>)}</select></label>
      <label className="f"><span>GL code (the project&apos;s copy)</span><select className="inp mono" name="account" required key={pid} defaultValue={list.some(c => c.code === account) ? account : ''} disabled={!pid}>
        <option value="">{pid ? 'Select…' : 'Choose the project first'}</option>{list.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label>
    </>
  );
}
