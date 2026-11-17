// Tables in an SI project's text, changed as SI Assistant's table editor changes them (SPEC
// §13k.5): rows and columns around merged cells, merging and splitting with pictures, pasted
// cells, and the pictures' file names.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { compileSi } from '../src/si/compile-doc';
import { blockAround, cellAt, colCount, deleteColumn, deleteRow, insertColumn, insertRow, merge, newTable, ownerOf, pasteCells, pastedCells, rowsOf, setPicture, split } from '../src/si/tables';

const ROOT = join(__dirname, 'fixtures', 'si-example');
function folder(): MemoryFolder {
  const f = new MemoryFolder('si-example');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(ROOT, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(ROOT);
  return f;
}
const texts = (t: Json) => rowsOf(t).map((r) => r.map((c) => (c === null ? null : (c as Json).text)));
function grid(rows: number, cols: number): Json {
  const t = newTable('t-00000001', rows, cols);
  rowsOf(t).forEach((r, i) => r.forEach((c, k) => { (c as Json).text = `${i}${k}`; }));
  return t;
}

describe('changing an SI table', () => {
  it('adds and removes rows and columns, keeping the header rows and column alignments', () => {
    const t = grid(2, 2);
    insertRow(t, 1);
    insertColumn(t, 2, 'left');
    expect(texts(t)).toEqual([['00', '01', ''], ['', '', ''], ['10', '11', '']]);
    expect(t.columns).toEqual(['center', 'center', 'left']);
    insertRow(t, 0);
    expect(t.header_rows).toBe(2);
    deleteRow(t, 0);
    deleteColumn(t, 0);
    expect(texts(t)).toEqual([['01', ''], ['', ''], ['11', '']]);
    expect(t.header_rows).toBe(1);
    expect(t.columns).toEqual(['center', 'left']);
  });

  it('grows a merged cell a new row or column passes through, and shrinks or moves it when one goes', () => {
    const t = grid(3, 3);
    merge(t, { r: 0, c: 0, rows: 2, cols: 2 });
    expect(texts(t)[0]).toEqual(['00 01 10 11', null, '02']);
    insertRow(t, 1);
    expect(cellAt(t, 0, 0)?.rowspan).toBe(3);
    expect(texts(t)[1]).toEqual([null, null, '']);
    insertColumn(t, 1);
    expect(cellAt(t, 0, 0)?.colspan).toBe(3);
    deleteRow(t, 0);
    // the merged cell goes on from the row under it
    expect(cellAt(t, 0, 0)?.text).toBe('00 01 10 11');
    expect(cellAt(t, 0, 0)?.rowspan).toBe(2);
    deleteColumn(t, 0);
    expect(cellAt(t, 0, 0)?.colspan).toBe(2);
    expect(colCount(t)).toBe(3);
  });

  it('merges a block that cuts no merged cell, keeping the first picture; splitting leaves it top-left', () => {
    const t = grid(3, 3);
    setPicture(t, 1, 1, 'images/ligand.svg', 2.5);
    merge(t, { r: 1, c: 0, rows: 2, cols: 1 });
    // a block touching the merged cell takes all of it in
    expect(blockAround(t, 0, 0, 1, 1)).toEqual({ r: 0, c: 0, rows: 3, cols: 2 });
    merge(t, { r: 0, c: 0, rows: 2, cols: 2 });
    const first = cellAt(t, 0, 0)!;
    expect(first.image).toBe('images/ligand.svg');
    expect(first.image_width).toBe(2.5);
    expect(first.rowspan).toBe(3);
    expect(ownerOf(t, 2, 1)).toEqual({ r: 0, c: 0, rows: 3, cols: 2 });
    split(t, 2, 1);
    expect(cellAt(t, 0, 0)?.image).toBe('images/ligand.svg');
    expect(cellAt(t, 0, 0)?.rowspan).toBeUndefined();
    expect(cellAt(t, 2, 1)).toEqual({ text: '' });
    setPicture(t, 0, 0, '');
    expect(cellAt(t, 0, 0)?.image).toBeUndefined();
    expect(cellAt(t, 0, 0)?.image_width).toBeUndefined();
  });

  it('pastes cells from Excel or Word with their formatting, adding the rows and columns they need', () => {
    const t = grid(2, 2);
    setPicture(t, 1, 1, 'images/a.png');
    const cells = pastedCells([
      [{ runs: [{ text: 'CH' }, { text: '2', sub: true }, { text: 'Cl' }, { text: '2', sub: true }] }, { runs: [{ text: 'yield', bold: true }] }],
      [{ runs: [{ text: 'across' }], span: 2 }],
    ]);
    pasteCells(t, 1, 1, cells);
    expect(texts(t)).toEqual([['00', '01', ''], ['10', 'CH_{2}Cl_{2}', '**yield**'], ['', 'across', null]]);
    expect(cellAt(t, 2, 1)?.colspan).toBe(2);
    expect(cellAt(t, 1, 1)?.image).toBe('images/a.png');
  });

  it('writes a table as SI Assistant does, and names pictures apart whatever their extension', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const s = p.sections.find((x) => x.type === 'text' && x.folder.includes('reaction-optimizatio'))!;
    const rel = `${s.folder}/tables/t-1ece4eb2.json`;
    const before = new TextDecoder().decode(f.files.get(rel));
    const t = (await p.readTable(s, 't-1ece4eb2'))!;
    await p.writeTable(s, t);
    expect(new TextDecoder().decode(f.files.get(rel))).toBe(before);
    const a = await p.addSectionPicture(s, 'ligand.svg', new Uint8Array([1]), { cdxml: new Uint8Array([2]) });
    expect(a).toBe('images/ligand.svg');
    expect(f.files.has(`${s.folder}/images/ligand.cdxml`)).toBe(true);
    // (ligand.png would share ligand.svg's name)
    expect(await p.addSectionPicture(s, 'ligand.png', new Uint8Array([3]))).toBe('images/ligand (2).png');
  });

  it('prints a picture put in a cell here above the cell’s text in the compiled SI', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const s = p.sections.find((x) => x.type === 'text' && x.folder.includes('reaction-optimizatio'))!;
    const t = (await p.readTable(s, 't-1ece4eb2'))!;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60pt" height="40pt" viewBox="0 0 60 40"><path d="M0 0L60 40"/></svg>';
    setPicture(t, 0, 5, await p.addSectionPicture(s, 'structure.svg', new TextEncoder().encode(svg)), 2);
    await p.writeTable(s, t);
    const got = await compileSi(await SiProject.open(f), { contentsOf: () => null, sizeOf: () => null, facts: async (m) => m.map(() => null) });
    const table = Object.values(got.doc.objects).flatMap((o) => (o.kind === 'table' ? [o.table] : [])).find((x) => x.rows[0].length === 6)!;
    const cell = table.rows[0][5];
    expect(cell.runs[0].obj).toBeDefined();
    expect(got.doc.objects[cell.runs[0].obj!].kind).toBe('picture');
    expect(got.notes.some((n) => /structure\.svg/.test(n))).toBe(false);
  });
});
