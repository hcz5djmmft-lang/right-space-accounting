// The BOQ upload: reading .xlsx and CSV, finding the columns in English or Arabic, matching lines to the project's GL
// codes, and (against the test database, see books.test.ts) the BOQ against actual spending and purchase orders.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { readDelimited, readSpreadsheet, readXlsx } from '@/lib/xlsx';
import { guessAccount, num, parseBoq } from '@/lib/boq-parse';

/** A minimal zip (deflated entries), enough for an .xlsx. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(Buffer.byteLength(text), 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(Buffer.byteLength(text), 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xlsx = zip({
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="BOQ" sheetId="1" r:id="rId7"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Target="worksheets/boq.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>م</t></si><si><t>البيان</t></si><si><t>الوحدة</t></si><si><t>الكمية</t></si><si><t>الفئة</t></si><si><t>الإجمالي</t></si>' +
    '<si><r><t>أعمال </t></r><r><t>تأسيس سباكة</t></r></si><si><t>م2</t></si><si><t>بورسلين &amp; لاصق</t></si><si><t>الإجمالي</t></si></sst>',
  'xl/worksheets/boq.xml': '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>BOQ El Zohor</t></is></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" t="s"><v>3</v></c><c r="E3" t="s"><v>4</v></c><c r="F3" t="s"><v>5</v></c></row>' +
    '<row r="4"><c r="A4"><v>1</v></c><c r="B4" t="s"><v>6</v></c><c r="C4" t="str"><v>lot</v></c><c r="D4"><v>1</v></c><c r="E4"><v>45000</v></c><c r="F4"><f>D4*E4</f><v>45000</v></c></row>' +
    '<row r="5"><c r="A5"><v>2</v></c><c r="B5" t="s"><v>8</v></c><c r="C5" t="s"><v>7</v></c><c r="D5"><v>120.5</v></c><c r="E5"><v>650</v></c></row>' +
    '<row r="7"><c r="B7" t="s"><v>9</v></c><c r="F7"><v>123325</v></c></row>' +
    '</sheetData></worksheet>',
});

describe('reading spreadsheets', () => {
  it('reads the first sheet of an .xlsx: shared strings, rich text, inline strings, gaps and formulas', () => {
    const rows = readXlsx(xlsx);
    expect(rows[0]).toEqual(['BOQ El Zohor']);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(['م', 'البيان', 'الوحدة', 'الكمية', 'الفئة', 'الإجمالي']);
    expect(rows[3]).toEqual(['1', 'أعمال تأسيس سباكة', 'lot', '1', '45000', '45000']);
    expect(rows[4]).toEqual(['2', 'بورسلين & لاصق', 'م2', '120.5', '650']);
    expect(readSpreadsheet(xlsx)).toEqual(rows);
  });
  it('reads CSV with quotes, and tab-separated text pasted from Excel', () => {
    expect(readDelimited('﻿a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
    expect(readDelimited('Description\tAmount\nTiles\t1,200')).toEqual([['Description', 'Amount'], ['Tiles', '1,200']]);
  });
  it('refuses an old .xls with a clear message', () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => readSpreadsheet(xls, 'boq.xls')).toThrow(/save it as \.xlsx/);
  });
});

describe('parsing a BOQ', () => {
  it('finds the Arabic header row, computes missing amounts and leaves out the totals row', () => {
    const { lines, skipped } = parseBoq(readXlsx(xlsx));
    expect(lines).toEqual([
      { item_no: '1', description: 'أعمال تأسيس سباكة', unit: 'lot', qty: 1, rate: 45000, amount: 45000, code: '' },
      { item_no: '2', description: 'بورسلين & لاصق', unit: 'م2', qty: 120.5, rate: 650, amount: 78325, code: '' },
    ]);
    expect(skipped).toBe(1);
  });
  it('reads an English sheet with a GL code column', () => {
    const { lines } = parseBoq(readDelimited('GL code,Item,Description,Unit,Qty,Unit price,Amount\n24004,2,Porcelain tiles,m2,120,650,78000\n,,Subtotal,,,,78000'));
    expect(lines).toEqual([{ item_no: '2', description: 'Porcelain tiles', unit: 'm2', qty: 120, rate: 650, amount: 78000, code: '24004' }]);
  });
  it('says what is missing when there is no header row', () => {
    expect(() => parseBoq([['a', 'b'], ['1', '2']])).toThrow(/No header row/);
  });
  it('reads numbers as typed', () => {
    expect([num('1,250.50'), num('١٢٥٠٫٥'), num('(300)'), num('EGP 40'), num(''), num('n/a')]).toEqual([1250.5, 1250.5, -300, 40, 0, 0]);
  });
  it("matches lines to the project's GL codes by code, by name, or by shared words", () => {
    const accs = [{ code: '22002-3', name: 'تأسيس سباكة' }, { code: '24004-3', name: 'مستلزمات سيراميك' }, { code: '26003-3', name: 'مصنعيات سيراميك' }, { code: '28004-3', name: 'أسمنت' }];
    expect(guessAccount({ code: '24004', description: 'x' }, accs)).toBe('24004-3');
    expect(guessAccount({ code: '26003-9', description: 'x' }, accs)).toBe('26003-3');
    expect(guessAccount({ code: '', description: 'أعمال تأسيس سباكة للحمامات' }, accs)).toBe('22002-3');
    expect(guessAccount({ code: '', description: 'توريد اسمنت بورتلاندي' }, accs)).toBe('28004-3');
    expect(guessAccount({ code: '', description: 'مصنعيات تركيب سيراميك الأرضيات' }, accs)).toBe('26003-3');
    expect(guessAccount({ code: '', description: 'Gypsum ceiling' }, accs)).toBeNull();
  });
});

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/rsa_test';
const { sql } = await import('@/lib/db');
const boq = await import('@/lib/boq');
const books = await import('@/lib/books');
// @ts-expect-error plain JS script
const { importOld } = await import('../scripts/import-old.mjs');
const eng = { id: '', email: 'eng@x.test', name: 'Youssef', roles: ['engineering'] };
const fin = { id: '', email: 'fin@x.test', name: 'Fatma', roles: ['finance'] };
const project = 'cs-ch2505'; // GL suffix 2

describe('BOQ against actual', () => {
  beforeAll(async () => {
    const ctx = { window: {} as Record<string, unknown> };
    vm.runInNewContext(fs.readFileSync(process.env.OLD_SNAPSHOT ?? '/home/claude/sample-data.js', 'utf8'), ctx);
    await sql`truncate sessions, users cascade`;
    await importOld(sql, ctx.window.__SEED, { replace: true });
    for (const u of [eng, fin]) u.id = (await sql`insert into users (email, name, password_hash, roles) values (${u.email}, ${u.name}, 'x', ${u.roles}) returning id`)[0].id;
    await sql`update settings set lock_date = null where id = 1`;
  });
  afterAll(async () => { await sql.end(); });

  it("uploads a BOQ for a project and matches what it can to the project's codes", async () => {
    const csv = 'Description,Qty,Unit price,Amount\nتأسيس سباكة,1,45000,45000\nمستلزمات سيراميك - porcelain,100,600,60000\nGypsum ceiling,50,300,15000\n';
    await expect(boq.uploadBoq({ ...fin, roles: [] } as never, project, 'b.csv', Buffer.from(csv))).rejects.toThrow(/Only Finance or Engineering/);
    expect(await boq.uploadBoq(eng as never, project, 'b.csv', Buffer.from(csv))).toEqual({ lines: 3, matched: 2, total: 120000 });
    const head = (await boq.getBoq(project))!;
    expect((await boq.getBoqLines(head.id)).map(l => l.account)).toEqual(['22002-2', '24004-2', null]);
  });

  it('compares each GL code: BOQ, actual spent and what is left, with unmatched lines apart', async () => {
    await books.saveEntry(fin as never, { date: '2026-10-11', ref: '', form: { type: 'expense', memo: 'Plumbing', bank: 'A120', items: [{ project, acc: '22002-2', amount: 50000 }, { project, acc: '28004-2', amount: 700 }] } }, 'post');
    const c = await boq.boqVsActual(project);
    const row = (code: string | null) => c.rows.find(r => r.code === code);
    expect(row('22002-2')).toMatchObject({ boq: 45000, actual: 50000, remaining: -5000, pct: 111 });
    expect(row('24004-2')).toMatchObject({ boq: 60000, actual: 0, remaining: 60000, pct: 0 });
    expect(row('28004-2')).toMatchObject({ boq: 0, actual: 700, pct: null });
    expect(row(null)).toMatchObject({ name: 'Not matched to a GL code yet', boq: 15000 });
    expect(c.total).toMatchObject({ boq: 120000, actual: 50700 });
  });

  it('a line matched by hand moves to its code; another project\'s code is refused', async () => {
    const head = (await boq.getBoq(project))!;
    const lines = await boq.getBoqLines(head.id);
    await expect(boq.setBoqAccounts(eng as never, project, { [lines[2].id]: '23001-1' })).rejects.toThrow(/not one of this project/);
    await boq.setBoqAccounts(eng as never, project, { [lines[2].id]: '23001-2' });
    const c = await boq.boqVsActual(project);
    expect(c.rows.find(r => r.code === '23001-2')).toMatchObject({ boq: 15000 });
    expect(c.rows.some(r => r.code === null)).toBe(false);
  });

  it('a new upload replaces the BOQ', async () => {
    await boq.uploadBoq(eng as never, project, 'v2.csv', Buffer.from('Description,Amount\nتأسيس سباكة,55000\n'));
    expect((await boq.boqVsActual(project)).total.boq).toBe(55000);
    await boq.deleteBoq(eng as never, project);
    expect(await boq.getBoq(project)).toBeNull();
  });
});
