// Why a Spreadsheet command cannot run, asked on every move of the selection (G5-28; review of
// F5, R01): cheap on a 20,000-row sheet, the costly check worked out only when asked for in full
// and kept until the workbook or the active cell changes.
import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { SheetCanRun, SHEET_REASONS, tableHere } from '../src/sheet/can-run';
import type { SheetSelection } from '../src/sheet/can-run';

const ROWS = 20_000, COLS = 6;

function bigBook(): Workbook {
  const wb = new Workbook();
  const s = wb.sheet;
  wb.edit('fill', () => {
    for (let c = 0; c < COLS; c++) s.setInput(0, c, `Head ${c}`);
    for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) s.setInput(r, c, String(r * COLS + c));
  });
  return wb;
}
const at = (r: number, c: number): SheetSelection => ({ active: { r, c }, range: { r1: r, c1: c, r2: r, c2: c } });

describe('Spreadsheet can-run checks on a 20,000-row sheet', () => {
  const wb = bigBook();
  const s = wb.sheet;

  it('finds the table around a cell quickly and correctly', () => {
    const t0 = performance.now();
    const R = s.currentRegion(10_000, 3);
    const ms = performance.now() - t0;
    expect(R).toEqual({ r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 });
    expect(ms).toBeLessThan(250);
  });

  it('answers the selection-change questions in well under a millisecond each', () => {
    const can = new SheetCanRun();
    const cmds = ['remove-duplicates', 'custom-sort', 'text-to-columns', 'data-table', 'property-column'];
    const t0 = performance.now();
    // 1,000 moves of the active cell, each asking every check as the ribbon does (lazily)
    for (let i = 0; i < 1000; i++) {
      const sel = at((i * 17) % ROWS, i % COLS);
      for (const cmd of cmds) can.why(s, sel, cmd, wb.edits, true);
    }
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
    expect(can.worked).toBe(0);
  });

  it('works out the structure-column check once per change and cell, only when asked in full', () => {
    const can = new SheetCanRun();
    const sel = at(500, 2);
    // lazily, with nothing known yet: shown as available (running it says why not)
    expect(can.why(s, sel, 'property-column', wb.edits, true)).toBeNull();
    expect(can.worked).toBe(0);
    // in full (menu opened, pointer resting on the button): numbers only, so no structure column
    expect(can.why(s, sel, 'property-column', wb.edits)).toBe(SHEET_REASONS['property-column']);
    expect(can.worked).toBe(1);
    // kept: neither the full nor the lazy question looks at the table again
    expect(can.why(s, sel, 'property-column', wb.edits)).toBe(SHEET_REASONS['property-column']);
    expect(can.why(s, sel, 'property-column', wb.edits, true)).toBe(SHEET_REASONS['property-column']);
    expect(can.worked).toBe(1);
    // a change to the workbook makes it look again: SMILES in column A now
    wb.edit('smiles', () => { for (let r = 1; r < 40; r++) s.setInput(r, 0, r % 2 ? 'CCO' : 'c1ccccc1'); });
    expect(can.why(s, sel, 'property-column', wb.edits)).toBeNull();
    expect(can.worked).toBe(2);
    wb.undo();
    expect(can.why(s, sel, 'property-column', wb.edits)).toBe(SHEET_REASONS['property-column']);
    expect(can.worked).toBe(3);
  });

  it('gives the right answers for tables and empty cells', () => {
    const can = new SheetCanRun();
    expect(can.why(s, at(5, 2), 'custom-sort', wb.edits)).toBeNull();
    expect(can.why(s, at(5, 2), 'remove-duplicates', wb.edits)).toBeNull();
    // the cell just beside the table counts (its current region reaches the table), one further does not
    expect(tableHere(s, at(5, COLS))).toBe(true);
    expect(can.why(s, at(5, COLS + 1), 'custom-sort', wb.edits)).toBe(SHEET_REASONS['custom-sort']);
    expect(can.why(s, at(5, COLS + 1), 'remove-duplicates', wb.edits)).toBe(SHEET_REASONS['remove-duplicates']);
    // a selection of several cells is a table to sort
    expect(can.why(s, { active: { r: 30, c: 9 }, range: { r1: 30, c1: 9, r2: 32, c2: 9 } }, 'custom-sort', wb.edits)).toBeNull();
    // Text to Columns: one column only
    expect(can.why(s, { active: { r: 1, c: 0 }, range: { r1: 1, c1: 0, r2: 9, c2: 1 } }, 'text-to-columns', wb.edits)).toBe(SHEET_REASONS['text-to-columns']);
    expect(can.why(s, { active: { r: 1, c: 0 }, range: { r1: 1, c1: 0, r2: 9, c2: 0 } }, 'text-to-columns', wb.edits)).toBeNull();
    // an empty cell far from the table: no table, answered without looking at the whole table
    expect(can.why(s, at(5, 20), 'property-column', wb.edits)).toBe(SHEET_REASONS['property-column']);
    // commands with no check
    expect(can.why(s, at(5, 2), 'bold', wb.edits)).toBeUndefined();
  });
});
