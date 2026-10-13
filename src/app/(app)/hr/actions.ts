'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import * as hr from '@/lib/hr';
import { RuleError } from '@/lib/ledger';
import { today } from '@/lib/dates';

const msg = (e: unknown) => {
  if (e instanceof RuleError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  if (/duplicate key/.test(m)) return 'That employee code is already used.';
  console.error(e);
  return 'Something went wrong. Nothing was changed.';
};
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const opt = (f: FormData, k: string) => s(f, k) || null;

function fileInput(f: FormData): hr.FileInput {
  return {
    code: s(f, 'code'), name: s(f, 'name'), job_title: s(f, 'job_title'), dept_id: opt(f, 'dept_id'), project_id: opt(f, 'project_id'), hire_date: opt(f, 'hire_date'),
    active: f.get('active') !== 'off', work_location: (s(f, 'work_location') || 'office') as hr.WorkLocation,
    national_id: s(f, 'national_id'), phone: s(f, 'phone'), personal_email: s(f, 'personal_email'), address: s(f, 'address'), birth_date: opt(f, 'birth_date'), gender: opt(f, 'gender'),
    contract_type: opt(f, 'contract_type'), contract_start: opt(f, 'contract_start'), contract_end: opt(f, 'contract_end'), probation_end: opt(f, 'probation_end'),
    insurance_no: s(f, 'insurance_no'), emergency_name: s(f, 'emergency_name'), emergency_phone: s(f, 'emergency_phone'), notes: s(f, 'notes'),
  };
}

export async function createFileAction(f: FormData) {
  const user = await requireUser('hr', 'finance');
  let id = '';
  try { id = await hr.saveEmployeeFile(user, fileInput(f)); } catch (e) { redirect(`/hr/employees/new?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/hr/employees/${id}?saved=1`);
}

export async function saveFileAction(id: string, f: FormData) {
  const user = await requireUser('hr', 'finance');
  try { await hr.saveEmployeeFile(user, { id, ...fileInput(f), active: f.get('active') === 'on' }); } catch (e) { redirect(`/hr/employees/${id}?error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/hr/employees/${id}?saved=1`);
}

export async function saveDocumentsAction(id: string, f: FormData) {
  const user = await requireUser('hr', 'finance');
  const rows = hr.DOCUMENTS.map(d => ({
    key: d.key, status: s(f, `st_${d.key}`) || 'missing', qty: s(f, `qty_${d.key}`) ? Number(s(f, `qty_${d.key}`)) : null,
    received_on: opt(f, `on_${d.key}`), note: s(f, `note_${d.key}`),
  }));
  try { await hr.saveDocuments(user, id, rows, today()); } catch (e) { redirect(`/hr/employees/${id}?tab=documents&error=${encodeURIComponent(msg(e))}`); }
  revalidatePath(`/hr/employees/${id}`); revalidatePath('/hr');
  redirect(`/hr/employees/${id}?tab=documents&saved=1`);
}

/** The temporary password is shown once from a short-lived cookie, never in the address bar or the server log. */
export async function createLoginAction(id: string, f: FormData) {
  const user = await requireUser('hr');
  let r: { password: string; email: string };
  try { r = await hr.createLogin(user, id, s(f, 'email')); } catch (e) { redirect(`/hr/employees/${id}?tab=login&error=${encodeURIComponent(msg(e))}`); }
  (await cookies()).set('rsa_flash', `Login created for ${r.email}. Temporary password: ${r.password} (also emailed when email is set up). Shown once; pass it on now.`,
    { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: `/hr/employees/${id}`, maxAge: 60 });
  revalidatePath('/', 'layout');
  redirect(`/hr/employees/${id}?tab=login`);
}

export async function linkLoginAction(id: string, f: FormData) {
  const user = await requireUser('hr');
  try { await hr.linkLogin(user, id, opt(f, 'user_id')); } catch (e) { redirect(`/hr/employees/${id}?tab=login&error=${encodeURIComponent(msg(e))}`); }
  revalidatePath('/', 'layout');
  redirect(`/hr/employees/${id}?tab=login&saved=1`);
}
