'use client';
import { useState } from 'react';
import { tr, type Lang } from '@/lib/i18n';

export type PickerCategory = { key: string; label: string; project: boolean; rule: 'office' | 'site' };
export type PickerProject = { id: string; code: string; name: string; pinned: boolean; radius: number };
export type Office = { set: boolean; radius: number };

/** What the clock-in (or the switch) is for: the category, the project when the category is work on one, and how the position will be checked. */
export function CategoryPicker({ title, categories, projects, category, project, office, checkPosition = true, lang = 'en' }: { title: string; categories: PickerCategory[]; projects: PickerProject[]; category: string; project: string | null; office: Office; checkPosition?: boolean; lang?: Lang }) {
  const t = (x: string, v?: Record<string, string | number>) => tr(lang, x, v);
  const [cat, setCat] = useState(categories.some(c => c.key === category) ? category : categories[0]?.key ?? 'office');
  const [proj, setProj] = useState(project && projects.some(p => p.id === project) ? project : '');
  const c = categories.find(x => x.key === cat);
  const p = projects.find(x => x.id === proj);
  const hint = !c ? '' : c.project && projects.length === 0 ? t('No active project yet: ask Engineering or Finance to add it, or clock in for Office.') : c.project && !p ? t('Choose the project.')
    : !checkPosition ? t('No selfie or position for a switch: the stretch so far is closed and the new one starts now.')
    : c.rule === 'site' ? (p!.pinned ? t('Clock in within {m} m of the {code} location pin.', { m: p!.radius, code: p!.code }) : t('{code} has no location pin yet: your position is recorded only.', { code: p!.code }))
    : office.set ? t('Clock in within {m} m of the office.', { m: office.radius }) : t('The office location is not set yet: your position is recorded only.');
  return (
    <div className="grid g2" style={{ alignItems: 'end' }}>
      <label className="f"><span>{title}</span>
        <select className="inp" name="category" value={cat} onChange={e => setCat(e.target.value)}>{categories.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
      {c?.project && (
        <label className="f"><span>{t('Project')}</span>
          <select className="inp" name="project" value={proj} onChange={e => setProj(e.target.value)} required>
            <option value="">{t('Choose…')}</option>{projects.map(x => <option key={x.id} value={x.id}>{x.code === x.name ? x.code : `${x.code} · ${x.name}`}</option>)}
          </select></label>)}
      <div className="muted" style={{ fontSize: 12, gridColumn: '1 / -1' }}>{hint}</div>
    </div>
  );
}
