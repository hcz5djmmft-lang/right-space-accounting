// Reads the first worksheet of an Excel .xlsx file, or a CSV / tab-separated text, into rows of cell text.
// No dependency: an .xlsx file is a zip of XML parts, read here with node's zlib. Old .xls files are not supported.
import zlib from 'node:zlib';

/** The files in a zip archive, by name. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]);
const texts = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => decode(m[1])).join('');
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The rows of the first worksheet of an .xlsx file, each cell as text (numbers as Excel stores them). */
export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const str = (name: string) => files.get(name)?.toString('utf8');
  const shared = [...(str('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  // the first sheet in the workbook's order, through its relationship
  let path = 'xl/worksheets/sheet1.xml';
  const rid = str('xl/workbook.xml')?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = str('xl/_rels/workbook.xml.rels');
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${rid}"`));
    const target = rel?.match(/Target="([^"]+)"/)?.[1];
    if (target) path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheet = str(path);
  if (!sheet) throw new Error('no worksheet found');
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cm[1].match(/\br="([A-Z]+)\d+"/)?.[1];
      const c = ref ? colIndex(ref) : next;
      next = c + 1;
      const t = cm[1].match(/\bt="(\w+)"/)?.[1], body = cm[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      row[c] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? texts(body) : v === undefined ? '' : decode(v);
    }
    rows[r] = Array.from(row, x => x ?? '');
  }
  return Array.from(rows, x => x ?? []);
}

/** CSV (comma or semicolon) or tab-separated text, as pasted from Excel. Quoted cells may hold separators and new lines. */
export function readDelimited(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const first = s.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** An uploaded spreadsheet: .xlsx by its zip signature, otherwise text. */
export function readSpreadsheet(buf: Buffer, name = ''): string[][] {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf);
  if (buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0) throw new Error(`${name || 'This file'} is an old Excel .xls file. Open it in Excel and save it as .xlsx (Excel Workbook) or CSV, then upload that.`);
  return readDelimited(buf.toString('utf8'));
}
