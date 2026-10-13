import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { listAttachments } from '@/lib/attachments';
import { ATTACHMENTS, FIELDS, SECTIONS, type Answer, type Field } from '@/lib/project-form';
import { canProjects, getInfo, phaseLabel } from '@/lib/projects';
import { DocFiles } from '@/components/DocFiles';
import { completeFormAction, saveFormAction } from './actions';

export default async function ProjectFormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; new?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { saved, error, new: isNew } = await searchParams;
  const [p] = await sql<{ id: string; code: string; name: string; phase: string | null; is_office: boolean }[]>`select id, code, name, phase, is_office from projects where id = ${id}`;
  if (!p || p.is_office) notFound();
  const [info, files, employees] = await Promise.all([getInfo(id), listAttachments('project', id),
    sql<{ id: string; name: string; job_title: string | null }[]>`select id, name, job_title from employees where active order by name`]);
  const edit = canProjects(user);
  const path = `/cost-centers/${id}/form`;
  const v = (k: string): Answer | undefined => info.data[k];
  const str = (k: string) => { const x = v(k); return x === undefined ? '' : String(x); };
  const noteBox = (f: Field) => <input className="inp" name={`n_${f.key}`} defaultValue={info.notes[f.key] ?? ''} dir="auto" placeholder="Notes / attachments" style={{ fontSize: 13, minHeight: 34 }} disabled={!edit} />;
  const input = (f: Field) => {
    switch (f.kind) {
      case 'choice': return <select className="inp" name={f.key} defaultValue={str(f.key)} disabled={!edit}><option value="">—</option>{f.options!.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
      case 'yesno': return <select className="inp" name={f.key} defaultValue={v(f.key) === undefined ? '' : v(f.key) ? 'yes' : 'no'} disabled={!edit}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>;
      case 'multi': return <div className="grid g2" style={{ gap: 4 }}>{f.options!.map(o => <label key={o[0]} className="row" style={{ fontSize: 14, alignItems: 'flex-start' }}><input type="checkbox" name={f.key} value={o[0]} defaultChecked={((v(f.key) as string[] | undefined) ?? []).includes(o[0])} disabled={!edit} /><span dir="auto">{o[1]}</span></label>)}</div>;
      case 'long': return <textarea className="inp" name={f.key} defaultValue={str(f.key)} dir="auto" rows={2} disabled={!edit} />;
      case 'date': return <input className="inp" type="date" name={f.key} defaultValue={str(f.key)} disabled={!edit} />;
      case 'number': case 'int': return <input className="inp mono" name={f.key} defaultValue={str(f.key)} inputMode="decimal" disabled={!edit} />;
      case 'person': {
        const emp = str(`${f.key}_emp`);
        return (
          <div className="grid g2" style={{ gap: 6 }}>
            <select className="inp" name={f.key} defaultValue={emp ? `e:${emp}` : ''} disabled={!edit}><option value="">Pick an employee…</option>{employees.map(e => <option key={e.id} value={`e:${e.id}`}>{e.name}{e.job_title ? ` · ${e.job_title}` : ''}</option>)}</select>
            <input className="inp" name={`${f.key}_other`} defaultValue={emp ? '' : str(f.key)} dir="auto" placeholder="or an outside designer: name and contact" disabled={!edit} />
          </div>);
      }
      default: return <input className="inp" name={f.key} defaultValue={str(f.key)} dir="auto" disabled={!edit} />;
    }
  };
  return (
    <>
      <div className="head"><div><h1>{p.code} · Project Information</h1>
        <p>Form AF-PI-01 · {info.answered} of {FIELDS.length} answered{info.completed_at ? ` · complete (${info.completed_by}, ${info.completed_at})` : ''}{p.phase ? ` · phase: ${phaseLabel(p.phase)}` : ''}</p></div>
        <Link className="btn" href={`/cost-centers/${id}`}>Project page</Link></div>
      {isNew && <div className="msg good">Project {p.code} created. Now answer the form; the project moves on once it is complete.</div>}
      {saved && <div className="msg good">Saved.</div>}
      {error && <div className="msg bad">{error}</div>}
      {!info.completed_at && info.missing.length > 0 && info.answered > 0 && <div className="msg" style={{ background: 'var(--panel)' }}>Still to answer before the form is complete: {info.missing.join(', ')}.</div>}
      <form action={saveFormAction.bind(null, id)}>
        <div className="card"><div className="grid g3">
          <label className="f"><span>Project no.</span><input className="inp mono" value={p.code} disabled /></label>
          <label className="f"><span>Rev.</span><input className="inp" name="rev" defaultValue={info.rev} placeholder="0" disabled={!edit} /></label>
        </div></div>
        {SECTIONS.map(sec => (
          <div key={sec.key} className="card">
            <h2 style={{ marginTop: 0 }}>{sec.title}</h2>
            <div className="grid g2" style={{ gap: 14 }}>{sec.fields.map(f => (
              <div key={f.key} className="f" style={{ gridColumn: f.kind === 'multi' || f.kind === 'long' ? '1 / -1' : undefined }}>
                <span>{f.label}{f.required ? ' *' : ''}</span>
                {input(f)}
                {noteBox(f)}
              </div>))}</div>
          </div>))}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>7. Attachments and general layout</h2>
          <div className="grid g3">{ATTACHMENTS.map(([tag, label]) => (
            <div key={tag} className="f"><span>{label}</span><DocFiles entity="project" id={id} path={path} tag={tag} items={files.filter(f => f.tag === tag)} canRemove={edit} /></div>))}</div>
        </div>
        {edit && (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginBottom: 16 }}>
            <button className="btn">Save form</button>
            <button className="btn pri" formAction={completeFormAction.bind(null, id)}>{info.completed_at ? 'Save and keep complete' : 'Mark the form complete'}</button>
          </div>)}
      </form>
    </>
  );
}
