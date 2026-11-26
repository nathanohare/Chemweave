// @vitest-environment jsdom
// Document mode's Border Painter: a drag along several cells' edges is one step of Undo (the first
// edge makes the step, the ones after it join it), as on the SI tab.
import { describe, it, expect } from 'vitest';
import { docMode } from './doc-mode-harness';
import { objectRun } from '../src/document/document';
import { PaintDrag } from '../src/document/table-styles';
import type { BorderLine, TableData } from '../src/model';

type Private = { paintAt(p: { x: number; y: number }, drag: PaintDrag): void };
const PEN: BorderLine = { style: 'single', w: 1.5, color: '#ff0000' };

describe('Border Painter in a document', () => {
  it('keeps a drag along three cells as one step of Undo', async () => {
    const cell = (text: string) => ({ runs: [{ text }] });
    const { dm, f } = await docMode({ runs: [{ text: 'Table 1. ' }], paras: [{}], objects: { 2: { kind: 'table', table: { cols: [100, 100, 100], rows: [[cell('a'), cell('b'), cell('c')], [cell('1'), cell('2'), cell('3')]], head: 1, lines: 'none' } } } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(2, {})] }, 'Insert table');
    const table = () => (f.t.objects[2] as { table: TableData }).table;
    const tb = f.layout().tables.get(2)!;
    const row = tb.rows[0];
    const drag = new PaintDrag(PEN);
    // along the bottom of the first row, a point in each cell just above its bottom edge
    for (let c = 0; c < 3; c++) (dm as unknown as Private).paintAt({ x: row.x + tb.xs[c] + 30, y: row.y + tb.hs[0] - 0.5 }, drag);
    expect(drag.count).toBe(3);
    for (let c = 0; c < 3; c++) expect(table().rows[0][c].borders?.bottom).toEqual(PEN);
    f.ed.undo();
    for (let c = 0; c < 3; c++) expect(table().rows[0][c].borders).toBeUndefined();
    // (the step before is the table's insertion)
    expect(Object.keys(f.t.objects)).toContain('2');
  }, 60000);
});
