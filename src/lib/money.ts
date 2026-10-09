export const r2 = (n: number | string | null | undefined) => Math.round((Number(n) || 0) * 100) / 100;

const f = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (n: number | null | undefined) => (n == null ? '' : f.format(r2(n)));

/** Parses what a user typed ("12,500.5") into a number, or 0. */
export const parseAmount = (s: FormDataEntryValue | string | null | undefined) =>
  r2(String(s ?? '').replace(/[,\s]/g, ''));
