// @vitest-environment jsdom
//
// A paragraph indented into the margin (ECMA-376 Part 1, §17.3.1.12 ind: w:left and w:right may be
// negative; Layout ▸ Indent Left below 0) keeps its indent (F-W-004: it was read as 0 and dropped).

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const wordFile = (body: string) => zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
  '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
  'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
});

describe('a paragraph indented into the margin (F-W-004)', () => {
  const file = wordFile('<w:p><w:pPr><w:ind w:left="-360" w:right="-720"/></w:pPr><w:r><w:t>Outdented</w:t></w:r></w:p><w:p><w:r><w:t>Normal</w:t></w:r></w:p>');
  it('is read with its negative indents, laid out into the margin, and saved with them', async () => {
    const { doc } = await readDocx(file);
    expect(doc.paras[0].indent).toBe(-18);
    expect(doc.paras[0].indentRight).toBe(-36);
    const lay = new DocLayouter({ measure: (s: string, size: number) => s.length * size * 0.5, drawingSize: () => ({ w: 10, h: 10 }) }).layout(doc);
    const [out, normal] = lay.text.lines;
    expect(normal.x - out.x).toBeCloseTo(18, 0);
    const xml = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
    expect(xml).toMatch(/<w:ind w:left="-360" w:right="-720"/);
  });
});
