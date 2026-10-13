// The company's Project Information form AF-PI-01, field by field, without a database: what the engineer who adds a project
// must answer. Every field also has a Notes / Attachments cell; photos, drawings and the layout sketch are attachments.

export type Kind = 'text' | 'long' | 'number' | 'int' | 'date' | 'choice' | 'yesno' | 'multi';
export type Field = { key: string; label: string; kind: Kind; options?: readonly (readonly [string, string])[]; required?: boolean };
export type Section = { key: string; title: string; fields: Field[] };
export type Answer = string | number | boolean | string[];
export type Answers = Record<string, Answer>;

/** The 14 scope checkboxes, in the form's order (Arabic as printed, with the English). */
export const SCOPE = [
  ['arch_mod', 'تعديلات معمارية · Architectural modifications'], ['demolition', 'هدم و تكسير مباني · Demolition'], ['masonry', 'مباني جديدة · New masonry'],
  ['electrical_fix', 'أعمال تأسيس كهرباء · Electrical first fix'], ['plumbing_fix', 'أعمال تأسيس صحي · Plumbing first fix'], ['hvac_fix', 'أعمال تأسيس تكييفات · HVAC first fix'],
  ['plastering', 'أعمال بياض ومحارة · Plastering'], ['ceilings', 'أعمال أسقف معلقة · Suspended ceilings'], ['marble_floor', 'أعمال رخام أرضيات · Marble flooring'],
  ['tiling', 'أعمال سيراميك وبورسلين · Ceramic and porcelain tiling'], ['painting', 'أعمال دهانات · Painting'], ['doors', 'أعمال أبواب · Doors'],
  ['windows', 'أعمال شبابيك و فتحات · Windows and openings'], ['marble_works', 'اعمال رخام · Marble works'],
] as const;
const opts = (...xs: string[]) => xs.map(x => [x, x] as const);

export const SECTIONS: Section[] = [
  { key: 'client', title: '1. Client & project data', fields: [
    { key: 'client_name', label: 'Client name', kind: 'text', required: true },
    { key: 'title', label: 'Project title / reference no.', kind: 'text', required: true },
    { key: 'compound', label: 'Compound / building', kind: 'text' },
    { key: 'unit_no', label: 'Unit no. / floor', kind: 'text' },
    { key: 'contact', label: 'Contact person', kind: 'text' },
    { key: 'phone', label: 'Phone / WhatsApp', kind: 'text' },
    { key: 'pi_date', label: 'Date of PI sheet', kind: 'date', required: true },
  ] },
  { key: 'unit', title: '2. Unit data', fields: [
    { key: 'unit_type', label: 'Unit type', kind: 'choice', options: opts('Apartment', 'Duplex', 'Roof'), required: true },
    { key: 'gross_area', label: 'Gross area (m²)', kind: 'number', required: true },
    { key: 'net_area', label: 'Net area (m²)', kind: 'number' },
    { key: 'bedrooms', label: 'No. of bedrooms', kind: 'int' },
    { key: 'bathrooms', label: 'No. of bathrooms', kind: 'int' },
    { key: 'receptions', label: 'No. of reception / living areas', kind: 'int' },
    { key: 'kitchen', label: 'Kitchen type', kind: 'choice', options: opts('Open', 'Closed') },
    { key: 'unit_status', label: 'Current unit status', kind: 'choice', options: opts('Bare Shell', 'Semi-Finished', 'Delivered'), required: true },
  ] },
  { key: 'design', title: '3. Design data', fields: [
    { key: 'finishing_level', label: 'Finishing level', kind: 'choice', options: opts('Economy', 'Standard', 'Lux'), required: true },
    { key: 'drawings_available', label: 'Architectural drawings available', kind: 'yesno' },
    { key: 'design_status', label: 'Interior design status', kind: 'choice', options: opts('Ready', 'To Be Prepared'), required: true },
    { key: 'designer', label: 'Designer name & contact', kind: 'text' },
    { key: 'style', label: 'Design style / theme', kind: 'text' },
    { key: 'layout_changes', label: 'Partition / layout changes required', kind: 'long' },
  ] },
  { key: 'scope', title: '4. Scope of finishing works', fields: [
    { key: 'scope', label: 'Scope of work', kind: 'multi', options: SCOPE, required: true },
    { key: 'excluded', label: 'Items excluded from scope', kind: 'long' },
  ] },
  { key: 'pricing', title: '5. Pricing & commercial data', fields: [
    { key: 'client_budget', label: 'Client budget (if provided)', kind: 'number' },
    { key: 'pricing_method', label: 'Pricing method', kind: 'choice', options: opts('Lump Sum', 'Unit Rate', 'Detailed BOQ'), required: true },
    { key: 'payment_terms', label: 'Payment terms / schedule', kind: 'long' },
    { key: 'advance', label: 'Advance payment (amount or %)', kind: 'text' },
    { key: 'retention_pct', label: 'Retention %', kind: 'number' },
    { key: 'duration', label: 'Target execution duration', kind: 'text' },
  ] },
  { key: 'site', title: '6. Execution & site data', fields: [
    { key: 'utilities', label: 'Utilities available (electricity / water)', kind: 'text' },
    { key: 'elevator', label: 'Elevator / freight access', kind: 'text' },
    { key: 'permits', label: 'Compound work permits required', kind: 'yesno' },
    { key: 'working_hours', label: 'Allowed working hours', kind: 'text' },
    { key: 'delivery_limits', label: 'Material delivery / storage restrictions', kind: 'long' },
    { key: 'client_supervisor', label: 'Client-side supervisor for handover', kind: 'text' },
  ] },
];
/** 7. Attachments and the General Layout box: files on the project, by tag. */
export const ATTACHMENTS = [['photos', 'Unit photos'], ['drawings', 'Architectural / design drawings'], ['layout', 'General layout (sketch or drawing)']] as const;
export const FIELDS: Field[] = SECTIONS.flatMap(s => s.fields);
export const fieldOf = (key: string) => FIELDS.find(f => f.key === key);

