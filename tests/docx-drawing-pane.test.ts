// @vitest-environment jsdom
//
// A Word drawing's name and hidden mark in the Selection Pane (ECMA-376 Part 1, §20.4.2.5 docPr
// name and hidden): every drawing was saved renamed "Picture N" (F-W-019), and a picture in line
// with text lost its hidden mark (F-W-020).

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { floatOf, withFloat, type DocObject } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DML = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
// a 2 × 1 pixel PNG
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };

const graphic = '<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdP"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
const inline = (docPr: string) => `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr}${graphic}</wp:inline></w:drawing></w:r></w:p>`;
const anchor = (docPr: string) => `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>` +
  `<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>${docPr}${graphic}</wp:anchor></w:drawing></w:r></w:p>`;

function wordFile(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdP" Type="${R}image" Target="media/p.png"/></Relationships>`),
    'word/media/p.png': PNG,
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W} ${DML}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`),
  });
}
const docPrs = async (bytes: Uint8Array) => {
  const xml = strFromU8(unzipSync(await writeDocx((await readDocx(bytes)).doc, deps))['word/document.xml']);
  return { xml, list: [...xml.matchAll(/<wp:docPr [^>]*\/>/g)].map((m) => m[0]) };
};

describe('a drawing\'s name and hidden mark (F-W-019, F-W-020)', () => {
  it('keeps the names Word gave, in the line and floating, and a hidden picture in the line hidden', async () => {
    const file = wordFile(inline('<wp:docPr id="1" name="Spectrum overlay" hidden="1"/>') + inline('<wp:docPr id="2" name="Logo"/>') + anchor('<wp:docPr id="3" name="Floating photo"/>'));
    const { list } = await docPrs(file);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatch(/name="Spectrum overlay"/);
    expect(list[0]).toMatch(/hidden="1"/);
    expect(list[1]).toMatch(/name="Logo"/);
    expect(list[1]).not.toMatch(/hidden/);
    expect(list[2]).toMatch(/name="Floating photo"/);
  });

  it('says the same when the saved file is opened and saved again', async () => {
    const file = wordFile(inline('<wp:docPr id="1" name="Spectrum overlay" hidden="1"/>') + anchor('<wp:docPr id="3" name="Floating photo"/>'));
    const once = await docPrs(file);
    const savedBytes = await writeDocx((await readDocx(file)).doc, deps);
    const twice = await docPrs(savedBytes);
    expect(twice.list.map((d) => d.replace(/ id="\d+"/, ''))).toEqual(once.list.map((d) => d.replace(/ id="\d+"/, '')));
  });
});

describe('a drawing\'s name and hidden mark: the review\'s cases', () => {
  it('go with a picture made to float and put back in the line', () => {
    const inLine: DocObject = { kind: 'picture', src: 'data:,', w: 10, h: 10, wordPr: { name: 'Logo', hidden: true } };
    const floating = withFloat(inLine, { wrap: 'square', x: 0, y: 0 });
    expect(floatOf(floating)).toMatchObject({ name: 'Logo', hidden: true });
    expect((floating as { wordPr?: unknown }).wordPr).toBeUndefined();
    const back = withFloat(floating, undefined);
    expect(floatOf(back)).toBeUndefined();
    expect((back as { wordPr?: unknown }).wordPr).toEqual({ name: 'Logo', hidden: true });
  });

  it('keeps a name given in Word to a picture in a file saved here, and the name it had', async () => {
    const saved = await writeDocx((await readDocx(wordFile(inline('<wp:docPr id="1" name="Picture 7"/>')))).doc, deps);
    // in Word: the picture renamed, and hidden="0" (not hidden)
    const files = unzipSync(saved);
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace(/(<wp:docPr id="\d+" name=")[^"]*"/, '$1Renamed in Word" hidden="0"'));
    const { list } = await docPrs(zipSync(files));
    expect(list[0]).toMatch(/name="Renamed in Word"/);
    expect(list[0]).not.toMatch(/hidden/);
    // and the name it had from Word stays with it in the file saved here
    const { doc } = await readDocx(saved);
    const pic = Object.values(doc.objects).find((o) => o.kind === 'picture') as { wordPr?: { name?: string } };
    expect(pic.wordPr?.name).toBe('Picture 7');
  });
});

describe('the names this program gives', () => {
  it('are not taken for names given in Word when its own file is opened again', async () => {
    // a picture with no name of its own, saved here as "Picture N"
    const { doc } = await readDocx(wordFile(inline('<wp:docPr id="1" name=""/>')));
    const saved = await writeDocx(doc, deps);
    const again = (await readDocx(saved)).doc;
    const pic = Object.values(again.objects).find((o) => o.kind === 'picture') as { wordPr?: unknown };
    expect(pic.wordPr).toBeUndefined();
  });
});
