// @vitest-environment jsdom
//
// The paragraph mark's own formatting (w:pPr/w:rPr: how Word shows the ¶, and what text typed at
// the paragraph's end looks like) is kept when the file is saved, and not written where it is the
// paragraph's own.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

/** Each paragraph's mark formatting (its w:pPr/w:rPr's content), in order. */
const marks = (x: string) => [...x.matchAll(/<w:p>(?:<w:pPr>((?:(?!<\/w:pPr>).)*)<\/w:pPr>)?/g)].map((m) => /<w:rPr>(.*?)<\/w:rPr>/.exec(m[1] ?? '')?.[1] ?? '');

describe('the paragraph mark', () => {
  it("keeps its own formatting, and none is written where it has none", async () => {
    const body = '<w:p><w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:t>bold mark</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>plain mark</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:rPr><w:i/></w:rPr></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>italic, mark too</w:t></w:r></w:p>' +
      // (the last paragraph's mark has no line break to keep its look on: see the change's known limits)
      '<w:p><w:r><w:t>last</w:t></w:r></w:p>';
    const saved = await writeDocx((await readDocx(docx(body))).doc, deps);
    const x = strFromU8(unzipSync(saved)['word/document.xml']);
    const [bold, plain, italic] = marks(x.slice(x.indexOf('<w:body>')));
    expect(bold).toContain('<w:b/>');
    expect(bold).toContain('<w:sz w:val="28"/>');
    // (a mark with none of its own looks as its text does: here Word's 10 pt with no defaults, not the 11 pt Normal written)
    const plainRun = /<w:r><w:rPr>((?:(?!<\/w:rPr>).)*)<\/w:rPr><w:t[^>]*>plain mark/.exec(x)?.[1] ?? '';
    expect(plain).toBe(plainRun);
    expect(plain).not.toContain('<w:b/>');
    expect(italic).toContain('<w:i/>');
    // the same on a second save
    const again = strFromU8(unzipSync(await writeDocx((await readDocx(saved)).doc, deps))['word/document.xml']);
    expect(again).toBe(x);
  });
});
