// A table in an SI project's text (SPEC §13k.5): `tables/t-….json` in its owner's folder (a
// Custom section's), with its columns' alignment, rows of cells ({text, colspan, rowspan, align,
// image, image_width}, null for a cell a merged one covers), header-row count, footnotes and
// label. Changed here the way SI Assistant's table editor changes it: rows and columns added
// and removed around merged cells, merging keeps the first picture, splitting leaves it in the
// top-left cell. Whatever else a cell or table holds is kept as it is. Nothing here is user
// interface, so it is tested directly (tests/si-tables.test.ts).

import type { Json } from './project';
import type { Paragraph, Run } from './markup';
import { writeMarkup } from './markup';

export type Align = 'left' | 'center' | 'right';
/** A cell's and a table's look of Chemweave's own (borders, shading…: table-format.ts). */
export const FORMAT_KEY = 'chemweave_format';
type Side = 'top' | 'bottom' | 'left' | 'right';

/** A cell's look (`FORMAT_KEY`) with only the borders on `sides` (a part of a merged cell keeps the lines of the edges it is on). */
function formatOn(cell: Json, sides: Side[]): Json | null {
  const f = dict(cell[FORMAT_KEY]);
  if (!Object.keys(f).length) return null;
  const out: Json = { ...f };
  const b = dict(f.borders);
  const kept: Json = {};
  for (const s of sides) if (b[s] !== undefined) kept[s] = b[s];
  if (Object.keys(kept).length) out.borders = kept; else delete out.borders;
  return Object.keys(out).length ? out : null;
}
/** A cell's span: where it starts, and how many rows and columns it covers. */
export interface Span { r: number; c: number; rows: number; cols: number }

const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown, d: number): number => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? n : d; };

/** A new table: `rows` × `cols` empty cells, the first row its header, every column centred. */
export function newTable(id: string, rows = 3, cols = 3): Json {
  return {
    id,
    label: '',
    header_rows: 1,
    columns: Array.from({ length: cols }, () => 'center'),
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ text: '' }))),
    footnotes: [],
  };
}

/** The table's rows (made a list of lists when it isn't one). */
export function rowsOf(t: Json): unknown[][] {
  if (!Array.isArray(t.rows)) t.rows = [];
  const rows = t.rows as unknown[];
  // (the same list each time, so a caller holding it sees the rows added)
  rows.forEach((r, i) => { if (!Array.isArray(r)) rows[i] = []; });
  return rows as unknown[][];
}

export function colCount(t: Json): number {
  return Math.max(0, ...rowsOf(t).map((r) => r.length), Array.isArray(t.columns) ? t.columns.length : 0);
}

/** Every row as long as the widest (empty cells added), and a column alignment for each column. */
export function squareUp(t: Json): void {
  const n = colCount(t);
  for (const r of rowsOf(t)) while (r.length < n) r.push({ text: '' });
  const cols = Array.isArray(t.columns) ? (t.columns as unknown[]) : (t.columns = []);
  while (cols.length < n) cols.push('center');
  if (cols.length > n) cols.length = n;
}

/** A cell as an object (a plain string becomes {text}); null for a covered cell. */
export function cellAt(t: Json, r: number, c: number): Json | null {
  const row = rowsOf(t)[r];
  if (!row) return null;
  const v = row[c];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') { row[c] = { text: v }; return row[c] as Json; }
  return dict(v);
}

/** Every cell that is not covered, with the rows and columns it spans (clipped to the table). */
export function spans(t: Json): Span[] {
  const rows = rowsOf(t), n = colCount(t);
  const out: Span[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < n; c++) {
      const v = row[c];
      if (v === null) continue;
      const d = v === undefined || typeof v === 'string' ? {} : dict(v);
      out.push({ r, c, rows: Math.min(num(d.rowspan, 1), rows.length - r), cols: Math.min(num(d.colspan, 1), n - c) });
    }
  });
  return out;
}

/** The cell that shows at (r, c): itself, or the merged cell covering it. */
export function ownerOf(t: Json, r: number, c: number): Span | null {
  return spans(t).find((s) => r >= s.r && r < s.r + s.rows && c >= s.c && c < s.c + s.cols) ?? null;
}

const setSpan = (cell: Json, key: 'rowspan' | 'colspan', n: number): void => { if (n > 1) cell[key] = n; else delete cell[key]; };

/** A new row at `at` (0 = the top). A merged cell it passes through grows to cover it. */
export function insertRow(t: Json, at: number): void {
  squareUp(t);
  const rows = rowsOf(t), n = colCount(t);
  at = Math.max(0, Math.min(rows.length, at));
  const row: unknown[] = Array.from({ length: n }, () => ({ text: '' }));
  for (const s of spans(t)) {
    if (s.r < at && s.r + s.rows > at) {
      setSpan(cellAt(t, s.r, s.c)!, 'rowspan', s.rows + 1);
      for (let k = 0; k < s.cols; k++) row[s.c + k] = null;
    }
  }
  rows.splice(at, 0, row);
  if (at < Number(t.header_rows ?? 1)) t.header_rows = num(t.header_rows, 1) + 1;
}

