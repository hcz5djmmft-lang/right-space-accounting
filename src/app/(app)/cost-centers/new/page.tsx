import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/books';
import { sql } from '@/lib/db';
import { ProjectFields } from '@/components/ProjectFields';
import { createProject } from '../actions';

export default async function NewProject({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser('finance');
  const { error } = await searchParams;
  const [settings, customers] = await Promise.all([getSettings(), sql<{ id: string; name: string }[]>`select id, name from parties where type = 'customer' order by name`]);
  return (
    <>
      <div className="head"><div><h1>New project</h1><p>Saving creates the project's own GL codes (header 20000-N and the 32 project codes).</p></div></div>
      {error && <div className="msg bad">{error}</div>}
      <form action={createProject} className="card">
        <ProjectFields cats={settings.cats} customers={customers} isNew />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn pri">Create project</button></div>
      </form>
    </>
  );
}
