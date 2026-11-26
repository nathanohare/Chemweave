// An SI table's look (Table Design and Table Layout on the SI tab): cell borders, shading, where
// the text sits up and down in a cell, cell margins and how the table's width is set. The keys
// SI projects already have are used where they fit: a column's width typed by hand is its
// "widths" entry (cm, null = fits its text), and "fit_width" shrinks a table wider than the text.
// Everything else is kept with the table, under a key of Chemweave's own:
//
//   table: "chemweave_format": {"pad": {"top", "bottom", "left", "right"} (pt, every cell's margins),
//                               "fit": "window" (as wide as the text: AutoFit to Window)}
//   cell:  "chemweave_format": {"borders": {"top": {"style", "w", "color"}, ...} (its own lines, over
//                               the ACS rules; style "none" takes a rule away),
//                               "fill": "#rrggbb", "valign": "center" | "bottom", "pad": {...}}
//
// Kept on the cell, so it moves with the cell when rows and columns are added, deleted or merged
// (a key inside it this version doesn't know is kept as it is). A table without it prints with the
// ACS rules alone, as before. The commands work on the table as Document mode's tables are
// (src/table.ts, document/table-styles.ts): `siTableData` makes one from the stored table and
// `storeTableData` keeps what a command changed. Nothing here is user interface (tested in
// tests/si-table-format.test.ts).

import type { BorderLine, CellBorders, CellMargins, Justify, TableCell, TableData } from '../model';
import type { Json } from './project';
import { FORMAT_KEY, cellAt, colCount, rowsOf, spans } from './tables';
import { evenColumns, fillColumns } from '../table';

export { FORMAT_KEY };

/** A cell's own look (each part only when set). */
export interface SiCellFormat {
  borders?: CellBorders;
  fill?: string;
  valign?: 'center' | 'bottom';
  pad?: Partial<CellMargins>;
}

/** A table's own look. */
export interface SiTableFormat {
  pad?: CellMargins;
  fit?: 'window';
}

/** Points in a centimeter. */
export const PT_PER_CM = 72 / 2.54;
/** The narrowest width kept for a column typed by hand, in cm. */
const MIN_CM = 0.1;
const SIDES = ['top', 'bottom', 'left', 'right'] as const;
const STYLES: BorderLine['style'][] = ['none', 'single', 'double', 'dotted', 'dashed'];
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const COLOR = /^#[0-9a-f]{6}$/i;
const len = (v: unknown): number | null => { const n = Number(v); return typeof v === 'number' && Number.isFinite(n) && n >= 0 && n <= 72 ? n : null; };

function line(v: unknown): BorderLine | null {
  if (!isObj(v) || !STYLES.includes(v.style as BorderLine['style'])) return null;
  const w = Number(v.w);
  return { style: v.style as BorderLine['style'], w: Number.isFinite(w) ? Math.max(0, Math.min(12, w)) : 0.5, color: typeof v.color === 'string' && COLOR.test(v.color) ? v.color.toLowerCase() : '#000000' };
}

function margins(v: unknown): Partial<CellMargins> {
  const out: Partial<CellMargins> = {};
  if (!isObj(v)) return out;
  for (const s of SIDES) { const n = len(v[s]); if (n !== null) out[s] = n; }
  return out;
}

/** A cell's own look as stored (a hand-edited value that can't be read is left out). */
export function cellFormat(cell: unknown): SiCellFormat {
  const f = isObj(cell) ? cell[FORMAT_KEY] : undefined;
  if (!isObj(f)) return {};
  const out: SiCellFormat = {};
  if (isObj(f.borders)) {
    const b: CellBorders = {};
    for (const s of SIDES) { const x = line(f.borders[s]); if (x) b[s] = x; }
    if (Object.keys(b).length) out.borders = b;
  }
  if (typeof f.fill === 'string' && COLOR.test(f.fill)) out.fill = f.fill.toLowerCase();
  if (f.valign === 'center' || f.valign === 'bottom') out.valign = f.valign;
  const pad = margins(f.pad);
  if (Object.keys(pad).length) out.pad = pad;
  return out;
}