/** Turns what the form posted for one field into its answer; '' and an empty list mean "not answered" (undefined). */
export function parseAnswer(f: Field, raw: string | string[] | null | undefined): { value?: Answer; error?: string } {
  if (f.kind === 'multi') {
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(k => f.options?.some(o => o[0] === k));
    return list.length ? { value: list } : {};
  }
  const s = String(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '').trim();
  if (!s) return {};
  switch (f.kind) {
    case 'number': case 'int': {
      const n = Number(s.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) return { error: `${f.label}: enter a number.` };
      if (f.kind === 'int' && !Number.isInteger(n)) return { error: `${f.label}: enter a whole number.` };
      return { value: n };
    }
    case 'date': return /^\d{4}-\d\d-\d\d$/.test(s) ? { value: s } : { error: `${f.label}: choose a date.` };
    case 'choice': return f.options?.some(o => o[0] === s) ? { value: s } : { error: `${f.label}: choose one of the options.` };
    case 'yesno': return s === 'yes' || s === 'no' ? { value: s === 'yes' } : { error: `${f.label}: answer yes or no.` };
    default: return { value: s.slice(0, 2000) };
  }
}

/** All answers from a posted form (a getter per key, lists for the checkboxes), with the errors found. */
export function parseAnswers(get: (key: string) => string | null, getAll: (key: string) => string[]): { data: Answers; errors: string[] } {
  const data: Answers = {}, errors: string[] = [];
  for (const f of FIELDS) {
    const r = parseAnswer(f, f.kind === 'multi' ? getAll(f.key) : get(f.key));
    if (r.error) errors.push(r.error);
    else if (r.value !== undefined) data[f.key] = r.value;
  }
  return { data, errors };
}

export const answered = (data: Answers) => FIELDS.filter(f => data[f.key] !== undefined && data[f.key] !== '').length;
/** The required fields still blank, by label: the form is complete when none is. */
export const missing = (data: Answers) => FIELDS.filter(f => f.required && (data[f.key] === undefined || data[f.key] === '' || (Array.isArray(data[f.key]) && !(data[f.key] as string[]).length))).map(f => f.label);
export const isComplete = (data: Answers) => missing(data).length === 0;
/** A project whose interior design is still to be prepared goes through the Design phase; one with a ready design skips it. */
export const designIncluded = (data: Answers) => data.design_status === 'To Be Prepared';

/** An answer as the form prints it. */
export function showAnswer(f: Field, v: Answer | undefined): string {
  if (v === undefined || v === '') return '';
  if (f.kind === 'multi') return (v as string[]).map(k => f.options?.find(o => o[0] === k)?.[1] ?? k).join(', ');
  if (f.kind === 'yesno') return v ? 'Yes' : 'No';
  return String(v);
}
