// The design phase's fixed parts: kinds, steps, default drawing lists and labels.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAWINGS, EDITABLE, KINDS, OPEN_STATUSES, STEPS, daysWaiting, isStep, kindLabel, statusLabel, stepLabel } from '@/lib/design-calc';

describe('design-calc', () => {
  it('knows the three kinds of set, the three signers in order and the default drawings', () => {
    expect(KINDS.map(k => k[1])).toEqual(['Main Concept 2D', 'Main Concept 3D', 'Shop drawings']);
    expect(STEPS.map(s => s.position)).toEqual(['design_head', 'to_head', 'eng_director']);
    expect(DEFAULT_DRAWINGS.shop).toHaveLength(14);
    expect(DEFAULT_DRAWINGS.concept_2d.length + DEFAULT_DRAWINGS.concept_3d.length).toBe(11);
    expect(new Set(DEFAULT_DRAWINGS.shop.map(d => d[0])).size).toBe(14);
    expect(kindLabel('shop')).toBe('Shop drawings');
    expect(stepLabel('to_head')).toBe('Technical office head');
    expect(isStep('director')).toBe(true);
    expect(isStep('approved')).toBe(false);
    expect(statusLabel('ifc')).toBe('Issued for construction');
    expect(OPEN_STATUSES).not.toContain('client_approved');
    expect(OPEN_STATUSES).not.toContain('ifc');
    expect(EDITABLE).toEqual(['draft', 'rejected']);
  });
  it('counts whole days waiting at a step', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(daysWaiting(new Date('2026-10-13T08:00:00Z'), now)).toBe(0);
    expect(daysWaiting(new Date('2026-10-10T13:00:00Z'), now)).toBe(2);
    expect(daysWaiting('2026-10-01T12:00:00Z', now)).toBe(12);
  });
});
