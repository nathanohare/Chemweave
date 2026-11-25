// @vitest-environment jsdom
//
// A shape in line with text in Word stays in line when the file is saved (while it isn't moved
// here), and a shape's gradient fill is kept (while its fill isn't changed here).

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { gradientOk } from '../src/io/docx-write';
import type { DocText, DocObject } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const GRAD = '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="1B7F79"/></a:gs><a:gs pos="100000"><a:srgbClr val="EEF2E6"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>';

/** A paragraph with a Word shape (an ellipse), in line or floating, filled so. */
const shape = (where: 'inline' | 'anchor', fill: string) => {
  const g = `<wp:docPr id="1" name="Oval 1"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${fill}</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>`;
  const box = where === 'inline'
    ? `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/>${g}</wp:inline>`
    : `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="2" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><wp:wrapSquare wrapText="bothSides"/>${g}</wp:anchor>`;
  return `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${box}</w:drawing></mc:Choice><mc:Fallback/></mc:AlternateContent></w:r></w:p>`;
};
function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}
const shapeOf = (t: DocText) => Object.values(t.objects).find((o) => o.kind === 'textbox') as Extract<DocObject, { kind: 'textbox' }>;
const saved = async (t: DocText) => strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);

describe("a Word shape's place and fill", () => {
  it('in line with text stays in line, and the same on a second save; moved here, it floats', async () => {
    const t = (await readDocx(docx(shape('inline', '<a:solidFill><a:srgbClr val="1B7F79"/></a:solidFill>')))).doc as DocText;
    expect(shapeOf(t).float.inline).toBe(true);
    const x = await saved(t);
    expect(x).toContain('<wp:inline');
    expect(x).not.toContain('<wp:anchor');
    const back = (await readDocx(await writeDocx(t, deps))).doc as DocText;
    expect(await saved(back)).toBe(x);
    const o = shapeOf(t);
    const moved = { ...t, objects: Object.fromEntries(Object.entries(t.objects).map(([k, v]) => [k, v === o ? { ...o, float: { ...o.float, x: 36 } } : v])) } as DocText;
    expect(await saved(moved)).toContain('<wp:anchor');
    // (a floating one stays floating)
    expect(shapeOf((await readDocx(docx(shape('anchor', '')))).doc as DocText).float.inline).toBeUndefined();
  });

  it('keeps a gradient (shown as its first colour) while its fill is unchanged', async () => {
    const t = (await readDocx(docx(shape('anchor', GRAD)))).doc as DocText;
    expect(shapeOf(t).fill).toBe('#1b7f79');
    expect(await saved(t)).toContain('<a:gsLst><a:gs pos="0"><a:srgbClr val="1B7F79"/></a:gs>');
    const o = shapeOf(t);
    const recoloured = { ...t, objects: Object.fromEntries(Object.entries(t.objects).map(([k, v]) => [k, v === o ? { ...o, fill: '#ff0000' } : v])) } as DocText;
    const x = await saved(recoloured);
    expect(x).not.toContain('gradFill');
    expect(x).toContain('<a:srgbClr val="FF0000"/>');
  });

  it("writes only a gradient made of DrawingML's own elements", () => {
    expect(gradientOk(GRAD)).toBe(true);
    expect(gradientOk(GRAD.replace('</a:gsLst>', '</a:gsLst><w:p/>'))).toBe(false);
    expect(gradientOk(GRAD.replace('pos="0"', 'pos="0" x="<"'))).toBe(false);
    expect(gradientOk(GRAD + '<evil/>')).toBe(false);
    expect(gradientOk(GRAD.replace('<a:lin', 'text<a:lin'))).toBe(false);
    expect(gradientOk(5)).toBe(false);
    // (well formed: closed in order, nothing on a closing tag, each attribute once)
    expect(gradientOk(GRAD.replace('</a:gs><a:gs pos="100000">', '<a:gs pos="100000">'))).toBe(false);
    expect(gradientOk(GRAD.replace('<a:gs pos="0">', '<a:gs pos="0" pos="1">'))).toBe(false);
    expect(gradientOk(GRAD.replace('</a:gsLst>', '</a:gsLst x="1">'))).toBe(false);
    expect(gradientOk(GRAD.replace('<a:gs pos="0">', '<a:gs foo:bar="1" pos="0">'))).toBe(false);
  });

  it('floats again (written as Word places a figure) when hidden, named, grouped or positioned here', async () => {
    const t = (await readDocx(docx(shape('inline', '<a:solidFill><a:srgbClr val="1B7F79"/></a:solidFill>')))).doc as DocText;
    const o = shapeOf(t);
    for (const change of [{ hidden: true }, { name: 'Logo' }, { group: 1 }, { yFrom: 'margin' as const }, { align: 'left' as const }, { gap: 9 }]) {
      const d = { ...t, objects: Object.fromEntries(Object.entries(t.objects).map(([k, v]) => [k, v === o ? { ...o, float: { ...o.float, ...change } } : v])) } as DocText;
      expect(await saved(d), JSON.stringify(change)).toContain('<wp:anchor');
    }
  });

  it("shows a gradient whose first stop shows through as no fill, keeps it, and the same on a second save", async () => {
    const fade = '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="1B7F79"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>';
    const t = (await readDocx(docx(shape('anchor', fade)))).doc as DocText;
    expect(shapeOf(t).fill).toBeUndefined();
    const once = await writeDocx(t, deps);
    const x = strFromU8(unzipSync(once)['word/document.xml']);
    expect(x).toContain('<a:alpha val="0"/>');
    expect(await saved((await readDocx(once)).doc as DocText)).toBe(x);
  });
});
