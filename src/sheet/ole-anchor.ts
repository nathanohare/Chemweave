// Where an object Excel embedded in a sheet (kept, not shown here: io/xlsx-ole.ts) goes when rows
// or columns are inserted or deleted (audit G2-01).

import type { KeptSheetOle } from '../io/xlsx-ole';

/**
 * An object's place after rows (or columns) are inserted (`count` > 0) or deleted at `at`: moved
 * with its cells, its size kept (Excel's Move but don't size with cells); at the edge of a
 * deleted block that held its corner.
 */
export function shiftOle(o: KeptSheetOle, axis: 'row' | 'col', at: number, count: number): KeptSheetOle {
  if (!o.at) return o;
  const [i, j] = axis === 'row' ? [1, 3] : [0, 2];
  const from = o.at[i], to = o.at[j];
  let nf = from;
  if (count > 0) { if (from >= at) nf = from + count; } else if (from >= at - count) nf = from + count; else if (from >= at) nf = at;
  if (nf === from) return o;
  const next = [...o.at] as [number, number, number, number];
  next[i] = nf;
  next[j] = Math.max(nf, to + (nf - from));
  return { ...o, at: next };
}
