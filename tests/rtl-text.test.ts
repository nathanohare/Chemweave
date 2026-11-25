// @vitest-environment jsdom
//
// Right-to-left paragraphs (Hebrew, Arabic: Word's w:bidi) in documents: read and saved with Word
// files, laid out from the right with each direction's words in the order they read, the caret and
// selection where the letters are, and the PDF's letters in the order they are seen, Arabic's
// joined (office sampler F-V-02: W-CHR-84, W-CHR-85).

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { layoutText, caretPos, offsetInLine, selectionRects, type TextLayout } from '../src/text/layout';
import { visualText, visualOrder, dirChunks, shapeArabic } from '../src/text/bidi';
import { VectorContext } from '../src/render/vector';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { bidiXml } from '../src/io/docx-write';
import { newDocument, paraFromStyle, restylePara, type DocText } from '../src/document/document';
import { writePdf } from '../src/io/pdf';
import { woffToSfnt } from '../src/io/font-embed';
import { fallbackFamily, fallbackPicks, FALLBACK_PACKAGES, type PdfFallbackSource } from '../src/io/pdf-fallback';
import { readFileSync } from 'node:fs';
import { unzlibSync } from 'fflate';

const woff = (path: string) => woffToSfnt(new Uint8Array(readFileSync(path)));
const families = FALLBACK_PACKAGES.map((pkg) => fallbackFamily(pkg, JSON.parse(readFileSync(`node_modules/@fontsource/${pkg}/unicode.json`, 'utf8'))));
const fallback: PdfFallbackSource = async (ch, text) => fallbackPicks(families, [ch], text).map(({ pkg, subset }) => ({ key: `${pkg}/${subset}`, load: async () => woff(`node_modules/@fontsource/${pkg}/files/${pkg}-${subset}-400-normal.woff`) }));
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
function streams(pdf: Uint8Array): string[] {
  const s = latin1(pdf);
  const out: string[] = [];
  for (let i = s.indexOf('stream\n'); i >= 0; i = s.indexOf('stream\n', i + 7)) {
    const end = s.indexOf('\nendstream', i);
    const raw = Uint8Array.from(s.slice(i + 7, end), (c) => c.charCodeAt(0));
    try { out.push(latin1(unzlibSync(raw))); } catch { out.push(latin1(raw)); }
    i = end;
  }
  return out;
}

// (every character 5 pt wide at size 10)
const measure = (t: string, size: number) => [...t].length * size * 0.5;
const run = (text: string) => ({ text, font: 'Arial', size: 10 });
const lay = (text: string, rtl: boolean, extra: Record<string, unknown> = {}): TextLayout =>
  layoutText({ runs: [run(text)], paras: [{ rtl, align: 'left', ...extra } as never], justify: 'left', wrap: 200 }, 10, measure);
const seen = (l: TextLayout) => [...l.lines[0].pieces].filter((g) => !g.hidden).sort((a, b) => a.x - b.x).map((g) => g.text);

