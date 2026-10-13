// The Project Information form AF-PI-01 without a database: reading answers, what is still missing, when the design phase applies.
import { describe, expect, it } from 'vitest';
import { ATTACHMENTS, FIELDS, SCOPE, SECTIONS, answered, designIncluded, fieldOf, isComplete, missing, parseAnswer, parseAnswers, showAnswer } from '@/lib/project-form';

describe('the form', () => {
  it('has the 35 typed fields of the form in 6 sections, 14 scope options and 3 attachment slots (40 inputs with the two header blanks)', () => {
    expect(SECTIONS).toHaveLength(6);
    expect(FIELDS).toHaveLength(35);
    expect(SCOPE).toHaveLength(14);
    expect(ATTACHMENTS.map(a => a[0])).toEqual(['photos', 'drawings', 'layout']);
    expect(new Set(FIELDS.map(f => f.key)).size).toBe(35);
    expect(FIELDS.filter(f => f.required).map(f => f.key)).toEqual(['client_name', 'title', 'pi_date', 'unit_type', 'gross_area', 'unit_status', 'finishing_level', 'design_status', 'scope', 'pricing_method']);
  });
});

describe('parseAnswer', () => {
  it('reads each kind and refuses what does not fit', () => {
    expect(parseAnswer(fieldOf('gross_area')!, '1,250.5')).toEqual({ value: 1250.5 });
    expect(parseAnswer(fieldOf('gross_area')!, 'big')).toMatchObject({ error: /enter a number/ });
    expect(parseAnswer(fieldOf('bedrooms')!, '3')).toEqual({ value: 3 });
    expect(parseAnswer(fieldOf('bedrooms')!, '2.5')).toMatchObject({ error: /whole number/ });
    expect(parseAnswer(fieldOf('pi_date')!, '2026-10-13')).toEqual({ value: '2026-10-13' });
    expect(parseAnswer(fieldOf('pi_date')!, '13/10/2026')).toMatchObject({ error: /choose a date/ });
    expect(parseAnswer(fieldOf('unit_type')!, 'Duplex')).toEqual({ value: 'Duplex' });
    expect(parseAnswer(fieldOf('unit_type')!, 'Villa')).toMatchObject({ error: /one of the options/ });
    expect(parseAnswer(fieldOf('permits')!, 'yes')).toEqual({ value: true });
    expect(parseAnswer(fieldOf('permits')!, 'no')).toEqual({ value: false });
    expect(parseAnswer(fieldOf('scope')!, ['painting', 'doors', 'nonsense'])).toEqual({ value: ['painting', 'doors'] });
    expect(parseAnswer(fieldOf('scope')!, [])).toEqual({});
    expect(parseAnswer(fieldOf('client_name')!, '  Mr Hassan ')).toEqual({ value: 'Mr Hassan' });
    expect(parseAnswer(fieldOf('client_name')!, '')).toEqual({});
    expect(parseAnswer(fieldOf('client_name')!, null)).toEqual({});
  });
});

describe('a person field', () => {
  it('takes the employee pick, else the typed name', () => {
    const f = fieldOf('designer')!;
    expect(f.kind).toBe('person');
    expect(parseAnswers(k => ({ designer: 'e:emp-1', designer_other: 'ignored' } as Record<string, string>)[k] ?? null, () => []).data.designer).toBe('e:emp-1');
    expect(parseAnswers(k => ({ designer: '', designer_other: 'Studio Nour' } as Record<string, string>)[k] ?? null, () => []).data.designer).toBe('Studio Nour');
    expect(parseAnswers(k => ({ designer: '', designer_other: '' } as Record<string, string>)[k] ?? null, () => []).data.designer).toBeUndefined();
  });
});

describe('parseAnswers, missing and completeness', () => {
  const posted: Record<string, string | string[]> = {
    client_name: 'Mr Hassan', title: 'PH-B1402', pi_date: '2026-10-13', unit_type: 'Apartment', gross_area: '180', unit_status: 'Bare Shell',
    finishing_level: 'Lux', design_status: 'To Be Prepared', scope: ['painting', 'tiling'], pricing_method: 'Detailed BOQ', bedrooms: '3', permits: 'yes',
  };
  const get = (k: string) => (Array.isArray(posted[k]) ? null : posted[k] ?? null);
  const getAll = (k: string) => (Array.isArray(posted[k]) ? posted[k] as string[] : []);
  it('collects the answers and lists the required fields still blank', () => {
    const { data, errors } = parseAnswers(get, getAll);
    expect(errors).toEqual([]);
    expect(answered(data)).toBe(12);
    expect(missing(data)).toEqual([]);
    expect(isComplete(data)).toBe(true);
    expect(designIncluded(data)).toBe(true);
    expect(designIncluded({ ...data, design_status: 'Ready' })).toBe(false);
    const { data: half } = parseAnswers(k => (k === 'client_name' ? 'X' : null), () => []);
    expect(missing(half)).toEqual(['Project title / reference no.', 'Date of PI sheet', 'Unit type', 'Gross area (m²)', 'Current unit status', 'Finishing level', 'Interior design status', 'Scope of work', 'Pricing method']);
    expect(isComplete(half)).toBe(false);
  });
  it('reports every bad answer at once', () => {
    const { errors } = parseAnswers(k => ({ gross_area: 'x', pi_date: 'y' } as Record<string, string>)[k] ?? null, () => []);
    expect(errors).toHaveLength(2);
  });
  it('prints answers as the form does', () => {
    expect(showAnswer(fieldOf('scope')!, ['painting'])).toBe('أعمال دهانات · Painting');
    expect(showAnswer(fieldOf('permits')!, false)).toBe('No');
    expect(showAnswer(fieldOf('gross_area')!, 180)).toBe('180');
    expect(showAnswer(fieldOf('gross_area')!, undefined)).toBe('');
  });
});
