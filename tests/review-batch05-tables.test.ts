// Code review 2026-11-26, batch 05 (SI builder): pasting into an SI table (F957, and an empty
// paste found in review). Every table is made up here.
import { describe, expect, it } from 'vitest';
import { merge, newTable, ownerOf, pasteCells } from '../src/si/tables';

describe('F957: a paste over merged cells', () => {
  it('splits every merged cell it lands on, and only those', () => {
    const t = newTable('t', 6, 6);
    merge(t, { r: 0, c: 0, rows: 2, cols: 2 });   // (half under the paste)
    merge(t, { r: 2, c: 3, rows: 2, cols: 2 });   // (a corner under it)
    merge(t, { r: 4, c: 4, rows: 2, cols: 2 });   // (clear of it)
    pasteCells(t, 1, 1, [[{ text: 'a' }, { text: 'b' }, { text: 'c' }], [{ text: 'd' }, { text: 'e' }, { text: 'f' }]]);
    expect(ownerOf(t, 0, 0)).toEqual({ r: 0, c: 0, rows: 1, cols: 1 });
    expect(ownerOf(t, 1, 1)).toEqual({ r: 1, c: 1, rows: 1, cols: 1 });
    expect(ownerOf(t, 2, 3)).toEqual({ r: 2, c: 3, rows: 1, cols: 1 });
    expect(ownerOf(t, 3, 4)).toEqual({ r: 3, c: 4, rows: 1, cols: 1 });
    expect(ownerOf(t, 5, 5)).toEqual({ r: 4, c: 4, rows: 2, cols: 2 });
  });

  it('an empty paste splits nothing', () => {
    const t = newTable('t', 4, 4);
    merge(t, { r: 0, c: 0, rows: 2, cols: 2 });
    pasteCells(t, 1, 1, []);
    pasteCells(t, 1, 1, [[]]);
    expect(ownerOf(t, 1, 1)).toEqual({ r: 0, c: 0, rows: 2, cols: 2 });
  });
});
