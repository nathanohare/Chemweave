// @vitest-environment jsdom
//
// A paragraph style based on another (w:basedOn, a chain of them) stays based on it when the file is
// saved, also where the one it is based on isn't used (kept as the file had it) or is read under
// another id; a style based on one that is gone, or on itself through others, is based on Normal.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { deleteStyle, newParaStyle, type DocText } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

const STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Base"><w:name w:val="Base"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120"/></w:pPr><w:rPr><w:color w:val="1B7F79"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Middle"><w:name w:val="Middle"/><w:basedOn w:val="Base"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Leaf"><w:name w:val="Leaf"/><w:basedOn w:val="Middle"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>` +
  // a style named as Word's "heading 2" under its own id (read as Heading2 here), and one based on it
  `<w:style w:type="paragraph" w:styleId="Kop2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="UnderKop"><w:name w:val="Under Kop"/><w:basedOn w:val="Kop2"/><w:rPr><w:i/></w:rPr></w:style>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`)),
    'word/styles.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${STYLES}</w:styles>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

const para = (style: string, text: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const styleOf = (x: string, id: string) => new RegExp(`<w:style [^>]*w:styleId="${id}">.*?</w:style>`).exec(x)?.[0] ?? '';
const basedOf = (x: string, id: string) => /<w:basedOn w:val="([^"]*)"\/>/.exec(styleOf(x, id))?.[1];

describe("a paragraph style's chain", () => {
  it('is kept, through a style not used, and one read under another id; the same on a second save', async () => {
    // Middle is not used: kept as the file had it; Kop2 is read as Heading2
    const t = (await readDocx(docx(para('Leaf', 'leaf') + para('Base', 'base') + para('UnderKop', 'under') + para('Kop2', 'head') + '<w:p/>'))).doc as DocText;
    expect(t.styles.Leaf.basedOn).toBe('Middle');
    expect(t.styles.UnderKop.basedOn).toBe('Heading2');
    // (its look: its own and all it inherits)
    expect(t.styles.Leaf).toMatchObject({ bold: true, italic: true, color: '#1b7f79', align: 'center', indent: 18, spaceBefore: 6 });
    const once = await writeDocx(t, deps);
    const x = strFromU8(unzipSync(once)['word/styles.xml']);
    expect(basedOf(x, 'Leaf')).toBe('Middle');
    expect(basedOf(x, 'Middle')).toBe('Base');
    expect(basedOf(x, 'Base')).toBe('Normal');
    expect(basedOf(x, 'UnderKop')).toBe('Heading2');
    const back = (await readDocx(once)).doc as DocText;
    expect(back.styles.Leaf).toMatchObject({ bold: true, italic: true, color: '#1b7f79', align: 'center', indent: 18 });
    expect(strFromU8(unzipSync(await writeDocx(back, deps))['word/styles.xml'])).toBe(x);
  });

  it('a kept style based on one read under another id is based on that id', async () => {
    // UnderKop not used (kept as the file had it), Kop2 used (read as Heading2)
    const x = strFromU8(unzipSync(await writeDocx((await readDocx(docx(para('Kop2', 'head') + '<w:p/>'))).doc, deps))['word/styles.xml']);
    expect(basedOf(x, 'UnderKop')).toBe('Heading2');
  });

  it('is Normal where the style it was based on is gone, or it would be based on itself; New Style is based on Normal', async () => {
    const t = (await readDocx(docx(para('Leaf', 'leaf') + para('Middle', 'mid') + '<w:p/>'))).doc as DocText;
    const gone = deleteStyle(t, 'Middle');
    expect(basedOf(strFromU8(unzipSync(await writeDocx(gone, deps))['word/styles.xml']), 'Leaf')).toBe('Normal');
    const loop: DocText = { ...t, styles: { ...t.styles, Middle: { ...t.styles.Middle, basedOn: 'Leaf' } } };
    const lx = strFromU8(unzipSync(await writeDocx(loop, deps))['word/styles.xml']);
    expect([basedOf(lx, 'Leaf'), basedOf(lx, 'Middle')]).toContain('Normal');
    const made = newParaStyle(t, 'Mine', 0, {});
    expect(made.t.styles[made.id].basedOn).toBeUndefined();
  });
});
