// @vitest-environment jsdom
//
// Word's border kinds that aren't drawn here (thick, triple, dotDash, wave, outset...) are kept as
// Word had them on paragraphs and table cells when the file is saved, while the line is still drawn
// as it was read; a line restyled here is written as its new kind.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { borderXml, readBorder } from '../src/io/docx-table-styles';
import type { DocText } from '../src/document/document';

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

const side = (name: string, val: string) => `<w:${name} w:val="${val}" w:sz="12" w:space="1" w:color="FF0000"/>`;
const kindOf = (x: string, name: string) => new RegExp(`<w:${name} w:val="([^"]+)"`).exec(x)?.[1];

describe("Word's border kinds", () => {
  it('are kept on a paragraph and a table cell, the same on a second save', async () => {
    const body = `<w:p><w:pPr><w:pBdr>${side('top', 'thick')}${side('left', 'triple')}${side('bottom', 'dotDash')}${side('right', 'wave')}</w:pBdr></w:pPr><w:r><w:t>bordered</w:t></w:r></w:p>` +
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:tcBorders>${side('top', 'outset')}${side('bottom', 'thinThickSmallGap')}</w:tcBorders></w:tcPr><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>`;
    const t = (await readDocx(docx(body))).doc as DocText;
    expect(t.paras[0].border?.top).toMatchObject({ style: 'single', word: 'thick' });
    expect(t.paras[0].border?.left).toMatchObject({ style: 'double', word: 'triple' });
    const once = await writeDocx(t, deps);
    const x = strFromU8(unzipSync(once)['word/document.xml']);
    const pBdr = /<w:pBdr>.*?<\/w:pBdr>/.exec(x)?.[0] ?? '';
    expect([kindOf(pBdr, 'top'), kindOf(pBdr, 'left'), kindOf(pBdr, 'bottom'), kindOf(pBdr, 'right')]).toEqual(['thick', 'triple', 'dotDash', 'wave']);
    const tc = /<w:tcBorders>.*?<\/w:tcBorders>/.exec(x)?.[0] ?? '';
    expect([kindOf(tc, 'top'), kindOf(tc, 'bottom')]).toEqual(['outset', 'thinThickSmallGap']);
    const twice = strFromU8(unzipSync(await writeDocx((await readDocx(once)).doc, deps))['word/document.xml']);
    expect(twice).toBe(x);
  });

  it('give way to a line restyled here; the kinds drawn here are written as before', () => {
    const a = (e: Element | null | undefined, n = 'val') => e?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', n) ?? null;
    const el = (val: string) => new DOMParser().parseFromString(`<w:top ${W} w:val="${val}" w:sz="8" w:color="000000"/>`, 'application/xml').documentElement;
    const thick = readBorder(el('thick'), a)!;
    expect(borderXml('top', { ...thick, style: 'dashed' })).toContain('w:val="dashed"');
    expect(borderXml('top', thick)).toContain('w:val="thick"');
    // (Word's own kinds of those drawn here carry nothing extra)
    for (const v of ['single', 'double', 'dotted', 'dashed']) expect(readBorder(el(v), a)!.word).toBeUndefined();
    // (and a kind that isn't a plain name is not written)
    expect(borderXml('top', { style: 'single', w: 1, color: '#000000', word: 'x"/><w:evil' })).toContain('w:val="single"');
  });
});
