// @vitest-environment jsdom
//
// Standing rule R4: the places that must stay in step are listed in docs/developers.md ("Places that
// must stay in step"). This test iterates that list where it is cheap:
//   1. the list names every object kind, every kind of tab and every text surface the code has, so
//      a new one can't be added without the list (and so the places it names) being looked at;
//   2. rich text (bold, italic, subscript, superscript, colour) on every text surface comes back
//      from every format that saves that surface.
// What fails today is in KNOWN_GAPS, with the reason; the test fails on a gap not listed there, and
// on a listed gap that is fixed (take it off).

import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Doc, type Contents, type TextRun } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';

const DOCS = readFileSync('docs/developers.md', 'utf8');
const LIST = DOCS.slice(DOCS.indexOf('## Places that must stay in step'), DOCS.indexOf('\n## ', DOCS.indexOf('## Places that must stay in step') + 5));

/** The string literals of a union type in a source file: `kind: 'a' | 'b'` in an interface, or `type Mode = 'a' | 'b'` (field ''). */
function unionOf(file: string, iface: string, field: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === iface && !field && ts.isUnionTypeNode(n.type))
      out = n.type.types.flatMap((x) => (ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal) ? [x.literal.text] : []));
    if ((ts.isInterfaceDeclaration(n) || ts.isClassDeclaration(n)) && n.name?.text === iface) {
      for (const m of n.members) {
        if (m.name?.getText(sf) !== field) continue;
        const t = (m as ts.PropertySignature).type;
        if (t && ts.isUnionTypeNode(t)) out = t.types.flatMap((x) => (ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal) ? [x.literal.text] : []));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('the list of places that must stay in step (R4)', () => {
  it('is in docs/developers.md', () => {
    expect(LIST.length, 'docs/developers.md has no "## Places that must stay in step" section').toBeGreaterThan(500);
  });

  it('names every kind of shape in the model', () => {
    const kinds = unionOf('src/model.ts', 'Shape', 'kind');
    expect(kinds.length).toBeGreaterThan(5);
    expect(kinds.filter((k) => !LIST.includes(`\`${k}\``)), 'Shape kinds (src/model.ts) missing from "Places that must stay in step"').toEqual([]);
  });

  it('names every kind of tab', () => {
    const modes = unionOf('src/workspace.ts', 'Mode', '');
    expect(modes.length).toBeGreaterThan(3);
    expect(modes.filter((k) => !LIST.includes(`\`${k}\``)), 'kinds of tab (src/workspace.ts Mode) missing from "Places that must stay in step"').toEqual([]);
  });

  it('names every text surface: each place in the model that holds rich text', () => {
    // every `runs: TextRun[]` in src/model.ts, by the interface it is in
    const sf = ts.createSourceFile('model.ts', readFileSync('src/model.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const holders = new Set<string>();
    const visit = (n: ts.Node, owner: string) => {
      if (ts.isInterfaceDeclaration(n)) owner = n.name.text;
      if (ts.isPropertySignature(n) && ts.isInterfaceDeclaration(n.parent) && n.type && /\bTextRun\[\]/.test(n.type.getText(sf))) holders.add(`${owner}.${n.name.getText(sf)}`);
      ts.forEachChild(n, (c) => visit(c, owner));
    };
    visit(sf, '');
    expect(holders.size).toBeGreaterThan(2);
    expect([...holders].filter((h) => !LIST.includes(`\`${h}\``)), 'holders of rich text (src/model.ts) missing from "Places that must stay in step"').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Rich text on every text surface, through every format that saves it

const RUNS: TextRun[] = [
  { text: 'Yield of ', bold: true },
  { text: 'CH', italic: true },
  { text: '3', sub: true },
  { text: '+', sup: true },
  { text: ' in red', color: '#C00000' },
];
/** The formatting that must come back (font and size may be filled in by a format, so not compared). */
const look = (runs: TextRun[] | undefined) => rt.normalizeRuns((runs ?? []).map((r) => ({ text: r.text, ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}), ...(r.sub ? { sub: true } : {}), ...(r.sup ? { sup: true } : {}), ...(r.color ? { color: r.color.toUpperCase() } : {}) })))
  .map((r) => JSON.stringify(r)).join(' ').replace(/\s+/g, ' ');
const WANT = look(RUNS);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const pptxOpts: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const docxDeps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const xlsxDeps: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => PNG };

/** A drawing holding the rich text on one surface. */
const DRAWING_SURFACES: Record<string, { make: (d: Doc) => void; read: (c: Contents) => TextRun[] | undefined }> = {
  'Caption (text on a drawing)': {
    make: (d) => { d.addCaption({ x: 100, y: 100, runs: RUNS.map((r) => ({ ...r })), justify: 'left' }); },
    read: (c) => c.captions[0]?.runs,
  },
  'Shape.text (text in a design shape)': {
    make: (d) => { d.addShape({ kind: 'geo', geo: 'rect', x1: 100, y1: 100, x2: 300, y2: 160, text: { runs: RUNS.map((r) => ({ ...r })) } }); },
    read: (c) => c.shapes.find((s) => s.kind === 'geo')?.text?.runs,
  },
  'TableData.title and .notes (a table’s title and notes)': {
    make: (d) => { d.addShape({ kind: 'table', x1: 100, y1: 100, x2: 300, y2: 160, table: { cols: [200], rows: [[{ runs: [{ text: 'A' }] }]], head: 0, lines: 'acs', title: RUNS.map((r) => ({ ...r })), notes: RUNS.map((r) => ({ ...r })) } }); },
    read: (c) => { const t = c.shapes.find((s) => s.kind === 'table')?.table; return look(t?.title) === look(t?.notes) ? t?.title : [{ text: `title ${look(t?.title)}; notes ${look(t?.notes)}` }]; },
  },
  'TableCell (a table cell on a drawing)': {
    make: (d) => { d.addShape({ kind: 'table', x1: 100, y1: 100, x2: 300, y2: 160, table: { cols: [200], rows: [[{ runs: RUNS.map((r) => ({ ...r })) }]], head: 0, lines: 'grid' } }); },
    read: (c) => c.shapes.find((s) => s.kind === 'table')?.table?.rows[0]?.[0]?.runs,
  },
};

async function drawingBack(doc: Doc, format: string): Promise<Contents> {
  if (format === 'CDXML') return readCdxml(writeCdxml(doc)).doc.contents();
  if (format === 'PowerPoint') {
    const d = Deck.design(new Doc(), { w: 720, h: 405 });
    const slide = new Doc();
    slide.restoreContents(doc.contents());
    return readPptx(await writePptx({ size: d.size, master: d.master, slides: [{ layout: 'blank', doc: slide, notes: '' }] }, pptxOpts)).slides[0].contents;
  }
  if (format === 'Word figure') {
    const base = newDocument();
    const n = runStyleOf(base.styles.Normal), N = paraFromStyle(base.styles.Normal, {});
    const t: DocText = { ...base, runs: rt.normalizeRuns([{ ...n, text: 'Figure\n' }, objectRun(1, n)]), paras: [N, N], objects: { 1: { kind: 'drawing', contents: doc.contents() } } };
    const back = (await readDocx(await writeDocx(t, docxDeps))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'drawing') as { contents: Contents } | undefined;
    return o!.contents;
  }
  const wb = new Workbook(['Sheet1']);
  wb.build(() => wb.sheet.setStructure(0, 0, doc.contents()));
  return (await readXlsx(await writeXlsx(wb, xlsxDeps))).book.sheet.cell(0, 0)!.structure!.contents;
}

/** Surfaces and formats where the rich text does not come back yet, with what is lost (none in November 2026). */
const KNOWN_GAPS: Record<string, string> = {
};

describe('rich text comes back on every text surface (R4)', async () => {
  const results: Record<string, string> = {};
  for (const [surface, s] of Object.entries(DRAWING_SURFACES)) {
    for (const format of ['CDXML', 'PowerPoint', 'Word figure', 'Excel cell structure']) {
      const d = new Doc();
      d.bulk(() => s.make(d));
      let got: string;
      try { got = look(s.read(await drawingBack(d, format))); } catch (e) { got = `(failed: ${String(e).slice(0, 120)})`; }
      results[`${surface} in ${format}`] = got;
    }
  }
  // Word: the document's own text
  {
    const base = newDocument();
    const n = runStyleOf(base.styles.Normal), N = paraFromStyle(base.styles.Normal, {});
    const t: DocText = { ...base, runs: rt.normalizeRuns(RUNS.map((r) => ({ ...n, ...r }))), paras: [N] };
    const back = (await readDocx(await writeDocx(t, docxDeps))).doc;
    results['DocText (a Word document’s text) in Word'] = look(back.runs);
  }
  // Excel: a cell with formatting on part of its text
  {
    const wb = new Workbook(['Sheet1']);
    const text = RUNS.map((r) => r.text).join('');
    // (a cell's runs keep subscript and superscript as `pos`, not `sub` and `sup`: src/sheet/rich-text.ts)
    const toSheet = (r: TextRun) => { const { sub, sup, ...rest } = r; return { ...rest, ...(sub ? { pos: 'sub' as const } : sup ? { pos: 'sup' as const } : {}) }; };
    wb.build(() => wb.sheet.setRichInput(0, 0, text, RUNS.map(toSheet)));
    const back = (await readXlsx(await writeXlsx(wb, xlsxDeps))).book.sheet.cell(0, 0);
    results['Cell.runs (a spreadsheet cell) in Excel'] = look(back?.runs?.map(({ pos, ...r }) => ({ ...r, ...(pos === 'sub' ? { sub: true } : pos === 'sup' ? { sup: true } : {}) })));
  }

  for (const [where, got] of Object.entries(results)) {
    it(`${where}`, () => {
      if (KNOWN_GAPS[where]) {
        expect(got, `${where} now keeps its rich text: take it off KNOWN_GAPS in tests/parity.test.ts`).not.toBe(WANT);
        return;
      }
      expect(got, `${where}: the rich text changed (see "Places that must stay in step" in docs/developers.md)`).toBe(WANT);
    });
  }
});