/** The table's own look as stored. */
export function tableFormat(t: Json): SiTableFormat {
  const f = t[FORMAT_KEY];
  if (!isObj(f)) return {};
  const out: SiTableFormat = {};
  const pad = margins(f.pad);
  if (SIDES.every((s) => pad[s] !== undefined)) out.pad = pad as CellMargins;
  if (f.fit === 'window') out.fit = 'window';
  return out;
}

const putFormat = (o: Json, f: object): void => { if (Object.keys(f).length) o[FORMAT_KEY] = f; else delete o[FORMAT_KEY]; };

/** Each column's width typed by hand, in cm (null: it fits its text), as SI Assistant keeps them. */
export function columnWidthsCm(t: Json, n: number): (number | null)[] {
  const w = Array.isArray(t.widths) ? t.widths : [];
  return Array.from({ length: n }, (_, k) => { const v = Number(w[k]); return w[k] !== null && Number.isFinite(v) && v > 0 && v < 1000 ? Math.round(v * 100) / 100 : null; });
}

function storeWidths(t: Json, cm: (number | null)[]): void {
  if (cm.some((w) => w !== null)) t.widths = cm.map((w) => (w === null ? null : Math.max(MIN_CM, Math.round(w * 100) / 100)));
  else delete t.widths;
}

/**
 * The columns' widths in points and how Word sizes the table, `textW` being the text's width:
 * as wide as the text (AutoFit to Window); every column typed (those widths, shrunk to the text
 * with SI Assistant's "fit_width"); or Word fitting the columns to their text (AutoFit to
 * Contents), a typed column starting at its width.
 */
export function siColumns(t: Json, n: number, textW: number): Pick<TableData, 'cols' | 'width' | 'autofit'> {
  const cm = columnWidthsCm(t, n);
  const typed = cm.map((w) => (w === null ? null : w * PT_PER_CM));
  const sum = typed.reduce<number>((a, w) => a + (w ?? 0), 0);
  const loose = typed.filter((w) => w === null).length;
  const share = loose ? Math.max(18, (textW - sum) / loose) : 0;
  const round = (w: number) => Math.round(w * 100) / 100;
  const cols = typed.map((w) => w ?? share);
  if (tableFormat(t).fit === 'window') return { cols: fillColumns(cols, textW).map(round), width: { pct: 100 }, autofit: false };
  // (SI Assistant's fit_width: a table wider than the text shrunk to it, typed columns and all)
  const total = cols.reduce((a, b) => a + b, 0);
  const k = t.fit_width === true && total > textW ? textW / total : 1;
  if (!loose && n) return { cols: cols.map((w) => round(w * k)), autofit: false };
  return { cols: cols.map((w) => round(w * k)), width: 'auto', autofit: true };
}

/**
 * A column's width typed (cm), or (null) back to fitting its text. On a table AutoFit to Window
 * the table stays as wide as the text, as in Word: the other columns share what is left, keeping
 * their shares (each at least 18 pt), and from then on every width is typed.
 */
export function setColumnWidthCm(t: Json, c: number, cm: number | null, textW: number): void {
  const n = colCount(t);
  if (c < 0 || c >= n) return;
  const typed = cm !== null && cm > 0 ? Math.max(MIN_CM, Math.min(999, cm)) : null;
  if (tableFormat(t).fit === 'window' && typed !== null) {
    const cols = siColumns(t, n, textW).cols;
    const mine = typed * PT_PER_CM;
    const others = cols.reduce((a, w, k) => a + (k === c ? 0 : w), 0);
    const room = Math.max(0, textW - mine);
    const w = cols.map((x, k) => (k === c ? mine : Math.max(18, others > 0 ? (x * room) / others : room / Math.max(1, n - 1))) / PT_PER_CM);
    storeWidths(t, w);
    unfit(t);
    return;
  }
  const w = columnWidthsCm(t, n);
  w[c] = typed;
  storeWidths(t, w);
  // (clearing a width keeps the table as wide as the text)
  if (typed !== null) unfit(t);
}