/** Remove row `r`. A merged cell starting there moves down a row; one passing through it gets shorter. */
export function deleteRow(t: Json, r: number): void {
  squareUp(t);
  const rows = rowsOf(t);
  if (rows.length <= 1 || r < 0 || r >= rows.length) return;
  for (const s of spans(t)) {
    if (s.rows < 2 || r < s.r || r >= s.r + s.rows) continue;
    const cell = cellAt(t, s.r, s.c)!;
    setSpan(cell, 'rowspan', s.rows - 1);
    // (a merged cell starting on the row goes on in the row under it)
    if (s.r === r) rows[r + 1][s.c] = cell;
  }
  rows.splice(r, 1);
  const head = Number(t.header_rows ?? 1);
  if (r < head) t.header_rows = Math.max(0, head - 1);
}

/** A new column at `at` (0 = the left). A merged cell it passes through grows to cover it. */
export function insertColumn(t: Json, at: number, align: Align = 'center'): void {
  squareUp(t);
  const rows = rowsOf(t), n = colCount(t);
  at = Math.max(0, Math.min(n, at));
  const covered = new Set<number>();
  for (const s of spans(t)) {
    if (s.c < at && s.c + s.cols > at) {
      setSpan(cellAt(t, s.r, s.c)!, 'colspan', s.cols + 1);
      for (let k = 0; k < s.rows; k++) covered.add(s.r + k);
    }
  }
  rows.forEach((row, r) => row.splice(at, 0, covered.has(r) ? null : { text: '' }));
  (t.columns as unknown[]).splice(at, 0, align);
  // (a column's typed width, SI Assistant's "widths", stays with its column; the new one fits its text)
  if (Array.isArray(t.widths)) { while (t.widths.length < n) t.widths.push(null); t.widths.splice(at, 0, null); }
}

/** Remove column `c`. A merged cell starting there moves right a column; one passing through it gets narrower. */
export function deleteColumn(t: Json, c: number): void {
  squareUp(t);
  const rows = rowsOf(t), n = colCount(t);
  if (n <= 1 || c < 0 || c >= n) return;
  for (const s of spans(t)) {
    if (s.cols < 2 || c < s.c || c >= s.c + s.cols) continue;
    const cell = cellAt(t, s.r, s.c)!;
    setSpan(cell, 'colspan', s.cols - 1);
    if (s.c === c) rows[s.r][c + 1] = cell;
  }
  for (const row of rows) row.splice(c, 1);
  (t.columns as unknown[]).splice(c, 1);
  if (Array.isArray(t.widths)) t.widths.splice(c, 1);
}

/** The smallest block holding (r0, c0)–(r1, c1) that cuts no merged cell in two. */
export function blockAround(t: Json, r0: number, c0: number, r1: number, c1: number): Span {
  let top = Math.min(r0, r1), bottom = Math.max(r0, r1), left = Math.min(c0, c1), right = Math.max(c0, c1);
  for (let changed = true; changed;) {
    changed = false;
    for (const s of spans(t)) {
      const inside = s.r <= bottom && s.r + s.rows - 1 >= top && s.c <= right && s.c + s.cols - 1 >= left;
      if (!inside) continue;
      if (s.r < top) { top = s.r; changed = true; }
      if (s.c < left) { left = s.c; changed = true; }
      if (s.r + s.rows - 1 > bottom) { bottom = s.r + s.rows - 1; changed = true; }
      if (s.c + s.cols - 1 > right) { right = s.c + s.cols - 1; changed = true; }
    }
  }
  return { r: top, c: left, rows: bottom - top + 1, cols: right - left + 1 };
}

/** Merge a block into its top-left cell: their texts joined with spaces, the first picture kept. */
export function merge(t: Json, b: Span): void {
  squareUp(t);
  b = blockAround(t, b.r, b.c, b.r + b.rows - 1, b.c + b.cols - 1);
  if (b.rows * b.cols < 2) return;
  const rows = rowsOf(t);
  const texts: string[] = [];
  let picture: Json | null = null;
  for (let r = b.r; r < b.r + b.rows; r++) for (let c = b.c; c < b.c + b.cols; c++) {
    const cell = cellAt(t, r, c);
    if (!cell) continue;
    if (typeof cell.text === 'string' && cell.text.trim()) texts.push(cell.text.trim());
    if (!picture && typeof cell.image === 'string' && cell.image) picture = cell;
  }
  const first = cellAt(t, b.r, b.c) ?? {};
  // (its look is the first cell's, with the lines of the block's bottom and right edges from the cells there)
  const bottom = cellAt(t, b.r + b.rows - 1, b.c), right = cellAt(t, b.r, b.c + b.cols - 1);
  const look = formatOn(first, ['top', 'left']) ?? {};
  const edges: Json = { ...dict(look.borders) };
  for (const [side, from] of [['bottom', b.rows > 1 ? bottom : first], ['right', b.cols > 1 ? right : first]] as const) {
    const x = from ? dict(dict(from[FORMAT_KEY]).borders)[side] : undefined;
    if (x !== undefined) edges[side] = x;
  }
  if (Object.keys(edges).length) look.borders = edges; else delete look.borders;
  if (Object.keys(look).length) first[FORMAT_KEY] = look; else delete first[FORMAT_KEY];
  first.text = texts.join(' ');
  if (picture && picture !== first) {
    first.image = picture.image;
    if (picture.image_width !== undefined) first.image_width = picture.image_width; else delete first.image_width;
  }
  setSpan(first, 'rowspan', b.rows);
  setSpan(first, 'colspan', b.cols);
  for (let r = b.r; r < b.r + b.rows; r++) for (let c = b.c; c < b.c + b.cols; c++) rows[r][c] = r === b.r && c === b.c ? first : null;
}

