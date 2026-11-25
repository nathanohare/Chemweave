// @vitest-environment jsdom
//
// A paragraph style's own numbering (w:numPr in the style) stays in the style when the file is
// saved; its paragraphs stay numbered, and one that isn't a list here says so to Word (list 0), so
// Word doesn't number it from the style.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { newParaStyle, type DocText } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

const STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Numbered"><w:name w:val="Numbered"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="200"/></w:numPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>`;
const NUMBERING = `<w:abstractNum w:abstractNumId="7"><w:nsid w:val="1A2B3C4D"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="200"><w:abstractNumId w:val="7"/></w:num>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/><Relationship Id="rIdN" Type="${R}numbering" Target="numbering.xml"/></Relationships>`)),
    'word/styles.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${STYLES}</w:styles>`)),
    'word/numbering.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:numbering ${W}>${NUMBERING}</w:numbering>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

const para = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Numbered"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const styleOf = (x: string, id: string) => new RegExp(`<w:style [^>]*w:styleId="${id}">.*?</w:style>`).exec(x)?.[0] ?? '';

describe("a paragraph style's numbering", () => {
  it('stays in the style; its paragraphs stay numbered; the same on a second save', async () => {
    const t = (await readDocx(docx(para('one') + para('two') + '<w:p/>'))).doc as DocText;
    expect(t.paras[0].list).toBe('number');
    expect(t.styles.Numbered.wnum).toEqual({ num: '200' });
    const once = await writeDocx(t, deps);
    const files = unzipSync(once);
    const st = styleOf(strFromU8(files['word/styles.xml']), 'Numbered');
    const id = /<w:numPr><w:numId w:val="(\d+)"\/><\/w:numPr>/.exec(st)?.[1];
    expect(id).toBeTruthy();
    // (the list it names is in the file, as the paragraphs' own)
    expect(strFromU8(files['word/numbering.xml'])).toContain(`<w:num w:numId="${id}">`);
    // in its place: after widow control, before the spacing (ECMA-376 Part 1 §17.3.1.26 CT_PPrBase)
    expect(st).toMatch(/<w:numPr>.*<\/w:numPr><w:spacing /);
    const back = (await readDocx(once)).doc as DocText;
    expect(back.paras.slice(0, 2).map((p) => p.list)).toEqual(['number', 'number']);
    const twice = unzipSync(await writeDocx(back, deps));
    for (const part of ['word/document.xml', 'word/styles.xml']) expect(strFromU8(twice[part])).toBe(strFromU8(files[part]));
  });

  it("isn't given by Word to a paragraph of the style that isn't a list here", async () => {
    const t = (await readDocx(docx(para('one') + para('two') + '<w:p/>'))).doc as DocText;
    const paras = t.paras.map((p, i) => (i === 1 ? { ...p, list: undefined, level: undefined } : p));
    const once = await writeDocx({ ...t, paras }, deps);
    const x = strFromU8(unzipSync(once)['word/document.xml']);
    expect(x).toContain('<w:numPr><w:numId w:val="0"/></w:numPr>');
    const back = (await readDocx(once)).doc as DocText;
    expect(back.paras[0].list).toBe('number');
    expect(back.paras[1].list).toBeUndefined();
  });

  it("isn't taken by a style made from one of its paragraphs (New Style)", async () => {
    const t = (await readDocx(docx(para('one') + '<w:p/>'))).doc as DocText;
    expect(newParaStyle(t, 'Mine', 0, {}).t.styles.Mine?.wnum).toBeUndefined();
  });
});
