// How far a command on rows, columns or a block of cells reaches. A selection that runs to the end
// of the sheet (a whole column, a whole row, Select All) stops at the cells in use, since the
// million rows beyond hold nothing to change; a selection that ends sooner is used as it is, even
// where it lies below or right of the data.

import { MAX_COLS, MAX_ROWS, type Range } from '../sheet/refs';

/** The most rows or columns one command sets a size on, hides or shows. */
export const MAX_LINES = 10000;

/** The most cells one command fills, links or types into before it stops and says so. */
export const MAX_CELLS = 500000;

const reaches = (r: Range, kind: 'row' | 'col') => (kind === 'row' ? r.r2 >= MAX_ROWS - 1 : r.c2 >= MAX_COLS - 1);

/**
 * The last row (or column) a command on whole rows or columns acts on: the end of the selection,
 * or, for one that runs to the end of the sheet, one past the last row (column) in use. A selection
 * far longer than that is cut at MAX_LINES lines, but never above the rows (columns) in use.
 */
export function lastLine(r: Range, kind: 'row' | 'col', used: number): number {
  const lo = kind === 'row' ? r.r1 : r.c1, hi = kind === 'row' ? r.r2 : r.c2;
  const end = reaches(r, kind) ? Math.min(hi, Math.max(used, lo) + 1) : hi;
  return Math.min(end, Math.max(used + 1, lo + MAX_LINES - 1));
}

/** Does a command on these rows (columns) stop short of the end of what is selected, short of the sheet's end? */
export function cutShort(r: Range, kind: 'row' | 'col', used: number): boolean {
  const hi = kind === 'row' ? r.r2 : r.c2;
  return !reaches(r, kind) && lastLine(r, kind, used) < hi;
}

/** How many rows (columns) Delete Rows (Delete Columns) takes out: all that are selected, or, for a selection that runs to the end of the sheet, those up to the last in use. */
export function deleteCount(r: Range, kind: 'row' | 'col', used: number): number {
  const lo = kind === 'row' ? r.r1 : r.c1, hi = kind === 'row' ? r.r2 : r.c2;
  return (reaches(r, kind) ? Math.min(hi, Math.max(lo, used)) : hi) - lo + 1;
}

/** A block as far as its cells go: a side that runs to the end of the sheet stops at the cells in use. */
export function usedPart(r: Range, lastRow: number, lastCol: number): Range {
  return {
    r1: r.r1, c1: r.c1,
    r2: r.r2 >= MAX_ROWS - 1 ? Math.min(r.r2, Math.max(lastRow, r.r1)) : r.r2,
    c2: r.c2 >= MAX_COLS - 1 ? Math.min(r.c2, Math.max(lastCol, r.c1)) : r.c2,
  };
}
