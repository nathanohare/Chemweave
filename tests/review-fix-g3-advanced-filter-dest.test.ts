// @vitest-environment jsdom
//
// Advanced Filter, Copy to another location: the place copied to is cleared from its row down
// before the list is read, so a place in the list's columns above the list (not only in it) would
// erase the list and copy blanks. Such a place is refused; places clear of the list still copy.

import { describe, it, expect } from 'vitest';
import { copyMeetsList } from '../src/ui/sheet-data-ui';
import { Workbook } from '../src/sheet/workbook';
import { applyAdvancedFilter } from '../src/sheet/data-tools';

// 0-based rows and columns: A5:C20 is rows 4..19, columns 0..2
const list = { r1: 4, c1: 0, r2: 19, c2: 2 };

describe('Advanced Filter, Copy to', () => {
  it('refuses a place in the list’s columns at or above its last row', () => {
    expect(copyMeetsList({ row: 0, col: 0 }, list)).toBe(true); // A1, above the list
    expect(copyMeetsList({ row: 2, col: 1 }, list)).toBe(true); // B3, above, overlapping columns
    expect(copyMeetsList({ row: 0, col: 2 }, list)).toBe(true); // C1: the copy's first column over C
    expect(copyMeetsList({ row: 10, col: 0 }, list)).toBe(true); // A11, in the list
  });

  it('takes a place clear of the list', () => {
    expect(copyMeetsList({ row: 0, col: 3 }, list)).toBe(false); // D1, columns to the right
    expect(copyMeetsList({ row: 20, col: 0 }, list)).toBe(false); // A21, under the list
    expect(copyMeetsList({ row: 0, col: 10 }, list)).toBe(false); // K1
    expect(copyMeetsList({ row: 4, col: 3 }, { r1: 4, c1: 4, r2: 19, c2: 6 })).toBe(true); // D5 for E5:G20: the copy spans D..F
  });

  it('copies the passing rows to a place it takes', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    // list in A5:B8, criteria in F1:F2 (Solvent = THF), copied to D1 (columns clear of the list)
    const put = (r: number, c: number, v: string) => s.setInput(r, c, v);
    put(4, 0, 'Solvent'); put(4, 1, 'Yield');
    put(5, 0, 'THF'); put(5, 1, '80');
    put(6, 0, 'DCM'); put(6, 1, '60');
    put(7, 0, 'THF'); put(7, 1, '72');
    put(0, 5, 'Solvent'); put(1, 5, 'THF');
    const L = { r1: 4, c1: 0, r2: 7, c2: 1 };
    const dest = { row: 0, col: 3 };
    expect(copyMeetsList(dest, L)).toBe(false);
    let got = { shown: 0, total: 0 };
    wb.edit('Advanced Filter', () => { got = applyAdvancedFilter(s, { list: L, criteria: { r1: 0, c1: 5, r2: 1, c2: 5 }, copyTo: dest }); });
    expect(got).toEqual({ shown: 2, total: 3 });
    expect([0, 1, 2].map((r) => s.effectiveInput(r, 3))).toEqual(['Solvent', 'THF', 'THF']);
    expect(s.effectiveInput(5, 0)).toBe('THF'); // the list is as it was
  });
});
