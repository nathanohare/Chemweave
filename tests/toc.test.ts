// @vitest-environment jsdom
//
// The table of contents: the headings listed with the pages they are on (worked out again when a
// heading moves to another page), dots up to each page number, saved to Word as Word's own TOC
// field, and opened here again live.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { EMPTY_TOC, tocEntries, tocText } from '../src/document/toc';
import type { ParaStyle, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number) => t.length * s * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 10, h: 10 }) });

/** The contents, then sections (Heading 1 and 2) with `fill` paragraphs of text under each. */
function sample(fill = 1, levels = 3): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal), h1 = runStyleOf(d.styles.Heading1), h2 = runStyleOf(d.styles.Heading2);
  d.objects = { 1: { kind: 'toc', levels } };
  const runs: TextRun[] = [objectRun(1, n)];
  const paras: ParaStyle[] = [paraFromStyle(d.styles.Normal, {})];
  const add = (text: string, look: typeof n, style: 'Normal' | 'Heading1' | 'Heading2') => {
    runs.push({ ...look, text: '\n' + text });
    paras.push(paraFromStyle(d.styles[style], {}));
  };
  const body = 'The crude product was purified by flash chromatography on silica gel to give the title compound as a white solid. '.repeat(4);
  for (const [i, title] of ['General Information', 'Synthesis of Compounds', 'NMR Spectra'].entries()) {
    add(title, h1, 'Heading1');
    if (i === 1) add('Ketone 3', h2, 'Heading2');
    for (let k = 0; k < fill; k++) add(body, n, 'Normal');
  }
  d.runs = runs;
  d.paras = paras;
  return d;
}

const tocLinesOf = (lay: ReturnType<DocLayouter['layout']>) => lay.text.lines.filter((l) => l.block === 1);
const shown = (l: { pieces: { text: string; obj?: number }[] }) => l.pieces.filter((p) => p.obj === undefined).map((p) => p.text).join('');

describe('table of contents', () => {
  it('lists the headings down to the depth chosen', () => {
    expect(tocEntries(sample()).map((e) => [e.level, e.text])).toEqual([[1, 'General Information'], [1, 'Synthesis of Compounds'], [2, 'Ketone 3'], [1, 'NMR Spectra']]);
    expect(tocEntries(sample(), 1).map((e) => e.text)).toEqual(['General Information', 'Synthesis of Compounds', 'NMR Spectra']);
    expect(tocText(tocEntries(sample()).slice(0, 1), () => 'S2')).toBe('General Information\tS2');
  });

  it('keeps the space above each entry its TOC style gives it, so the page below moves down by it too', () => {
    const d = sample();
    d.styles.TOC1 = { ...d.styles.Normal, id: 'TOC1', name: 'toc 1', spaceBefore: 12, spaceAfter: 0, line: 1 };
    const lay = layouter().layout(d);
    const lines = tocLinesOf(lay);
    const gap = (i: number) => lines[i].y - lines[i - 1].y;
    // the entry after a level-2 entry ("NMR Spectra" after "Ketone 3") has its 12 pt above it
    expect(gap(3) - gap(2)).toBeGreaterThan(11.9);
    // and each line says so itself (what the page uses to place the lines after the contents)
    for (let i = 1; i < lines.length; i++) expect(lines[i].above! + lines[i - 1].below!).toBeCloseTo(gap(i));
  });

  it('shows each heading with dots up to its page number at the right', () => {
    const lay = layouter().layout(sample());
    const lines = tocLinesOf(lay);
    expect(lines).toHaveLength(4);
    expect(shown(lines[0])).toMatch(/^General Information\.{3,} *1$/); // Word's dot leader: close dots
    // the numbers end at the right margin
    const right = lay.pageW - 72;
    for (const l of lines) {
      const last = l.pieces[l.pieces.length - 1];
      expect(last.x + last.w).toBeCloseTo(right, 3);
    }
    // the level 2 heading is indented
    expect(lines[2].x).toBeGreaterThan(lines[1].x);
  });

  it('follows headings onto later pages (laid out again until the numbers settle)', () => {
    const lay = layouter().layout(sample(12));
    expect(lay.pages.length).toBeGreaterThan(3);
    const pageOfPara = (p: number) => String(lay.paraTops[p].page + 1);
    const heads = tocEntries(sample(12));
    tocLinesOf(lay).forEach((l, i) => expect(shown(l).endsWith(pageOfPara(heads[i].para))).toBe(true));
    expect(shown(tocLinesOf(lay)[3])).not.toMatch(/ 1$/);
    // page numbers with a prefix (S1, S2…) as the footer shows them
    const d = sample(12);
    d.hf = { ...d.hf, prefix: 'S' };
    expect(shown(tocLinesOf(layouter().layout(d))[3])).toMatch(/S\d+$/);
  });

  it('says what to do when there are no headings', () => {
    const d = newDocument();
    d.objects = { 1: { kind: 'toc', levels: 3 } };
    d.runs = [objectRun(1, runStyleOf(d.styles.Normal))];
    const lay = layouter().layout(d);
    expect(tocLinesOf(lay).map(shown).join(' ')).toContain(EMPTY_TOC.slice(0, 30));
  });

  it('saves as Word\'s TOC field with the page numbers shown here, and opens as contents again', async () => {
    const d = sample(12, 2);
    const lay = layouter().layout(d);
    const pages = lay.paraTops.map((pt) => lay.pages[pt.page].label);
    const bytes = await writeDocx(d, { ...deps, pages: () => pages });
    const files = unzipSync(bytes);
    const body = strFromU8(files['word/document.xml']);
    expect(body).toContain('<w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText>');
    expect(body).toContain('<w:tab w:val="right" w:leader="dot"');
    expect(body).not.toContain('w:dirty');
    const nmr = tocEntries(d).find((e) => e.text === 'NMR Spectra')!;
    expect(body).toContain(`NMR Spectra</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">${pages[nmr.para]}</w:t>`);
    expect(strFromU8(files['word/styles.xml'])).toContain('<w:name w:val="toc 1"/>');
    const back = await readDocx(bytes);
    const tocs = Object.values(back.doc.objects).filter((o) => o.kind === 'toc');
    expect(tocs).toEqual([{ kind: 'toc', levels: 2 }]);
    // Word's lines of the contents are not kept as text as well
    expect(back.doc.runs.map((r) => r.text).join('')).not.toContain('Ketone 3\t');
    expect(back.doc.runs.map((r) => r.text).join('').match(/NMR Spectra/g)).toHaveLength(1);
    expect(back.warnings.join(' ')).not.toMatch(/contents/i);
  });

  it('asks Word to fill in the numbers when it has none from here', async () => {
    const body = strFromU8(unzipSync(await writeDocx(sample(), deps))['word/document.xml']);
    expect(body).toContain('w:fldCharType="begin" w:dirty="true"');
  });
});