describe('right-to-left text: the order it is seen in', () => {
  it('cuts text where its direction changes, and orders the pieces as the Unicode bidi algorithm does', () => {
    expect(dirChunks('שלום world שלום')).toEqual([[0, 4, 'R'], [4, 5, null], [5, 10, 'L'], [10, 11, null], [11, 15, 'R']]);
    // (a number's separators and signs are the number's)
    expect(dirChunks('שלום 12.5% x')).toEqual([[0, 4, 'R'], [4, 5, null], [5, 10, 'EN'], [10, 11, null], [11, 12, 'L']]);
    expect(visualOrder(['R', null, 'L', null, 'R'], true).order).toEqual([4, 3, 2, 1, 0]);
    expect(visualOrder(['L', null, 'R', null, 'R', null, 'L'], false).order).toEqual([0, 1, 4, 3, 2, 5, 6]);
    // digits after right-to-left letters sit among them, in their own order (review)
    expect(visualOrder(['R', null, 'EN', null, 'R'], false).order).toEqual([4, 3, 2, 1, 0]);
    expect(visualOrder(['L', null, 'R', null, 'EN'], false).order).toEqual([0, 1, 4, 3, 2]);
    // a tab ends a stretch, taking the paragraph's direction (review)
    expect(visualOrder(['R', 'B', 'R'], false).order).toEqual([0, 1, 2]);
    expect(visualOrder(['L', 'B', 'L'], true).order).toEqual([2, 1, 0]);
  });

  it('turns a piece round for a PDF, digits and Latin kept as they read, brackets turned', () => {
    const v = (t: string) => visualText(t, [...t].map(() => 1)).text;
    expect(v('שלום')).toBe('םולש');
    expect(v('שנת 2024 טוב')).toBe('בוט 2024 תנש');
    expect(v('(שלום)')).toBe('(םולש)');
    expect(v('abc')).toBe('abc');
    // Arabic-Indic digits, and numbers with separators and signs, as they read (review)
    expect(v('سنة ١٢٣')).toBe('١٢٣ ﺔﻨﺳ');
    expect(v('שלום 12.5%')).toBe('12.5% םולש');
    expect(v('שלום 1,000')).toBe('1,000 םולש');
    // a piece drawn right to left: brackets turned
    expect(visualText('(', [1], true).text).toBe(')');
  });

  it('joins Arabic letters (initial, medial, final, isolated; lam-alef as one), widths going with them', () => {
    const s = shapeArabic([...'كيمياء'], [1, 1, 1, 1, 1, 1, 1]);
    // (Unicode's presentation forms: kaf initial, yeh and meem medial, alef final, hamza isolated)
    expect(s.chars.map((c) => c.charCodeAt(0))).toEqual([0xfedb, 0xfef4, 0xfee4, 0xfef4, 0xfe8e, 0x0621]);
    const la = shapeArabic([...'لا'], [2, 3]);
    expect(la).toEqual({ chars: ['ﻻ'], widths: [5] });
    // Persian letters too (peh, tcheh: Presentation Forms-A) (review)
    expect(shapeArabic([...'پچ'], [1, 1]).chars.map((c) => c.charCodeAt(0))).toEqual([0xfb58, 0xfb7b]);
  });
});

describe('a right-to-left paragraph laid out', () => {
  it('starts at the right, its alignment and indents by start and end', () => {
    const l = lay('שלום world', true);
    const g = l.lines[0].pieces.filter((p) => !p.hidden);
    const right = Math.max(...g.map((p) => p.x + p.w));
    expect(right).toBeCloseTo(200);
    // (the Latin word to the left of the Hebrew one, as it reads in a right-to-left line)
    expect(seen(l)).toEqual(['world', ' ', 'שלום']);
    // an indent from the start: from the right
    const ind = lay('שלום', true, { indent: 20 });
    expect(Math.max(...ind.lines[0].pieces.map((p) => p.x + p.w))).toBeCloseTo(180);
    // aligned to the end: on the left
    const end = lay('שלום', true, { align: 'right' });
    expect(Math.min(...end.lines[0].pieces.map((p) => p.x))).toBeCloseTo(0);
  });

  it('keeps a left-to-right paragraph as it was, with a Hebrew word in it turned round in its place', () => {
    const plain = lay('abc def', false);
    expect(plain.lines[0].pieces.map((g) => [g.text, g.x])).toEqual([['abc def', 0]]);
    expect(seen(lay('abc שלום def', false))).toEqual(['abc', ' ', 'שלום', ' ', 'def']);
    // digits after Hebrew: among it (review)
    expect(seen(lay('שלום 123 עולם', false))).toEqual(['עולם', ' ', '123', ' ', 'שלום']);
    expect(seen(lay('abc שלום 123', false))).toEqual(['abc', ' ', '123', ' ', 'שלום']);
  });

  it('turns brackets and spaces among right-to-left text round with it, and ends with a full stop on the left (review)', () => {
    const l = lay('שלום (2020) עולם', true);
    expect(seen(l)).toEqual(['עולם', ') ', '2020', ' (', 'שלום']);
    // (the bracket pieces are drawn right to left: their brackets turned, as a canvas does)
    expect(l.lines[0].pieces.filter((g) => /[()]/.test(g.text)).every((g) => g.rtl)).toBe(true);
    expect(seen(lay('Hello world.', true))).toEqual(['.', 'Hello world']);
  });

  it('puts the caret where the letters are, and selects each direction\'s part', () => {
    const l = lay('שלום world', true);
    // the start of the paragraph: at its right end; after the first Hebrew letter, one letter to the left
    expect(caretPos(l, 0).x).toBeCloseTo(200);
    expect(caretPos(l, 1).x).toBeCloseTo(195);
    // and back: a click there gives the same place
    expect(offsetInLine(l, 0, 195)).toBe(1);
    expect(offsetInLine(l, 0, 199)).toBe(0);
    // across the space between the two directions, the caret moves (review)
    const m = lay('שלום abc', true);
    expect(caretPos(m, 4).x).not.toBeCloseTo(caretPos(m, 5).x);
    // the Hebrew word and the space: one rectangle each, at the right
    const r = selectionRects(l, 0, 5);
    expect(r.map((x) => [x.x1, x.x2])).toEqual([[180, 200], [175, 180]]);
  });
});

