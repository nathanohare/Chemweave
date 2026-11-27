// Code review batch 24 (tables): each test fails on the code before the fix.

import { describe, expect, it } from 'vitest';
import type { TableData, TextRun } from '../src/model';
import { cellAlign, deleteColumn, insertColumn, layoutTable, tableRules } from '../src/table';

const measure = (t: string, size: number) => t.length * size * 0.5;
const R = (text: string): { runs: TextRun[] } => ({ runs: text ? [{ text }] : [] });

describe('a straddle rule under a heading merged down', () => {
  // three heading rows; "conditions" spans two columns and two rows (rows 0 and 1)
  const table = (): TableData => ({
    cols: [30, 60, 50, 40],
    rows: [
      [R('entry'), { runs: [{ text: 'conditions' }], span: 2, rowSpan: 2 }, R(''), R('yield')],
      [R(''), R(''), R(''), R('')],
      [R(''), R('catalyst'), R('solvent'), R('')],
      [R('1'), R('Pd'), R('THF'), R('45')],
    ],
    head: 3,
    lines: 'acs',
  });

  it('runs under the merged cell, not through it', () => {
    const t = table();
    const lay = layoutTable(t, 10, measure);
    const straddle = tableRules(t, lay).filter((l) => !(l.x1 === 0 && l.x2 === lay.width));
    expect(straddle).toHaveLength(1);
    // under rows 0 and 1 (the cell's bottom), not under row 0
    expect(straddle[0].y1).toBe(lay.ys[2]);
    expect(straddle[0].y1).not.toBe(lay.ys[1]);
  });

  it('a heading merged down to the last heading row gets none (the rule under the headings is there)', () => {
    const t = table();
    t.rows[0][1] = { runs: [{ text: 'conditions' }], span: 2, rowSpan: 3 };
    const lay = layoutTable(t, 10, measure);
    const straddle = tableRules(t, lay).filter((l) => !(l.x1 === 0 && l.x2 === lay.width));
    expect(straddle).toEqual([]);
  });
});

describe('inserting and deleting a column keeps the others as they are aligned', () => {
  const two = (): TableData => ({ cols: [40, 40, 40], rows: [[R('a'), R('b'), R('c')]], head: 0, lines: 'acs' });

  it('a column added at the left leaves the old first column left-aligned', () => {
    const t = insertColumn(two(), 0);
    expect([0, 1, 2, 3].map((c) => cellAlign(t, 0, c))).toEqual(['center', 'left', 'center', 'center']);
  });

  it('deleting the first column leaves the others centered', () => {
    const t = deleteColumn(two(), 0);
    expect([0, 1].map((c) => cellAlign(t, 0, c))).toEqual(['center', 'center']);
  });

  it('an explicit alignment moves with its column', () => {
    const t = insertColumn({ ...two(), align: ['right', 'left', 'center'] }, 1);
    expect(t.align).toEqual(['right', 'center', 'left', 'center']);
    expect(deleteColumn(t, 1).align).toEqual(['right', 'left', 'center']);
  });

  it('a column added at the right changes nothing else', () => {
    const t = insertColumn(two(), 3);
    expect([0, 1, 2, 3].map((c) => cellAlign(t, 0, c))).toEqual(['left', 'center', 'center', 'center']);
  });
});
