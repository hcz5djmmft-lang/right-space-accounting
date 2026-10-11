// Turns a BOQ spreadsheet (rows of cells) into BOQ lines, and suggests each line's GL code. Pure, so it can be unit-tested.
// The header row is found by its titles, in English or Arabic: GL code, item no., description, unit, quantity, unit price, amount.

export type BoqLine = { item_no: string; description: string; unit: string; qty: number; rate: number; amount: number; code: string };
type Col = 'code' | 'item' | 'desc' | 'unit' | 'qty' | 'rate' | 'amount';

const norm = (s: string) => String(s ?? '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
// the order matters: "unit price" is a price, not a unit; "total price" is an amount
const HEADERS: [Col, RegExp][] = [
  ['code', /^(gl|gl code|code|account|account code|cost code|كود|الكود|كود الحساب|رقم الحساب|الحساب)$/],
  ['amount', /(amount|total|value|اجمالي|الاجمالي|القيمه|الجمله|المبلغ)/],
  ['rate', /(rate|price|سعر|الفئه|فئه)/],
  ['qty', /(qty|quantity|الكميه|كميه|العدد)/],
  ['unit', /(unit|الوحده|وحده)/],
  ['item', /^(item|item no\.?|no\.?|#|s\/n|م|ن|البند|رقم البند|مسلسل)$/],
  ['desc', /(description|desc|item description|works|البيان|بيان|الوصف|وصف|الاعمال|اسم البند)/],
];
const TOTAL = /^(total|sub ?total|grand total|اجمالي|الاجمالي|المجموع|جمله)/;

/** A number as typed in Excel or Arabic: "1,250.50", "١٢٥٠", "(300)". Empty or text is 0. */
export function num(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.').replace(/[٬,\s]/g, '');
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '').replace(/[^\d.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Finds the header row (within the first 15 rows) and which column holds what. */
export function findColumns(rows: string[][]) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols: Partial<Record<Col, number>> = {};
    (rows[r] ?? []).forEach((cell, c) => {
      const h = norm(cell);
      if (!h) return;
      const hit = HEADERS.find(([k, re]) => cols[k] === undefined && re.test(h));
      if (hit) cols[hit[0]] = c;
    });
    if (cols.desc !== undefined && (cols.amount !== undefined || (cols.qty !== undefined && cols.rate !== undefined))) return { header: r, cols };
  }
  return null;
}

/** The BOQ lines of a sheet: every row with a description and an amount (or quantity × price), totals rows left out. */
export function parseBoq(rows: string[][]): { lines: BoqLine[]; skipped: number } {
  const f = findColumns(rows);
  if (!f) throw new Error('No header row found. The sheet needs a row with column titles such as Description, Qty, Unit price and Amount (or البيان، الكمية، الفئة، الإجمالي).');
  const { cols } = f;
  const at = (row: string[], k: Col) => (cols[k] === undefined ? '' : String(row[cols[k]!] ?? '').trim());
  const lines: BoqLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(f.header + 1)) {
    if (!row || row.every(c => !String(c ?? '').trim())) continue;
    const description = at(row, 'desc');
    const qty = num(at(row, 'qty')), rate = num(at(row, 'rate'));
    const amount = r2(cols.amount !== undefined && at(row, 'amount') !== '' ? num(at(row, 'amount')) : qty * rate);
    if (!description || !amount || (TOTAL.test(norm(description)) && !qty)) { skipped++; continue; }
    lines.push({ item_no: at(row, 'item'), description, unit: at(row, 'unit'), qty, rate, amount, code: at(row, 'code') });
  }
  return { lines, skipped };
}

export type AccountOption = { code: string; name: string };
const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).map(w => w.replace(/^ال/, '')).filter(w => w.length >= 3);

/**
 * The project GL code a BOQ line belongs to: its own code column when it names one of the project's codes (22002 or
 * 22002-3), else the code whose name it contains, else the code sharing the most words with it (at least two, or the
 * only word of a one-word name). Null when nothing fits; the line is then assigned by hand.
 */
export function guessAccount(line: Pick<BoqLine, 'code' | 'description'>, accounts: AccountOption[]): string | null {
  const c = line.code.replace(/\s/g, '');
  if (c) {
    const base = c.match(/^(\d{5})/)?.[1];
    const hit = accounts.find(a => a.code === c) ?? (base ? accounts.find(a => a.code.split('-')[0] === base) : undefined);
    if (hit) return hit.code;
  }
  const d = norm(line.description);
  const contained = accounts.filter(a => norm(a.name).length >= 3 && d.includes(norm(a.name))).sort((a, b) => b.name.length - a.name.length)[0];
  if (contained) return contained.code;
  const dw = new Set(words(line.description));
  let best: { code: string; score: number } | null = null;
  for (const a of accounts) {
    const aw = words(a.name);
    const score = aw.filter(w => dw.has(w)).length;
    if ((score >= 2 || (aw.length === 1 && score === 1)) && (!best || score > best.score)) best = { code: a.code, score };
  }
  return best?.code ?? null;
}