/** Split a merged cell back into single cells (its text and picture stay in the top-left one). */
export function split(t: Json, r: number, c: number): void {
  const s = ownerOf(t, r, c);
  if (!s || (s.rows < 2 && s.cols < 2)) return;
  const rows = rowsOf(t);
  const cell = cellAt(t, s.r, s.c)!;
  delete cell.rowspan;
  delete cell.colspan;
  // (each new cell takes the merged cell's alignment, text size and look, and the lines of the edges it is on)
  const edgesOf = (i: number, k: number): Side[] => [
    ...(i === s.r ? ['top' as const] : []), ...(i === s.r + s.rows - 1 ? ['bottom' as const] : []),
    ...(k === s.c ? ['left' as const] : []), ...(k === s.c + s.cols - 1 ? ['right' as const] : []),
  ];
  const whole = { ...cell };
  for (let i = s.r; i < s.r + s.rows; i++) for (let k = s.c; k < s.c + s.cols; k++) {
    const look = formatOn(whole, edgesOf(i, k));
    const part: Json = i === s.r && k === s.c ? cell : { text: '' };
    if (part !== cell) {
      if (whole.align !== undefined) part.align = whole.align;
      if (whole.size !== undefined) part.size = whole.size;
    }
    if (look) part[FORMAT_KEY] = look; else delete part[FORMAT_KEY];
    rows[i][k] = part;
  }
}

/** A cell's picture: its file (from the owner's folder) and a typed width in cm (0 = its own size). */
export function setPicture(t: Json, r: number, c: number, image: string, widthCm = 0): void {
  const s = ownerOf(t, r, c);
  if (!s) return;
  const cell = cellAt(t, s.r, s.c)!;
  if (image) cell.image = image; else { delete cell.image; delete cell.image_width; return; }
  if (widthCm > 0) cell.image_width = Math.round(widthCm * 100) / 100; else delete cell.image_width;
}

/** The text of a footnote list, one footnote a line; and back. */
export function footnotesOf(t: Json): string[] {
  return Array.isArray(t.footnotes) ? (t.footnotes as unknown[]).map((x) => (typeof x === 'string' ? x : '')) : [];
}

/** Pasted cells (from Excel, Word or a sheet) as SI cells: their bold, italics, sub- and superscripts kept. */
export function pastedCells(rows: { runs: { text: string; bold?: boolean; italic?: boolean; underline?: boolean; sub?: boolean; sup?: boolean }[]; span?: number }[][]): Json[][] {
  return rows.map((row) => {
    const out: Json[] = [];
    for (const cell of row) {
      const runs: Run[] = cell.runs.map((x) => ({ text: x.text.replace(/\s*\n\s*/g, ' '), ...(x.bold ? { bold: true } : {}), ...(x.italic ? { italic: true } : {}), ...(x.underline ? { underline: true } : {}), ...(x.sub ? { valign: 'sub' as const } : x.sup ? { valign: 'super' as const } : {}) }));
      const p: Paragraph = { runs };
      const text = writeMarkup([p]).trim();
      const span = Math.max(1, Math.round(cell.span ?? 1));
      out.push(span > 1 ? { text, colspan: span } : { text });
      for (let k = 1; k < span; k++) out.push(null as unknown as Json);
    }
    return out;
  });
}

/** Put pasted cells into the table from (r, c), adding the rows and columns they need. */
export function pasteCells(t: Json, r: number, c: number, cells: Json[][]): void {
  squareUp(t);
  const rows = rowsOf(t);
  const width = Math.max(0, ...cells.map((x) => x.length));
  while (colCount(t) < c + width) insertColumn(t, colCount(t));
  while (rows.length < r + cells.length) insertRow(t, rows.length);
  // (merged cells the paste lands on are split first, so nothing is left half covered)
  for (let i = 0; i < cells.length; i++) for (let k = 0; k < width; k++) split(t, r + i, c + k);
  cells.forEach((row, i) => {
    for (let k = 0; k < width; k++) {
      const v = row[k];
      if (v === undefined) continue;
      if (v === null) { rows[r + i][c + k] = null; continue; }
      const old = cellAt(t, r + i, c + k);
      // (a cell's picture stays: only its text is pasted over)
      rows[r + i][c + k] = { ...(old ?? {}), ...v };
    }
  });
}
