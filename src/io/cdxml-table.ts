// Tables in ChemDraw files. ChemDraw keeps a table as a grid of pages, one per cell, stored row
// by row; each page holds whatever is in the cell (text, or even a structure) and its four
// borders, each with its own line width (0 for none), as ChemDraw 25 saves them (see the CDX
// documentation's Table and Border objects). Because every cell has its own borders, the ACS
// style (rules only above and below the headings and under the last row) shows in ChemDraw
// as drawn here.
//
// ChemDraw has no heading rows, column alignment or joined cells, so those go in a tag on the
// table, and its title and footnotes are captions grouped with it, each tagged with its part.

import type { Justify, TableCell, TableData } from '../model';

export const TABLE_TAG = 'Chem Illustrator table';
export const TABLE_PART_TAG = 'Chem Illustrator table part';

/** What the tag on a table keeps. */
export interface TableTag {
  v: 1;
  head: number;
  lines: TableData['lines'];
  align?: Justify[];
  size?: number;
  /** Joined cells: row, column and how many columns. */
  spans?: [number, number, number][];
  /** Cells with their own alignment: row, column and alignment. */
  cellAlign?: [number, number, string][];
  /** Room kept for structures in cells: row, column, width and height. */
  figs?: [number, number, number, number][];
  /** Cells joined down: row, column and how many rows. */
  rowSpans?: [number, number, number][];
  /** Cells shaded: row, column and colour. */
  fills?: [number, number, string][];
  /** The table style (PowerPoint's, used on drawings too) and which parts it picks out. */
  style?: string;
  look?: TableData['look'];
  /** The width of its lines, when not the drawing's (TableData.lineW). */
  lineW?: number;
}

export interface Borders { left: number; top: number; bottom: number; right: number }

/** The width of each border of each cell (0 for none) for a table's lines. */
export function tableBorders(t: TableData, lw: number): Borders[][] {
  const n = t.rows.length, m = t.cols.length;
  const out: Borders[][] = t.rows.map(() => Array.from({ length: m }, () => ({ left: 0, top: 0, bottom: 0, right: 0 })));
  if (t.lines === 'none') return out;
  // which column shows at each place (a joined cell covers the ones to its right)
  const owner = (r: number, c: number) => {
    let k = 0;
    for (;;) {
      const s = Math.max(1, Math.min(Math.floor(t.rows[r][k]?.span ?? 1), m - k));
      if (c < k + s) return k;
      k += s;
    }
  };
  if (t.lines === 'grid') {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < m; c++) {
        const b = out[r][c];
        b.top = b.bottom = lw;
        // no line runs through a joined cell
        b.left = c === 0 || owner(r, c) !== owner(r, c - 1) ? lw : 0;
        b.right = c === m - 1 || owner(r, c) !== owner(r, c + 1) ? lw : 0;
      }
    }
    return out;
  }
  const head = Math.max(0, Math.min(t.head, n));
  for (let c = 0; c < m; c++) {
    out[0][c].top = lw;
    if (head > 0 && head < n) out[head - 1][c].bottom = lw;
    out[n - 1][c].bottom = lw;
  }
  // a heading joined over several columns has a rule under it (ChemDraw's runs the cells' full width)
  for (let r = 0; r < head - 1; r++) {
    for (let c = 0; c < m; c++) {
      const s = Math.max(1, Math.floor(t.rows[r][c]?.span ?? 1));
      if (s < 2 || owner(r, c) !== c) continue;
      for (let k = c; k < Math.min(m, c + s); k++) out[r][k].bottom = lw;
    }
  }
  return out;
}

/**
 * The borders to save a table with: the cells' own as read (`edges`), while the table still has
 * their rows and columns and its lines are the kind they make; else its lines at its width.
 */
export function savedBorders(t: TableData, lw: number): Borders[][] {
  const e = t.edges;
  if (e && t.edgesKey === tableShapeKey(t) && e.length === t.rows.length && e.every((row) => Array.isArray(row) && row.length === t.cols.length)) {
    // (each side a width of 0 or more, whatever a pasted table holds)
    const w = (v: unknown) => Math.max(0, Number(v) || 0);
    return e.map((row) => row.map((b) => ({ left: w(b?.left), top: w(b?.top), bottom: w(b?.bottom), right: w(b?.right) })));
  }
  return tableBorders(t, t.lineW ?? lw);
}

/**
 * What a table's cells' own borders depend on: its rows and columns, joined cells, lines, heading
 * rows and style. Cells joined or split, lines or a style picked here: the borders as read no longer fit.
 */
export function tableShapeKey(t: TableData): string {
  return JSON.stringify([t.rows.length, t.cols.length, t.lines, t.head, t.style ?? null, t.rows.map((row) => row.map((c) => [c.span ?? 1, c.rowSpan ?? 1]))]);
}

/**
 * A table's borders with each line two cells share given to both, at the heavier of the two (as
 * PowerPoint and this program write them), to compare two sets of borders by the lines they draw.
 */
export function sharedBorders(b: Borders[][]): Borders[][] {
  const out = b.map((row) => row.map((x) => ({ ...x })));
  for (let r = 0; r < out.length; r++) for (let c = 0; c < out[r].length; c++) {
    const x = out[r][c], right = out[r][c + 1], below = out[r + 1]?.[c];
    if (right) { const w = Math.max(x.right, right.left); x.right = right.left = w; }
    if (below) { const w = Math.max(x.bottom, below.top); x.bottom = below.top = w; }
  }
  return out;
}

/** The width most of a table's cell borders have (to a thousandth of a point), or undefined when it has none. */
export function commonBorderWidth(b: Borders[][]): number | undefined {
  const count = new Map<number, number>();
  for (const row of b) for (const x of row) for (const w of [x.left, x.top, x.bottom, x.right]) if (w > 0) { const k = Math.round(w * 1000) / 1000; count.set(k, (count.get(k) ?? 0) + 1); }
  return [...count].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0]?.[0];
}

