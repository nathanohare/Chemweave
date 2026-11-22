// @vitest-environment jsdom
//
// Word's own groups of pictures (Arrange > Group: a wpg:wgp, [MS-ODRAWXML] 2.4, inside an
// mc:AlternateContent, ECMA-376 part 3 §10.2, with the VML v:group for older Words) are saved
// back as one group, not as separate pictures (audit G2-14). Built here as Word writes one.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
  + 'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const EMU = 12700;

function wordFile(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/media/image1.png': PNG,
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="${REL}image" Target="media/image1.png"/></Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  });
}

const groupPic = (id: number, x: number, y: number, w: number, h: number) => `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}" descr="trace ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
  + `<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;

/** An HPLC trace over its peak table as Word groups them, 200 × 150 pt, the children in units twice the group's. */
const hplcGroup = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>`
  + `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="3" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
  + `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${20 * EMU}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${10 * EMU}</wp:posOffset></wp:positionV>`
  + `<wp:extent cx="${200 * EMU}" cy="${150 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/><wp:docPr id="3" name="Group 3"/><wp:cNvGraphicFramePr/>`
  + `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:cNvGrpSpPr/>`
  + `<wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * EMU}" cy="${150 * EMU}"/><a:chOff x="1000" y="2000"/><a:chExt cx="${400 * EMU}" cy="${300 * EMU}"/></a:xfrm></wpg:grpSpPr>`
  + groupPic(31, 1000, 2000, 400 * EMU, 200 * EMU) + groupPic(32, 1000 + 20 * EMU, 2000 + 220 * EMU, 360 * EMU, 80 * EMU)
  + `</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>`
  + `<mc:Fallback><w:pict><v:group style="position:absolute;width:200pt;height:150pt" coordorigin="1000,2000" coordsize="${400 * EMU},${300 * EMU}">`
  + `<v:shape style="position:absolute;left:1000;top:2000;width:${400 * EMU};height:${200 * EMU}"><v:imagedata r:id="rId5" o:title=""/></v:shape></v:group></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;

type Pic = { kind: string; alt?: string; w: number; h: number; float?: { group?: number; x: number; y: number; wrap: string } };

describe('Word groups of pictures (G2-14)', () => {
  it('opens without a note, and saves one anchor holding both pictures, with the VML group for older Words', async () => {
    const { doc, warnings } = await readDocx(wordFile(hplcGroup));
    expect(warnings).toHaveLength(0);
    const out = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
    expect(out.match(/<wp:anchor /g)).toHaveLength(1);
    const wgp = /<wpg:wgp>[\s\S]*?<\/wpg:wgp>/.exec(out)?.[0] ?? '';
    expect(wgp.match(/<pic:pic>/g)).toHaveLength(2);
    // the group's frame round both (200 x 150 pt at the trace's top left), each picture inside it where it was
    expect(out).toContain(`<wp:positionH relativeFrom="margin"><wp:posOffset>${20 * EMU}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${10 * EMU}</wp:posOffset>`);
    expect(out).toContain(`<wp:extent cx="${200 * EMU}" cy="${150 * EMU}"/>`);
    expect(wgp).toContain(`<a:off x="${10 * EMU}" y="${110 * EMU}"/><a:ext cx="${180 * EMU}" cy="${40 * EMU}"/>`);
    expect(wgp).toMatch(/<pic:cNvPr id="\d+" name="Picture \d+" descr="trace 32"\/>/);
    expect(out).toMatch(/<mc:Fallback><w:pict [^>]*>.*<v:group [^>]*coordsize="\d+,\d+">(<v:shape [^>]*><v:imagedata r:id="rId\d+" o:title=""\/><\/v:shape>){2}<w10:wrap type="topAndBottom"\/><\/v:group><\/w:pict><\/mc:Fallback>/);
  });

  it('opens what it saved as the same group, each picture where it was', async () => {
    const { doc } = await readDocx(wordFile(hplcGroup));
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    const pics = Object.values(again.objects).filter((o) => o.kind === 'picture') as unknown as Pic[];
    expect(pics).toHaveLength(2);
    expect(pics[0]).toMatchObject({ w: 200, h: 100, alt: 'trace 31', float: { wrap: 'topBottom', x: 20, y: 10 } });
    expect(pics[1]).toMatchObject({ w: 180, h: 40, float: { wrap: 'topBottom', x: 30, y: 120 } });
    expect(pics[0].float?.group).toBeDefined();
    expect(pics[0].float?.group).toBe(pics[1].float?.group);
  });

  it('saves the pictures one by one once one is taken out of the group here', async () => {
    const { doc } = await readDocx(wordFile(hplcGroup));
    const pics = Object.values(doc.objects).filter((o) => o.kind === 'picture') as unknown as Pic[];
    delete pics[1].float!.group;
    const out = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
    expect(out).not.toContain('<wpg:wgp>');
    expect(out.match(/<wp:anchor /g)).toHaveLength(2);
  });

  it('gives every VML shape its own id and writes the picture shape type once (review F2-R12)', async () => {
    // two groups, one of nine pictures
    const nine = hplcGroup.replace(/(<\/wpg:grpSpPr>)[\s\S]*?(<\/wpg:wgp>)/, (_, a: string, b: string) => a + Array.from({ length: 9 }, (_x, k) => groupPic(40 + k, 1000 + k * 40 * EMU, 2000, 40 * EMU, 40 * EMU)).join('') + b)
      .replace('name="Group 3"', 'name="Group 4"').replace('wp:docPr id="3"', 'wp:docPr id="4"');
    const { doc } = await readDocx(wordFile(hplcGroup + nine));
    const out = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
    expect(out.match(/<wpg:wgp>/g)).toHaveLength(2);
    const ids = [...out.matchAll(/o:spid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2 + 9 + 2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.match(/<v:shapetype id="_x0000_t75"/g)).toHaveLength(1);
  });
});
