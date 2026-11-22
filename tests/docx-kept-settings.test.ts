// @vitest-environment jsdom
//
// Document settings kept through Word that were lost before the field round-trip check (standing
// rule R3) found them: a paragraph that carries on the list item above (Shift+Enter), written as
// Word's "no numbering" (list 0) on the item's level; a table's Table Style Options while it has
// no style; heading rows that don't repeat in a grid table (Repeat Header Rows written off); and a
// cell lined up on its own in a column of two, which a tied vote no longer makes the column's.
// Documents are built here in code.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import type { ParaStyle, TableData, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const xmlOf = async (d: DocText) => strFromU8(unzipSync(await writeDocx(d, deps))['word/document.xml']);
const trip = async (d: DocText) => (await readDocx(await writeDocx(d, deps))).doc;

function text(lines: [string, Partial<ParaStyle>][]): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal), N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns([{ ...n, text: lines.map(([t]) => t).join('\n') }]), paras: lines.map(([, p]) => ({ ...N, ...p })) };
}

function withTable(table: TableData): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal), N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns([objectRun(1, n), { ...n, text: '\nAfter' }] as TextRun[]), paras: [N, N], objects: { 1: { kind: 'table', table } } };
}

const TABLE: TableData = { cols: [100, 80], rows: [[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'Yield' }] }], [{ runs: [{ text: '1' }] }, { runs: [{ text: '92' }] }]], head: 1, lines: 'grid' };
const tableOf = (d: DocText): TableData => Object.values(d.objects).find((o) => o.kind === 'table')!.table as TableData;

describe('a paragraph carrying on a list item (R3)', () => {
  it('comes back carrying it on, on the item\'s level', async () => {
    const back = await trip(text([['First item', { list: 'bullet', level: 1 }], ['more about it', { list: 'bullet', level: 1, cont: true }], ['Second item', { list: 'bullet', level: 1 }]]));
    expect(back.paras.map((p) => [p.list, p.level, !!p.cont])).toEqual([['bullet', 1, false], ['bullet', 1, true], ['bullet', 1, false]]);
  });
  it('is saved with no number of its own', async () => {
    const xml = await xmlOf(text([['First item', { list: 'number' }], ['more about it', { list: 'number', cont: true }]]));
    expect(xml).toContain('<w:numId w:val="0"/>');
  });
  it('is not made of a paragraph that only has Word\'s "no numbering" with no list item above', async () => {
    const back = await trip(text([['Plain', {}], ['more', { list: 'bullet', cont: true }]]));
    expect(back.paras[1].list).toBeUndefined();
  });
});

describe('a table with no style (R3)', () => {
  it('keeps its Table Style Options', async () => {
    const look = { header: true, total: true, bandRows: false, firstCol: false, lastCol: true, bandCols: true };
    expect(tableOf(await trip(withTable({ ...TABLE, look }))).look).toEqual(look);
  });
  it('gets none it did not have', async () => {
    expect(tableOf(await trip(withTable(TABLE))).look).toBeUndefined();
  });
  it('keeps heading rows that don\'t repeat on each page', async () => {
    const t = tableOf(await trip(withTable({ ...TABLE, noRepeat: true })));
    expect([t.head, t.noRepeat]).toEqual([1, true]);
  });
});

describe('a column\'s alignment (R3)', () => {
  it('stays on the left when one of its two cells is lined up on its own', async () => {
    const rows = structuredClone(TABLE.rows);
    rows[0][0].align = 'right';
    const t = tableOf(await trip(withTable({ ...TABLE, rows })));
    expect(t.align?.[0] ?? 'left').toBe('left');
    expect(t.rows[0][0].align).toBe('right');
  });
  it('keeps a cell on the left in a column that mostly is not', async () => {
    const rows = [...structuredClone(TABLE.rows), [{ runs: [{ text: '2' }] }, { runs: [{ text: '85' }] }]];
    rows[0][1].align = 'right';
    rows[1][1].align = 'right';
    const t = tableOf(await trip(withTable({ ...TABLE, rows })));
    expect(t.align?.[1]).toBe('right');
    expect(t.rows[2][1].align).toBe('left');
  });
});