describe('a Word file saved again here is the same (office sampler F-W-018)', () => {
  const styleOf = (bytes: Uint8Array, id: string) => {
    const xml = strFromU8(unzipSync(bytes)['word/styles.xml']);
    const at = xml.indexOf(`w:styleId="${id}"`);
    return at < 0 ? '' : xml.slice(xml.lastIndexOf('<w:style ', at), xml.indexOf('</w:style>', at) + 10);
  };

  it('writes the contents\' "toc 1" style it made the same way after the file is opened again', async () => {
    const once = await writeDocx(sample(), deps);
    const back = await readDocx(once);
    // (left out of the document's styles: it is this program's own, written again on saving)
    expect(back.doc.styles.TOC1).toBeUndefined();
    const twice = await writeDocx(back.doc, deps);
    for (const id of ['TOC1', 'TOC2', 'TOC3']) {
      expect(styleOf(twice, id)).not.toBe('');
      expect(styleOf(twice, id)).toBe(styleOf(once, id));
    }
  });

  it('keeps a "toc 1" style changed in Word as the document\'s own', async () => {
    const once = await writeDocx(sample(), deps);
    const files = unzipSync(once);
    const styles = strFromU8(files['word/styles.xml']).replace('<w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/>',
      '<w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:before="240" w:after="0"/>');
    expect(styles).toContain('w:before="240"');
    const { zipSync, strToU8 } = await import('fflate');
    const changed = zipSync({ ...files, 'word/styles.xml': strToU8(styles) });
    const back = await readDocx(changed);
    expect(back.doc.styles.TOC1?.spaceBefore).toBe(12);
  });

  it('keeps its own "toc 2" style when a paragraph of the text has it (contents turned into plain text in Word)', async () => {
    const once = await writeDocx(sample(), deps);
    const files = unzipSync(once);
    const body = strFromU8(files['word/document.xml']).replace('<w:sectPr', '<w:p><w:pPr><w:pStyle w:val="TOC2"/></w:pPr><w:r><w:t>A plain line</w:t></w:r></w:p><w:sectPr');
    const { zipSync, strToU8 } = await import('fflate');
    const back = await readDocx(zipSync({ ...files, 'word/document.xml': strToU8(body) }));
    expect(back.doc.styles.TOC2).toBeDefined();
    expect(back.doc.styles.TOC1).toBeUndefined();
    // (a paragraph in a table's cell too)
    const cell = strFromU8(files['word/document.xml']).replace('<w:sectPr', '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="TOC3"/></w:pPr><w:r><w:t>In a cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:sectPr');
    const inCell = await readDocx(zipSync({ ...files, 'word/document.xml': strToU8(cell) }));
    expect(inCell.doc.styles.TOC3).toBeDefined();
  });

  it('writes a legacy form field\'s bookmark once, round the field, after the file is opened again', async () => {
    const d = sample();
    d.objects = { ...d.objects, 2: { kind: 'form', type: 'text', name: 'Text1' } };
    d.runs = [...d.runs, { ...d.runs[d.runs.length - 1], text: '\nName: ' }, objectRun(2, runStyleOf(d.styles.Normal))];
    d.paras = [...d.paras, paraFromStyle(d.styles.Normal, {})];
    const marks = (bytes: Uint8Array) => {
      const body = strFromU8(unzipSync(bytes)['word/document.xml']);
      return [...body.matchAll(/<w:bookmarkStart w:id="\d+" w:name="Text1"\/>(<w:r>)?/g)].map((m) => !!m[1]);
    };
    const once = await writeDocx(d, deps);
    expect(marks(once)).toEqual([true]);
    const back = (await readDocx(once)).doc;
    // (the bookmark still on its paragraph here, for links and page references to it)
    expect(back.paras.some((p) => p.marks?.includes('Text1'))).toBe(true);
    const twice = await writeDocx(back, deps);
    // (one bookmark, still just before the field's first run)
    expect(marks(twice)).toEqual([true]);
    expect(twice).toEqual(await writeDocx((await readDocx(twice)).doc, deps));
  });
});
