// @vitest-environment jsdom
//
// A linked style pair (a paragraph style and the character style with its look, Quote and Quote Char)
// stays linked both ways when the file is saved, also where the paragraph style is read under
// another id (a heading in another language's file); a style made from one is not linked.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { newParaStyle, type DocText } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

const STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerQuote"><w:name w:val="Sampler Quote"/><w:basedOn w:val="Normal"/><w:link w:val="SamplerQuoteChar"/><w:rPr><w:i/></w:rPr></w:style>` +
  `<w:style w:type="character" w:customStyle="1" w:styleId="SamplerQuoteChar"><w:name w:val="Sampler Quote Char"/><w:link w:val="SamplerQuote"/><w:rPr><w:i/></w:rPr></w:style>` +
  // a heading in a German file: Word's "heading 1" under the id berschrift1
  `<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:link w:val="berschrift1Zchn"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>` +
  `<w:style w:type="character" w:customStyle="1" w:styleId="berschrift1Zchn"><w:name w:val="Überschrift 1 Zchn"/><w:link w:val="berschrift1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>`;

function docx(): Uint8Array {
  const body = `<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Head</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="SamplerQuote"/></w:pPr><w:r><w:t>quoted</w:t></w:r></w:p><w:p/>`;
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`)),
    'word/styles.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${STYLES}</w:styles>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

const styleOf = (x: string, id: string) => new RegExp(`<w:style [^>]*w:styleId="${id}">.*?</w:style>`).exec(x)?.[0] ?? '';
const linkOf = (style: string) => /<w:link w:val="([^"]*)"\/>/.exec(style)?.[1];

describe('a linked style pair', () => {
  it('stays linked both ways, also under the id a heading is read as; the same on a second save', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const quote = Object.values(t.styles).find((s) => s.name === 'Sampler Quote')!;
    expect(quote.link).toBe('SamplerQuoteChar');
    const once = await writeDocx(t, deps);
    const x = strFromU8(unzipSync(once)['word/styles.xml']);
    expect(linkOf(styleOf(x, quote.id))).toBe('SamplerQuoteChar');
    expect(linkOf(styleOf(x, 'SamplerQuoteChar'))).toBe(quote.id);
    // (in its place: after the name, basedOn and next, before uiPriority; ECMA-376 Part 1 §17.7.4.17)
    expect(styleOf(x, quote.id)).toMatch(/<w:basedOn [^>]*\/>(<w:next [^>]*\/>)?<w:link [^>]*\/><w:uiPriority/);
    // the heading: read as Heading1 here, its Zchn style linked back to that
    expect(linkOf(styleOf(x, 'Heading1'))).toBe('berschrift1Zchn');
    expect(linkOf(styleOf(x, 'berschrift1Zchn'))).toBe('Heading1');
    const again = strFromU8(unzipSync(await writeDocx((await readDocx(once)).doc, deps))['word/styles.xml']);
    expect(again).toBe(x);
  });

  it('is not linked to a style made from one of it (New Style)', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const made = newParaStyle(t, 'Mine', 1, {});
    expect(made.t.styles[made.id].link).toBeUndefined();
    const x = strFromU8(unzipSync(await writeDocx(made.t, deps))['word/styles.xml']);
    expect(linkOf(styleOf(x, made.id))).toBeUndefined();
  });
});
