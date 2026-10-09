'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { audit, createProjectCodes } from '@/lib/books';
import { parseAmount } from '@/lib/money';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const optNum = (f: FormData, k: string) => (s(f, k) ? parseAmount(s(f, k)) : null);
const optDate = (f: FormData, k: string) => s(f, k) || null;

export async function createProject(form: FormData) {
  const user = await requireUser('finance');
  const code = s(form, 'code');
  if (!code) redirect('/cost-centers/new?error=' + encodeURIComponent('Enter the project code.'));
  let id = '', err = '';
  try {
    id = await sql.begin(async tx => {
      const [p] = await tx<{ id: string }[]>`insert into projects (code, name, client_id, type, service, unit, location, area, contract, budget, start_date, end_date, description)
        values (${code}, ${s(form, 'name') || code}, ${s(form, 'client') || null}, ${s(form, 'type') || null}, ${s(form, 'service') || null},
          ${s(form, 'unit') || null}, ${s(form, 'location') || null}, ${optNum(form, 'area')}, ${optNum(form, 'contract')}, ${optNum(form, 'budget')},
          ${optDate(form, 'start')}, ${optDate(form, 'end')}, ${s(form, 'description') || null}) returning id`;
      const r = await createProjectCodes(tx, p.id, code);
      await audit(tx, user, 'project', p.id, 'Created', `${r.count} GL codes created with suffix -${r.suffix}`);
      return p.id;
    });
  } catch (e) {
    err = /duplicate key/.test(String(e)) ? `A project with code ${code} already exists.` : (e as Error).message;
  }
  revalidatePath('/', 'layout');
  redirect(err ? '/cost-centers/new?error=' + encodeURIComponent(err) : `/cost-centers/${id}`);
}

export async function updateProject(id: string, form: FormData) {
  const user = await requireUser('finance');
  await sql.begin(async tx => {
    await tx`update projects set name = ${s(form, 'name')}, client_id = ${s(form, 'client') || null}, type = ${s(form, 'type') || null},
      service = ${s(form, 'service') || null}, unit = ${s(form, 'unit') || null}, location = ${s(form, 'location') || null},
      area = ${optNum(form, 'area')}, contract = ${optNum(form, 'contract')}, budget = ${optNum(form, 'budget')},
      status = ${s(form, 'status') || 'Active'}, start_date = ${optDate(form, 'start')}, end_date = ${optDate(form, 'end')},
      description = ${s(form, 'description') || null} where id = ${id}`;
    await audit(tx, user, 'project', id, 'Edited');
  });
  revalidatePath('/', 'layout');
  redirect(`/cost-centers/${id}?saved=1`);
}

export async function createDepartment(form: FormData) {
  const user = await requireUser('finance');
  const code = s(form, 'code').toUpperCase(), name = s(form, 'name');
  if (code && name) {
    const [d] = await sql<{ id: string }[]>`insert into departments (code, name) values (${code}, ${name}) on conflict (code) do nothing returning id`;
    if (d) await audit(sql, user, 'department', d.id, 'Created');
  }
  revalidatePath('/', 'layout');
  redirect('/cost-centers');
}
