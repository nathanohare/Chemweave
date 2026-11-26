// An SI table's own look (si/table-format.ts): borders, shading, alignment down, cell margins and
// the columns' widths, kept with the table under Chemweave's key (and SI Assistant's "widths"),
// changed by Document mode's table commands, and carried into the compiled SI's table.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Json } from '../src/si/project';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { compileSi } from '../src/si/compile-doc';
import { newTable, insertColumn, deleteColumn, merge, split } from '../src/si/tables';
import { FORMAT_KEY, autoFitContents, autoFitWindow, cellFormat, columnWidthsCm, distributeColumns, setColumnWidthCm, siColumns, siTableData, storeTableData, tableFormat } from '../src/si/table-format';
import { applyBorders, resolveTable } from '../src/document/table-styles';
import { evenColumns, fillColumns, shadeCells, valignCells } from '../src/table';
import type { BorderLine, TableData } from '../src/model';

const TEXT_W = 468; // 6.5 in, in points
const PEN: BorderLine = { style: 'single', w: 1.5, color: '#c00000' };
const all = () => true;

function roundTrip(t: Json): Json { return JSON.parse(JSON.stringify(t)) as Json; }

describe('SI table format', () => {
  it('reads as the ACS rules with no look of its own', () => {
    const t = newTable('t-1', 3, 2);
    const td = siTableData(t, TEXT_W);
    expect(td.lines).toBe('acs');
    expect(td.head).toBe(1);
    expect(td.autofit).toBe(true);
    expect(td.width).toBe('auto');
    expect(td.cols).toEqual([234, 234]);
    const res = resolveTable(td);
    // (the rules above the table, under the heading row and under the last row)
    expect(res.h.map((row) => !!row[0])).toEqual([true, true, false, true]);
  });

  it('keeps borders, shading and alignment down on the cells, and they read back', () => {
    const t = newTable('t-1', 3, 3);
    let td = siTableData(t, TEXT_W);
    td = applyBorders(td, { r0: 1, c0: 1, r1: 1, c1: 1 }, 'outside', PEN);
    td = shadeCells(td, (r, c) => r === 2 && c === 0, '#ffff00');
    td = valignCells(td, (r) => r === 0, 'center');
    storeTableData(t, td);
    const back = roundTrip(t);
    const rows = back.rows as Json[][];
    expect(cellFormat(rows[1][1]).borders).toEqual({ top: PEN, bottom: PEN, left: PEN, right: PEN });
    // (the cells across its edges take the same line, as in Word)
    expect(cellFormat(rows[0][1]).borders).toEqual({ bottom: PEN });
    expect(cellFormat(rows[2][0]).fill).toBe('#ffff00');
    expect(cellFormat(rows[0][2]).valign).toBe('center');
    expect(rows[2][2]).toEqual({ text: '' });
    const again = siTableData(back, TEXT_W);
    expect(again.rows[1][1].borders?.left).toEqual(PEN);
    expect(again.rows[2][0].fill).toBe('#ffff00');
    // taking it all off leaves no key behind
    storeTableData(back, shadeCells(valignCells(applyBorders(again, { r0: 0, c0: 0, r1: 2, c1: 2 }, 'none', PEN), all, 'top'), all, undefined));
    const none = siTableData(back, TEXT_W);
    expect(none.rows[2][0].fill).toBeUndefined();
    expect(cellFormat((back.rows as Json[][])[2][0])).toEqual({ borders: { top: { style: 'none', w: 0, color: '#c00000' }, bottom: { style: 'none', w: 0, color: '#c00000' }, left: { style: 'none', w: 0, color: '#c00000' }, right: { style: 'none', w: 0, color: '#c00000' } } });
  });

  it('keeps a cell’s look with it when columns are added, deleted or cells merged', () => {
    const t = newTable('t-1', 2, 2);
    storeTableData(t, shadeCells(siTableData(t, TEXT_W), (r, c) => r === 1 && c === 1, '#00ff00'));
    insertColumn(t, 0);
    expect(cellFormat((t.rows as Json[][])[1][2]).fill).toBe('#00ff00');
    deleteColumn(t, 0);
    merge(t, { r: 1, c: 0, rows: 1, cols: 2 });
    // (merging keeps the first cell, as SI Assistant does)
    expect(cellFormat((t.rows as Json[][])[1][0]).fill).toBeUndefined();
  });

  it('ignores a hand-edited look it can’t read', () => {
    const cell = { text: '', [FORMAT_KEY]: { fill: 'red', valign: 'middle', borders: { top: { style: 'wavy' }, left: { style: 'double', w: 'x', color: '#ABCDEF' } }, pad: { top: -1, left: 4 } } };
    expect(cellFormat(cell)).toEqual({ borders: { left: { style: 'double', w: 0.5, color: '#abcdef' } }, pad: { left: 4 } });
    expect(tableFormat({ [FORMAT_KEY]: { pad: { top: 1 }, fit: 'page' } })).toEqual({});
  });

  it('keeps the table’s cell margins', () => {
    const t = newTable('t-1', 2, 2);
    const pad = { top: 2, bottom: 2, left: 8, right: 8 };
    storeTableData(t, { ...siTableData(t, TEXT_W), pad });
    expect(tableFormat(roundTrip(t)).pad).toEqual(pad);
    expect(siTableData(t, TEXT_W).pad).toEqual(pad);
    storeTableData(t, { ...siTableData(t, TEXT_W), pad: undefined });
    expect(t[FORMAT_KEY]).toBeUndefined();
  });

  it('types a column’s width in SI Assistant’s widths (cm), and fits it again', () => {
    const t = newTable('t-1', 2, 3);
    setColumnWidthCm(t, 1, 2.54, TEXT_W);
    expect(t.widths).toEqual([null, 2.54, null]);
    // (2.54 cm is 1 in, 72 pt; the other columns share what is left of the text's width)
    expect(siColumns(t, 3, TEXT_W)).toEqual({ cols: [198, 72, 198], width: 'auto', autofit: true });
    setColumnWidthCm(t, 0, 5.08, TEXT_W);
    setColumnWidthCm(t, 2, 2.54, TEXT_W);
    expect(siColumns(t, 3, TEXT_W)).toEqual({ cols: [144, 72, 72], autofit: false });
    // a column added keeps the others' widths with their columns
    insertColumn(t, 1);
    expect(columnWidthsCm(t, 4)).toEqual([5.08, null, 2.54, 2.54]);
    deleteColumn(t, 1);
    setColumnWidthCm(t, 1, null, TEXT_W);
    expect(t.widths).toEqual([5.08, null, 2.54]);
    autoFitContents(t);
    expect(t.widths).toBeUndefined();
  });

  it('keeps a key of a later version inside a cell’s look', () => {
    const t = newTable('t-1', 1, 1);
    (t.rows as Json[][])[0][0] = { text: '', [FORMAT_KEY]: { fill: '#ff0000', later: { x: 1 } } };
    storeTableData(t, valignCells(siTableData(t, TEXT_W), all, 'bottom'));
    expect((t.rows as Json[][])[0][0][FORMAT_KEY]).toEqual({ fill: '#ff0000', later: { x: 1 }, valign: 'bottom' });
  });

  it('splits a merged cell into cells with its look, each with the borders of the edges it is on', () => {
    const t = newTable('t-1', 2, 2);
    (t.rows as Json[][])[0][0] = { text: 'a', align: 'left', size: 9 };
    merge(t, { r: 0, c: 0, rows: 2, cols: 2 });
    storeTableData(t, shadeCells(applyBorders(siTableData(t, TEXT_W), { r0: 0, c0: 0, r1: 1, c1: 1 }, 'outside', PEN), all, '#eeeeee'));
    split(t, 0, 0);
    const rows = t.rows as Json[][];
    expect(rows[1][1]).toMatchObject({ text: '', align: 'left', size: 9 });
    expect(cellFormat(rows[1][1])).toEqual({ fill: '#eeeeee', borders: { bottom: PEN, right: PEN } });
    expect(cellFormat(rows[0][0])).toEqual({ fill: '#eeeeee', borders: { top: PEN, left: PEN } });
    // merged again: the block's outside lines come back from its corner cells
    merge(t, { r: 0, c: 0, rows: 2, cols: 2 });
    expect(cellFormat(rows[0][0]).borders).toEqual({ top: PEN, left: PEN, bottom: PEN, right: PEN });
  });

  it('keeps a tiny typed width above nothing', () => {
    const t = newTable('t-1', 1, 2);
    setColumnWidthCm(t, 0, 0.001, TEXT_W);
    expect(t.widths).toEqual([0.1, null]);
  });

  it('carries the typed widths with their columns when columns are added and deleted', () => {
    const t = { ...newTable('t-1', 1, 3), widths: [1, 2, 3] };
    insertColumn(t, 1);
    expect(t.widths).toEqual([1, null, 2, 3]);
    deleteColumn(t, 2);
    expect(t.widths).toEqual([1, null, 3]);
  });

  it('shrinks a partly typed table to the text with fit_width too', () => {
    const t = { ...newTable('t-1', 1, 3), widths: [30, null, null], fit_width: true };
    const got = siColumns(t, 3, TEXT_W);
    expect(got.autofit).toBe(true);
    expect(got.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(TEXT_W, 1);
  });

  it('a width typed on a table AutoFit to Window keeps it as wide as the text', () => {
    const t = newTable('t-1', 1, 3);
    autoFitWindow(t);
    setColumnWidthCm(t, 0, 2.54, TEXT_W);
    expect(tableFormat(t).fit).toBeUndefined();
    const got = siColumns(t, 3, TEXT_W);
    // (72 pt for the first; the others share the remaining 396 pt)
    expect(got.autofit).toBe(false);
    expect(got.cols[0]).toBeCloseTo(72, 0);
    expect(got.cols[1]).toBeCloseTo(198, 0);
    expect(got.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(TEXT_W, 0);
  });

  it('shrinks typed widths to the text with SI Assistant’s fit_width', () => {
    const t = { ...newTable('t-1', 1, 2), widths: [25.4, 25.4], fit_width: true };
    // (10 in each, 1440 pt together, shrunk to 468 pt)
    expect(siColumns(t, 2, TEXT_W).cols).toEqual([234, 234]);
  });

  it('AutoFit to Window: as wide as the text, the columns keeping their shares', () => {
    const t = newTable('t-1', 1, 2);
    setColumnWidthCm(t, 0, 2.54, TEXT_W);
    setColumnWidthCm(t, 1, 5.08, TEXT_W);
    autoFitWindow(t);
    expect(siColumns(t, 2, TEXT_W)).toEqual({ cols: [156, 312], width: { pct: 100 }, autofit: false });
    // a width cleared keeps it as wide as the text
    setColumnWidthCm(t, 0, null, TEXT_W);
    expect(tableFormat(t).fit).toBe('window');
  });

  it('Distribute Columns: every column the same width, as wide as the table was', () => {
    const t = newTable('t-1', 1, 2);
    setColumnWidthCm(t, 0, 2.54, TEXT_W);
    setColumnWidthCm(t, 1, 7.62, TEXT_W);
    distributeColumns(t, TEXT_W);
    expect(t.widths).toEqual([5.08, 5.08]);
    // a table fitting its text: the text's width shared
    const u = newTable('t-2', 1, 4);
    distributeColumns(u, TEXT_W);
    expect(columnWidthsCm(u, 4)).toEqual([4.12, 4.12, 4.12, 4.12]);
  });

  it('shares Document mode’s column helpers', () => {
    expect(evenColumns([100, 300], 1000)).toEqual([200, 200]);
    expect(evenColumns([400, 400], 600)).toEqual([300, 300]);
    expect(fillColumns([100, 300], 400 * 1.5)).toEqual([150, 450]);
  });
});

function folder(dir: string): MemoryFolder {
  const root = join(__dirname, 'fixtures', dir);
  const f = new MemoryFolder(dir);
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return f;
}

describe('SI table format in the compiled SI', () => {
  async function compiled(edit: (t: Json) => void) {
    const f = folder('si-example');
    const path = 'sections/s-c1aa3466_reaction-optimizatio/tables/t-1ece4eb2.json';
    const t = JSON.parse(new TextDecoder().decode(f.files.get(path))) as Json;
    edit(t);
    f.files.set(path, new TextEncoder().encode(JSON.stringify(t)));
    const got = await compileSi(await SiProject.open(f), { contentsOf: () => null, sizeOf: () => null, facts: async (mols) => mols.map(() => null) });
    const table = Object.values(got.doc.objects).find((o) => o.kind === 'table');
    if (table?.kind !== 'table') throw new Error('no table');
    return table.table;
  }
  it('sets a column typed for only some columns, Word fitting the others', async () => {
    const tb = await compiled((t) => { t.widths = [2.54, null, null, null, null, null]; });
    expect(tb.autofit).toBe(true);
    expect(tb.width).toBe('auto');
    expect(tb.cols[0]).toBeCloseTo(72, 1);
    expect(tb.cols[1]).toBeCloseTo((TEXT_W - 72) / 5, 1);
  });
  it('AutoFit to Window: the table a hundred percent of the text', async () => {
    const tb = await compiled((t) => { autoFitWindow(t); });
    expect(tb.width).toEqual({ pct: 100 });
    expect(tb.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(TEXT_W, 0);
  });

  it('carries the cells’ look, the margins and the widths into the table', async () => {
    const f = folder('si-example');
    const path = 'sections/s-c1aa3466_reaction-optimizatio/tables/t-1ece4eb2.json';
    const t = JSON.parse(new TextDecoder().decode(f.files.get(path))) as Json;
    const n = (t.columns as unknown[]).length;
    let td: TableData = siTableData(t, TEXT_W);
    td = applyBorders(td, { r0: 0, c0: 0, r1: 0, c1: n - 1 }, 'bottom', PEN);
    td = shadeCells(td, (r) => r === 1, '#eeeeee');
    td = valignCells(td, (_r, c) => c === 0, 'center');
    storeTableData(t, { ...td, pad: { top: 3, bottom: 3, left: 6, right: 6 } });
    t.widths = Array.from({ length: n }, () => 2.54);
    f.files.set(path, new TextEncoder().encode(JSON.stringify(t)));
    const p = await SiProject.open(f);
    const got = await compileSi(p, { contentsOf: () => null, sizeOf: () => null, facts: async (mols) => mols.map(() => null) });
    const table = Object.values(got.doc.objects).find((o) => o.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    const tb = table.table;
    expect(tb.lines).toBe('acs');
    expect(tb.cols).toEqual(Array.from({ length: n }, () => 72));
    expect(tb.autofit).toBe(false);
    expect(tb.pad).toEqual({ top: 3, bottom: 3, left: 6, right: 6 });
    expect(tb.rows[0][0].borders?.bottom).toEqual(PEN);
    expect(tb.rows[1][0].fill).toBe('#eeeeee');
    expect(tb.rows[2][0].valign).toBe('center');
    expect(tb.rows[2][1].valign).toBeUndefined();
    // (the cells' text is still the table's)
    expect(tb.rows[0][0].runs.map((r) => r.text).join('')).toContain('Entry');
  });
});