describe('a right-to-left piece in a PDF', () => {
  it('is written in the order its letters are seen, Arabic joined', async () => {
    const v = new VectorContext();
    v.font = '10px Arial';
    // (the drawing keeps the text as written, for SVG and EMF, whose readers order it themselves;
    // a right-to-left piece is marked so)
    v.fillText('שלום', 0, 0);
    v.direction = 'rtl';
    v.fillText('(2020)', 0, 0);
    const items = v.items.filter((i) => i.kind === 'text') as { text: string; rtl?: boolean }[];
    expect(items.map((i) => [i.text, !!i.rtl])).toEqual([['שלום', false], ['(2020)', true]]);
    // a PDF writes each in the order its letters are seen, Arabic joined
    const pdf = await writePdf([{ w: 200, h: 100, items: [
      { kind: 'text', text: 'שלום لا', x: 10, y: 50, size: 10, family: 'Arial', bold: false, italic: false, color: '#000000', widths: [5, 5, 5, 5, 5, 5, 5] },
    ] }], { image: async () => null, fonts: async () => [woff('node_modules/@fontsource/arimo/files/arimo-latin-400-normal.woff')], fallback });
    const maps = streams(pdf).filter((t) => t.includes('beginbfchar')).join('\n');
    // (the joined lam-alef, not lam and alef apart)
    expect(maps).toContain('<FEFB>');
    expect(maps).not.toContain('<0644>');
  });
});

describe('Word files: w:bidi', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
  const docx = (body: string, styles = '') => zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`)),
    'word/styles.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles}</w:styles>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
  const para = (pPr: string, text: string) => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const bidiCount = (bytes: Uint8Array) => (strFromU8(unzipSync(bytes)['word/document.xml']).match(/<w:bidi\b/g) ?? []).length;

  it('takes a right-to-left style\'s direction when the style is applied (review)', () => {
    const doc = newDocument();
    const heb = { ...doc.styles.Normal, id: 'Heb', name: 'Heb', rtl: true };
    expect(restylePara(paraFromStyle(doc.styles.Normal, {}), doc.styles.Normal, heb).rtl).toBe(true);
  });

  it('reads a paragraph\'s own and its style\'s, and writes each once, as it was', async () => {
    const styles = '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Heb"><w:name w:val="Heb"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/></w:pPr></w:style>';
    const file = docx(para('<w:bidi/><w:jc w:val="left"/>', 'שלום') + para('<w:pStyle w:val="Heb"/>', 'כימיה') + para('', 'plain'), styles);
    const t = (await readDocx(file)).doc as DocText;
    expect(t.paras.map((p) => !!p.rtl)).toEqual([true, true, false]);
    const once = await writeDocx(t, deps);
    // (the first paragraph's own w:bidi, once; the second's from its style, which says so)
    expect(bidiCount(once)).toBe(1);
    expect(strFromU8(unzipSync(once)['word/styles.xml'])).toMatch(/w:styleId="Heb">.*<w:bidi\/>/);
    const back = (await readDocx(once)).doc as DocText;
    expect(back.paras.map((p) => !!p.rtl)).toEqual([true, true, false]);
  });

  it('puts w:bidi in its place among the kept settings, or turns it off, as the paragraph is now', () => {
    expect(bidiXml('<w:kinsoku w:val="0"/><w:snapToGrid w:val="0"/>', true, false)).toBe('<w:kinsoku w:val="0"/><w:bidi/><w:snapToGrid w:val="0"/>');
    expect(bidiXml('<w:bidi/>', false, false)).toBe('');
    expect(bidiXml('', false, true)).toBe('<w:bidi w:val="0"/>');
    expect(bidiXml('<w:bidi/>', true, false)).toBe('<w:bidi/>');
    expect(bidiXml('', true, true)).toBe('');
  });
});