function unfit(t: Json): void {
  const f = isObj(t[FORMAT_KEY]) ? { ...(t[FORMAT_KEY] as Json) } : {};
  delete f.fit;
  putFormat(t, f);
}

/** AutoFit to Contents: no column has a typed width, so Word fits each to its text. */
export function autoFitContents(t: Json): void {
  delete t.widths;
  unfit(t);
}

/** AutoFit to Window: the table as wide as the text, its columns keeping their shares. */
export function autoFitWindow(t: Json): void {
  const f = isObj(t[FORMAT_KEY]) ? { ...(t[FORMAT_KEY] as Json) } : {};
  f.fit = 'window';
  putFormat(t, f);
}

/** Distribute Columns: every column typed the same width, the table as wide as it is now (no wider than the text). */
export function distributeColumns(t: Json, textW: number): void {
  const n = colCount(t);
  if (!n) return;
  const even = evenColumns(siColumns(t, n, textW).cols, textW);
  storeWidths(t, even.map((w) => Math.floor((w / PT_PER_CM) * 100) / 100));
  unfit(t);
}

/**
 * The table as a document's table, for the commands and for drawing its lines: each cell's spans,
 * alignment and own look (no text), the header rows, the ACS rules, the columns' widths.
 */
export function siTableData(t: Json, textW: number): TableData {
  const rows = rowsOf(t), n = colCount(t);
  const cols = Array.isArray(t.columns) ? t.columns.map(String) : [];
  const out: TableCell[][] = rows.map(() => Array.from({ length: n }, (): TableCell => ({ runs: [] })));
  for (const s of spans(t)) {
    const cell = cellAt(t, s.r, s.c) ?? {};
    const c: TableCell = { runs: [], ...cellFormat(cell) };
    if (s.cols > 1) c.span = s.cols;
    if (s.rows > 1) c.rowSpan = s.rows;
    const a = String(cell.align ?? '');
    if (a === 'left' || a === 'center' || a === 'right') c.align = a;
    out[s.r][s.c] = c;
  }
  const head = Math.max(0, Math.min(rows.length, Math.round(Number(t.header_rows ?? 1)) || 0));
  const pad = tableFormat(t).pad;
  return {
    ...siColumns(t, n, textW),
    rows: out, head, lines: 'acs',
    align: Array.from({ length: n }, (_, k) => (['left', 'center', 'right'].includes(cols[k]) ? cols[k] : 'center') as Justify),
    ...(pad ? { pad } : {}),
  };
}

/** The width of the text tables are set in, in points: the page's less its margins, across a page turned on its side for a landscape section. */
export function textWidthOf(page: { w: number; h: number; left: number; right: number }, landscape: boolean): number {
  return Math.max(144, (landscape ? page.h : page.w) - page.left - page.right);
}

/** Keep the cells' looks and the table's cell margins of a document's table made by `siTableData` (and changed by a command). */
export function storeTableData(t: Json, td: TableData): void {
  for (const s of spans(t)) {
    const cell = cellAt(t, s.r, s.c);
    const x = td.rows[s.r]?.[s.c];
    if (!cell || !x) continue;
    // (into what the cell has: a key of a later version is kept)
    const f: Json = isObj(cell[FORMAT_KEY]) ? { ...(cell[FORMAT_KEY] as Json) } : {};
    const put = (k: keyof SiCellFormat, v: unknown, has: boolean) => { if (has) f[k] = v; else delete f[k]; };
    put('borders', x.borders, !!x.borders && Object.keys(x.borders).length > 0);
    put('fill', x.fill, !!x.fill);
    put('valign', x.valign, !!x.valign);
    put('pad', x.pad, !!x.pad && Object.keys(x.pad).length > 0);
    putFormat(cell, f);
  }
  const f = isObj(t[FORMAT_KEY]) ? { ...(t[FORMAT_KEY] as Json) } : {};
  if (td.pad) f.pad = { ...td.pad }; else delete f.pad;
  putFormat(t, f);
}
