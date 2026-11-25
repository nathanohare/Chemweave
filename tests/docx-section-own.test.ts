// @vitest-environment jsdom
//
// What each Word section has for itself, not taken from the section before: Different First Page
// (w:titlePg, F-W-013) and the page border (w:pgBorders, F-W-014). A later section linked to the
// one before's header and footer was saved with the first section's titlePg, so its first page
// lost its header in Word; a page border on a later section was dropped, and the first
// section's was written on every section.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';
import { sectionsOf, linkedHf, hasTitlePg, changeSection } from '../src/document/sections';
import { defaultHeaderFooter } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

// ECMA-376 Part 1, §17.10.6 titlePg and §17.6.10 pgBorders are properties of each section's own
// sectPr; §17.10.5 headerReference: a section without its own takes the section before's
const PG = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const BORDER = '<w:pgBorders w:offsetFrom="page"><w:top w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/><w:left w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/><w:bottom w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/><w:right w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/></w:pgBorders>';
const p = (t: string, sect = '') => `<w:p>${sect ? `<w:pPr><w:sectPr>${sect}</w:sectPr></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`;
const hdr = (t: string) => `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:hdr>`;

function wordFile(): Uint8Array {
  const body = p('one', `<w:headerReference w:type="default" r:id="rH1"/><w:headerReference w:type="first" r:id="rH2"/>${PG}<w:titlePg/>`) +
    p('two', PG) +
    p('three') + `<w:sectPr>${PG}${BORDER}</w:sectPr>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rH1" Type="${R}header" Target="header1.xml"/><Relationship Id="rH2" Type="${R}header" Target="header2.xml"/></Relationships>`),
    'word/header1.xml': strToU8(hdr('Running head')),
    'word/header2.xml': strToU8(hdr('Title page head')),
  });
}

const sectPrs = (xml: string) => [...xml.matchAll(/<w:sectPr>(.*?)<\/w:sectPr>/g)].map((m) => m[1]);

describe('what each section has for itself (F-W-013, F-W-014)', () => {
  it('reads a later section\'s own Different First Page and page border', async () => {
    const { doc } = await readDocx(wordFile());
    const secs = sectionsOf(doc);
    expect(secs.map((s) => hasTitlePg(s.hf))).toEqual([true, false, false]);
    expect(secs[1].linked).toBe(true);
    // the linked section's first page shows the usual header
    expect(secs[1].hf.header).toEqual(secs[0].hf.header);
    expect(secs.map((s) => s.border?.style ?? null)).toEqual([null, null, 'double']);
    expect(doc.pageBorder).toBeUndefined();
  });

  it('lays out each page with its section\'s border', async () => {
    const { doc } = await readDocx(wordFile());
    const lay = new DocLayouter({ measure: (s: string, size: number) => s.length * size * 0.5, drawingSize: () => ({ w: 10, h: 10 }) }).layout(doc);
    expect(lay.pages.map((pg) => pg.border?.style ?? null)).toEqual([null, null, 'double']);
  });

  it('saves titlePg only on the section that had it, and the border only on its own section', async () => {
    const { doc } = await readDocx(wordFile());
    for (let i = 0; i < 2; i++) {
      const saved = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
      const s = sectPrs(saved);
      expect(s).toHaveLength(3);
      expect(s.map((x) => x.includes('<w:titlePg/>'))).toEqual([true, false, false]);
      expect(s.map((x) => x.includes('<w:pgBorders'))).toEqual([false, false, true]);
      expect(s[2]).toContain('<w:top w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/>');
      // the next round, from this one
      Object.assign(doc, (await readDocx(await writeDocx(doc, deps))).doc);
    }
  });

  it('keeps a document-wide border on every section, as before', async () => {
    const { doc } = await readDocx(wordFile());
    const all = changeSection(doc, 2, { ownBorder: undefined });
    all.pageBorder = { style: 'single', width: 0.5, color: '#000000', from: 'page', space: 24 };
    const saved = strFromU8(unzipSync(await writeDocx(all, deps))['word/document.xml']);
    expect(sectPrs(saved).map((x) => x.includes('<w:pgBorders'))).toEqual([true, true, true]);
  });

  it('gives a linked section its own Different First Page, or none, over the one before\'s', () => {
    const titled = { ...defaultHeaderFooter(), header: ['a', '', ''] as [string, string, string], firstPage: true, first: { header: ['T', '', ''] as [string, string, string], footer: ['', '', ''] as [string, string, string] }, onFirst: true };
    expect(linkedHf(titled)).toBe(titled);
    expect(linkedHf(titled, true)).toBe(titled);
    const plain = linkedHf(titled, false);
    expect(hasTitlePg(plain)).toBe(false);
    expect(plain.header).toEqual(['a', '', '']);
    // a first page of its own with nothing before to show there: an empty one
    const untitled = { ...defaultHeaderFooter(), numbers: 'none' as const };
    const own = linkedHf(untitled, true);
    expect(hasTitlePg(own)).toBe(true);
    expect(own.first).toEqual({ header: ['', '', ''], footer: ['', '', ''] });
  });
});