/**
 * The lines of a table from its cells' borders: none, every cell boxed, or the ACS style with
 * the heading rows ending at the first rule inside the table.
 */
export function linesFromBorders(b: Borders[][]): { lines: TableData['lines']; head: number } {
  const n = b.length, m = b[0]?.length ?? 0;
  let any = false, inner = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < m; c++) {
    const x = b[r][c];
    if (x.left || x.top || x.bottom || x.right) any = true;
    if ((c > 0 && x.left) || (c < m - 1 && x.right)) inner++;
  }
  if (!any) return { lines: 'none', head: n > 1 ? 1 : 0 };
  if (inner >= Math.max(1, (n * (m - 1)) / 2)) return { lines: 'grid', head: n > 1 ? 1 : 0 };
  // the first row most of whose cells have a rule under them (or over the next row)
  for (let r = 0; r < n - 1; r++) {
    let k = 0;
    for (let c = 0; c < m; c++) if (b[r][c].bottom || b[r + 1][c].top) k++;
    if (k > m / 2) return { lines: 'acs', head: r + 1 };
  }
  return { lines: 'acs', head: 0 };
}

/** Put what a tag kept back into a table read from a file (where it still fits the table). */
export function applyTableTag(t: TableData, tag: TableTag | null, fromBorders: { lines: TableData['lines']; head: number }): TableData {
  const out: TableData = { ...t, lines: fromBorders.lines, head: fromBorders.head };
  if (!tag || tag.v !== 1) return out;
  // the tag's heading rows count when the borders still show them (ChemDraw may have changed the lines)
  if (tag.lines === fromBorders.lines && (tag.lines !== 'acs' || tag.head === fromBorders.head || (fromBorders.head === 0 && tag.head >= t.rows.length))) out.head = Math.min(tag.head, t.rows.length);
  if (Array.isArray(tag.align) && tag.align.length === t.cols.length) out.align = tag.align;
  if (typeof tag.lineW === 'number' && tag.lineW > 0 && tag.lineW < 20) out.lineW = tag.lineW;
  if (typeof tag.size === 'number' && tag.size > 0) out.size = tag.size;
  const rows = out.rows.map((row) => [...row]);
  for (const [r, c, s] of tag.spans ?? []) {
    if (rows[r]?.[c] && s > 1 && c + s <= t.cols.length) rows[r][c] = { ...rows[r][c], span: s };
  }
  for (const [r, c, a] of tag.cellAlign ?? []) {
    if (rows[r]?.[c] && (a === 'left' || a === 'center' || a === 'right' || a === 'justify')) rows[r][c] = { ...rows[r][c], align: a };
  }
  for (const [r, c, w, h] of tag.figs ?? []) {
    if (rows[r]?.[c] && w > 0 && h > 0) rows[r][c] = { ...rows[r][c], fig: { w, h } };
  }
  for (const [r, c, n] of Array.isArray(tag.rowSpans) ? tag.rowSpans : []) {
    if (rows[r]?.[c] && typeof n === 'number' && n > 1 && r + n <= t.rows.length) rows[r][c] = { ...rows[r][c], rowSpan: Math.round(n) };
  }
  for (const [r, c, f] of Array.isArray(tag.fills) ? tag.fills : []) {
    if (rows[r]?.[c] && typeof f === 'string' && f) rows[r][c] = { ...rows[r][c], fill: f };
  }
  if (typeof tag.style === 'string' && tag.style) out.style = tag.style;
  if (tag.look && typeof tag.look === 'object') {
    const look: NonNullable<TableData['look']> = {};
    for (const [k, v] of Object.entries(tag.look)) if (typeof v === 'boolean') (look as Record<string, boolean>)[k] = v;
    if (Object.keys(look).length) out.look = look;
  }
  out.rows = rows;
  return out;
}

export function parseTableTag(value: string | null): TableTag | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as TableTag;
    return v && v.v === 1 && typeof v.head === 'number' && ['acs', 'grid', 'none'].includes(v.lines) ? v : null;
  } catch {
    return null;
  }
}

/** One cell of a table read from a file, before it goes in the grid. */
export interface ReadCell { x1: number; y1: number; x2: number; y2: number; cell: TableCell; borders: Borders }

/** Cells read from the pages of a ChemDraw table, put in their rows and columns by their places. */
export function gridOf(cells: ReadCell[]): { rows: ReadCell[][]; cols: number[] } | null {
  if (!cells.length) return null;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const xs: number[] = [], ys: number[] = [];
  for (const c of cells) {
    if (!xs.some((x) => near(x, c.x1))) xs.push(c.x1);
    if (!ys.some((y) => near(y, c.y1))) ys.push(c.y1);
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const rows: (ReadCell | null)[][] = ys.map(() => xs.map(() => null));
  for (const c of cells) {
    const r = ys.findIndex((y) => near(y, c.y1)), k = xs.findIndex((x) => near(x, c.x1));
    if (!rows[r][k]) rows[r][k] = c;
  }
  const cols = xs.map((x, k) => {
    const w = rows.map((row) => row[k]).find(Boolean);
    return w ? w.x2 - w.x1 : (xs[k + 1] ?? x + 40) - x;
  });
  const empty = (k: number, r: number): ReadCell => ({ x1: xs[k], y1: ys[r], x2: xs[k] + cols[k], y2: ys[r] + 10, cell: { runs: [] }, borders: { left: 0, top: 0, bottom: 0, right: 0 } });
  return { rows: rows.map((row, r) => row.map((c, k) => c ?? empty(k, r))), cols };
}
