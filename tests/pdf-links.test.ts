// @vitest-environment jsdom
//
// Links in saved files: a PDF's link annotations (to a place in the file, or a web address) and
// its outline of headings (ISO 32000-1 §12.5.6.5 link annotations, §12.3.3 document outline), and
// the table of contents' lines linked to their headings in Word (its TOC field's \h switch, with
// _Toc bookmarks on the headings) and in Chemweave's own layout.
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writePdf } from '../src/io/pdf';
import { writeDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { tocEntries, tocMark, tocMarkPara } from '../src/document/toc';
import { bookmarkPara } from '../src/document/bookmarks';
import { pdfTarget } from '../src/document/doc-paint';
import type { ParaStyle, TextRun } from '../src/model';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('PDF links and outline', () => {
  it('writes link annotations to a place in the file and to a web page, and the headings as an outline', async () => {
    const pdf = latin1(await writePdf([
      { w: 200, h: 100, items: [], links: [{ x: 10, y: 20, w: 50, h: 12, to: { page: 1, y: 30 } }, { x: 10, y: 40, w: 50, h: 12, uri: 'https://doi.org/10.1021/ol0000001' }], outline: [{ title: 'General Information', level: 1, y: 10 }] },
      { w: 200, h: 100, items: [], outline: [{ title: 'Spectra', level: 1, y: 0 }, { title: '¹H NMR of 2a', level: 2, y: 30 }] },
    ], { image: async () => null }));
    const annots = pdf.match(/\/Subtype \/Link/g) ?? [];
    expect(annots).toHaveLength(2);
    // (a place: the second page's object, 30 pt down from its top = 70 pt up from its bottom)
    const page2 = /(\d+) 0 obj\s*<<\s*\/Type \/Page\b(?![s])/g;
    const pages = [...pdf.matchAll(page2)].map((m) => Number(m[1]));
    expect(pages).toHaveLength(2);
    expect(pdf).toContain(`/Dest [${pages[1]} 0 R /XYZ null 70 null]`);
    expect(pdf).toContain('/URI (https://doi.org/10.1021/ol0000001)');
    expect(pdf).toContain('/Border [0 0 0]');
    // the rectangle in PDF's coordinates (y up from the bottom): 10 68 60 80
    expect(pdf).toMatch(/\/Rect \[10 68 60 80\]/);
    expect(pdf).toMatch(/\/Outlines \d+ 0 R/);
    expect(pdf).toContain('/PageMode /UseOutlines');
    expect(pdf).toContain('/Title (General Information)');
    // a nested heading, its parent closed (negative count)
    expect(pdf).toMatch(/\/Title \(Spectra\)[^]*?\/Count -1/);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number) => t.length * s * 0.5;

function sample(): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal), h1 = runStyleOf(d.styles.Heading1);
  d.objects = { 1: { kind: 'toc', levels: 2 } };
  const runs: TextRun[] = [objectRun(1, n)];
  const paras: ParaStyle[] = [paraFromStyle(d.styles.Normal, {})];
  for (const title of ['General Information', 'NMR Spectra']) {
    runs.push({ ...h1, text: '\n' + title });
    paras.push(paraFromStyle(d.styles.Heading1, {}));
    runs.push({ ...n, text: '\nText.' });
    paras.push(paraFromStyle(d.styles.Normal, {}));
  }
  d.runs = runs;
  d.paras = paras;
  return d;
}

describe('the table of contents links to its headings', () => {
  it('names a heading’s place as Word does, and finds it again', () => {
    expect(tocMark(3)).toBe('_Toc100000003');
    expect(tocMarkPara('_Toc100000003')).toBe(3);
    expect(tocMarkPara('_Toc123')).toBe(-1);
    const d = sample();
    const nmr = tocEntries(d).find((e) => e.text === 'NMR Spectra')!;
    expect(bookmarkPara(d, tocMark(nmr.para))).toBe(nmr.para);
  });

  it('saves each line of the contents as a link to a bookmark on its heading', async () => {
    const d = sample();
    const body = strFromU8(unzipSync(await writeDocx(d, deps))['word/document.xml']);
    for (const e of tocEntries(d)) {
      expect(body).toContain(`<w:hyperlink w:anchor="${tocMark(e.para)}" w:history="1">`);
      expect(body).toContain(`w:name="${tocMark(e.para)}"`);
    }
  });

  it('follows a line of the contents in the PDF to its heading', () => {
    const d = sample();
    const lay = new DocLayouter({ measure, drawingSize: () => ({ w: 10, h: 10 }) }).layout(d);
    const nmr = tocEntries(d).find((e) => e.text === 'NMR Spectra')!;
    const to = pdfTarget(d, lay, `#${tocMark(nmr.para)}`);
    expect(to?.to?.page).toBe(lay.paraTops[nmr.para].page);
    expect(pdfTarget(d, lay, 'https://example.org/')).toEqual({ uri: 'https://example.org/' });
    expect(pdfTarget(d, lay, '#nowhere')).toBeNull();
  });
});
