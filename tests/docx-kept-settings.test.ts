// @vitest-environment jsdom
//
// Document settings kept through Word that were lost before the field round-trip check (standing
// rule R3) found them: a paragraph that carries on the list item above (Shift+Enter), written as
// Word's "no numbering" (list 0) on the item's level with a hidden bookmark saying so; a table's
// Table Style Options while it has no style; heading rows that don't repeat in a grid table (a
// hidden bookmark in its first cell); and a cell lined up on its own in a column of two, which a
// tied vote no longer makes the column's. Word's own markup is read as ECMA-376 says for every
// file: list 0 is no numbering, Repeat Header Rows off is not a heading row (review F7b-R05, R06),
// and a change made in Word wins over the bookmarks. Documents are built here in code; Word's
// edits are made on the saved XML the way Word writes them (simulated, not made in Word).

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import type { ParaStyle, TableData, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const xmlOf = async (d: DocText) => strFromU8(unzipSync(await writeDocx(d, deps))['word/document.xml']);
const trip = async (d: DocText) => (await readDocx(await writeDocx(d, deps))).doc;
/** Saved, its document.xml changed by `edit`, and read back. */
const tripEdited = async (d: DocText, edit: (xml: string) => string) => {
  const files = unzipSync(await writeDocx(d, deps));
  files['word/document.xml'] = strToU8(edit(strFromU8(files['word/document.xml'])));
  return (await readDocx(zipSync(files))).doc;
};

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

describe('Word\'s "no numbering" from Word or another program (review F7b-R05)', () => {
  const item = (): DocText => text([['First item', { list: 'bullet' }], ['more about it', { list: 'bullet', cont: true }]]);
  it('is a plain paragraph after Word took the bullet off and set it back to the margin', async () => {
    const back = await tripEdited(item(), (x) => x.replace(/<w:ind w:left="\d+" w:firstLine="0"\/>/, '<w:ind w:left="0" w:firstLine="0"/>'));
    expect([back.paras[1].list, back.paras[1].cont, back.paras[1].indent ?? 0]).toEqual([undefined, undefined, 0]);
  });
  it('is a plain paragraph without this program\'s bookmark, even indented to the item\'s text', async () => {
    const back = await tripEdited(item(), (x) => x.replace(/<w:bookmarkStart w:id="\d+" w:name="_ChemCont[^"]*"\/><w:bookmarkEnd w:id="\d+"\/>/, ''));
    expect([back.paras[1].list, back.paras[1].cont]).toEqual([undefined, undefined]);
    expect(back.paras[1].indent).toBeGreaterThan(0);
  });
});

describe('Repeat Header Rows from Word or another program (review F7b-R06)', () => {
  const plain = { ...TABLE, rows: [...structuredClone(TABLE.rows), [{ runs: [{ text: '2' }] }, { runs: [{ text: '85' }] }]] };
  it('off on every row: no heading rows', async () => {
    const t = tableOf(await tripEdited(withTable(plain), (x) => x.replace(/<w:tr>/g, '<w:tr><w:trPr><w:tblHeader w:val="0"/></w:trPr>').replace(/<w:trPr><w:tblHeader w:val="0"\/><\/w:trPr><w:trPr>(<w:tblHeader\/>)?/g, '<w:trPr><w:tblHeader w:val="false"/>')));
    expect([t.head, !!t.noRepeat]).toEqual([0, false]);
  });
  it('set in Word on rows saved here as heading rows that don\'t repeat: Word\'s', async () => {
    const t = tableOf(await tripEdited(withTable({ ...plain, head: 1, noRepeat: true }), (x) => {
      let k = 0;
      return x.replace(/<w:tr>/g, (m) => (k++ < 2 ? '<w:tr><w:trPr><w:tblHeader/></w:trPr>' : m));
    }));
    expect([t.head, !!t.noRepeat]).toEqual([2, false]);
  });
  it('are not saved off: a bookmark keeps heading rows that don\'t repeat', async () => {
    const xml = await xmlOf(withTable({ ...plain, head: 2, noRepeat: true }));
    expect(xml).not.toContain('tblHeader');
    expect(xml).toMatch(/w:name="_ChemHeads2_\d+"/);
    expect(tableOf(await trip(withTable({ ...plain, head: 2, noRepeat: true }))).head).toBe(2);
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
