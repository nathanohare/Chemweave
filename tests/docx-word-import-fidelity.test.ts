// @vitest-environment jsdom
//
// A Word file opens as Word shows it (checked against a real supporting-information file, which
// isn't kept here: these files are built to have the same parts):
// - EMF pictures that hold only EMF+ (what Word for Mac writes for a pasted ChemDraw drawing: one
//   bitmap drawn by DrawImage) are drawn, not left as empty boxes;
// - Word's own groups of pictures (an HPLC trace over its peak table) come in as their pictures,
//   each where the group puts it, floating and grouped, instead of the first one alone;
// - a list numbered in a way the library doesn't have (A. at the top) keeps its own numbering;
// - a header with blank lines, its own font and tab stops is kept as Word's paragraphs, and a
//   page number in a frame at the right is at the right;
// - a style based on a heading but set to body text (TOC Heading) isn't in the contents, and the
//   contents show the headings' numbers, in the file's own TOC 1 style.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { emfToSvg } from '../src/render/emf-read';
import { emfPlusPixels } from '../src/render/emf-plus';
import { listInfo } from '../src/text/paragraphs';
import { tocEntries, tocLines } from '../src/document/toc';
import { newDocument, paraFromStyle, styleOf, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { layoutText } from '../src/text/layout';
import type { TextRun } from '../src/model';

// ---------------------------------------------------------------- EMF+ only pictures

/** An EMF+ record: type, flags, then its data (padded to 4 bytes). */
function plusRec(type: number, flags: number, data: number[] | Uint8Array): Uint8Array {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  const pad = (4 - (d.length % 4)) % 4;
  const out = new Uint8Array(12 + d.length + pad);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, type, true); dv.setUint16(2, flags, true);
  dv.setUint32(4, out.length, true); dv.setUint32(8, d.length, true);
  out.set(d, 12);
  return out;
}
const le = (...vals: [('u32' | 'i32' | 'f32'), number][]) => {
  const b = new DataView(new ArrayBuffer(vals.length * 4));
  vals.forEach(([k, v], i) => (k === 'f32' ? b.setFloat32(i * 4, v, true) : k === 'i32' ? b.setInt32(i * 4, v, true) : b.setUint32(i * 4, v, true)));
  return new Uint8Array(b.buffer);
};
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

/** A 1000 × 500 pixel EMF (100 px/mm) whose only drawing is EMF+ in a comment: a 2 × 1 pixel PARGB bitmap drawn at 100,50 800 × 400. */
function emfPlusOnly(): Uint8Array {
  const pixels = new Uint8Array([0, 0, 128, 128, 255, 0, 0, 255]); // half-clear red (premultiplied), then blue
  const image = cat(le(['u32', 0xdbc01002], ['u32', 1], ['i32', 2], ['i32', 1], ['i32', 8], ['u32', 0x000e200b], ['u32', 0]), pixels);
  const plus = cat(
    plusRec(0x4001, 1, le(['u32', 0xdbc01002], ['u32', 1], ['u32', 96], ['u32', 96])),
    plusRec(0x4030, 2, le(['f32', 1])),
    plusRec(0x4009, 0, le(['u32', 0x00ffffff])),
    plusRec(0x4008, 0x0500 | 1, image),
    plusRec(0x401a, 1, le(['u32', 0], ['i32', 2], ['f32', 0], ['f32', 0], ['f32', 2], ['f32', 1], ['f32', 100], ['f32', 50], ['f32', 800], ['f32', 400])),
    plusRec(0x4002, 0, []),
  );
  const comment = cat(le(['u32', 70], ['u32', 16 + plus.length], ['u32', 4 + plus.length], ['u32', 0x2b464d45]), plus);
  const header = new DataView(new ArrayBuffer(108));
  [1, 108, 0, 0, 999, 499, 0, 0, 1000, 500, 0x464d4520, 0x10000, 0, 0, 0, 0, 0, 0, 10000, 10000, 100, 100, 0, 0, 0, 100000, 100000].forEach((v, i) => header.setInt32(i * 4, v | 0, true));
  return cat(new Uint8Array(header.buffer), comment, le(['u32', 14], ['u32', 20], ['u32', 0], ['u32', 16], ['u32', 20]));
}

describe('EMF+ only pictures', () => {
  it('draws the bitmap where DrawImage puts it', () => {
    const got = emfToSvg(emfPlusOnly());
    expect(got).not.toBeNull();
    expect(got!.svg).toContain('<image');
    expect(got!.svg).toContain('matrix(400 0 0 400 100 50)');
    expect(got!.svg).toContain('href="data:image/png;base64,');
    expect(got!.vectors).toBe(0);
  });

  it('turns premultiplied pixels back into plain colors', () => {
    const rgba = emfPlusPixels(0x000e200b, 2, 1, 8, new Uint8Array([0, 0, 128, 128, 255, 0, 0, 255]), []);
    expect(Array.from(rgba!)).toEqual([255, 0, 0, 128, 0, 0, 255, 255]);
  });

  it('reads indexed pixels with their palette, and rows stored bottom up', () => {
    const rgba = emfPlusPixels(0x00030803, 1, 2, -4, new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]), [0xff000000, 0xffffffff]);
    // (a negative stride: the first row stored is the bottom one)
    expect(Array.from(rgba!)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('still reads an ordinary EMF, not its EMF+ copy, when it has both', () => {
    // nothing but the EMF+ part: drawn by it; a damaged EMF+ record is no picture rather than an error
    const broken = emfPlusOnly();
    new DataView(broken.buffer).setUint32(108 + 16 + 4, 0xfffffff, true);
    expect(() => emfToSvg(broken)).not.toThrow();
  });
});

// ---------------------------------------------------------------- Word files

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
  + 'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

function wordFile(body: string, parts: { styles?: string; numbering?: string; header?: string; footer?: string; settings?: string } = {}): Uint8Array {
  const rels = [`<Relationship Id="rId5" Type="${REL}image" Target="media/image1.png"/>`, `<Relationship Id="rId6" Type="${REL}image" Target="media/image2.emf"/>`];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/x-emf"/></Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/media/image1.png': PNG,
    'word/media/image2.emf': emfPlusOnly(),
  };
  let sect = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>';
  if (parts.styles) { files['word/styles.xml'] = strToU8(`<?xml version="1.0"?><w:styles ${NS}>${parts.styles}</w:styles>`); rels.push(`<Relationship Id="rIdS" Type="${REL}styles" Target="styles.xml"/>`); }
  if (parts.numbering) { files['word/numbering.xml'] = strToU8(`<?xml version="1.0"?><w:numbering ${NS}>${parts.numbering}</w:numbering>`); rels.push(`<Relationship Id="rIdN" Type="${REL}numbering" Target="numbering.xml"/>`); }
  if (parts.settings) { files['word/settings.xml'] = strToU8(`<?xml version="1.0"?><w:settings ${NS}>${parts.settings}</w:settings>`); rels.push(`<Relationship Id="rIdT" Type="${REL}settings" Target="settings.xml"/>`); }
  if (parts.header) { files['word/header1.xml'] = strToU8(`<?xml version="1.0"?><w:hdr ${NS}>${parts.header}</w:hdr>`); rels.push(`<Relationship Id="rIdH" Type="${REL}header" Target="header1.xml"/>`); sect = `<w:headerReference w:type="default" r:id="rIdH"/>${sect}`; }
  if (parts.footer) { files['word/footer1.xml'] = strToU8(`<?xml version="1.0"?><w:ftr ${NS}>${parts.footer}</w:ftr>`); rels.push(`<Relationship Id="rIdF" Type="${REL}footer" Target="footer1.xml"/>`); sect = `<w:footerReference w:type="default" r:id="rIdF"/>${sect}`; }
  files['word/_rels/document.xml.rels'] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  files['word/document.xml'] = strToU8(`<?xml version="1.0"?><w:document ${NS}><w:body>${body}<w:sectPr>${sect}</w:sectPr></w:body></w:document>`);
  return zipSync(files);
}

const EMU = 12700;
/** A picture in a group: at x,y and w × h in the group's own units. */
const groupPic = (id: number, x: number, y: number, w: number, h: number) => `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
  + `<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;

/**
 * An HPLC trace over its peak table as Word groups them: 200 × 150 pt on the page, anchored 20 pt
 * right of the column and 10 pt below the paragraph, the group's children in units twice as
 * big as the group's extent (as Word writes them), with VML for older programs.
 */
const hplcGroup = (docPr: number, x: number) => `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>`
  + `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${docPr}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
  + `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${x * EMU}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${10 * EMU}</wp:posOffset></wp:positionV>`
  + `<wp:extent cx="${200 * EMU}" cy="${150 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/><wp:docPr id="${docPr}" name="Group ${docPr}"/><wp:cNvGraphicFramePr/>`
  + `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:cNvGrpSpPr/>`
  + `<wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * EMU}" cy="${150 * EMU}"/><a:chOff x="1000" y="2000"/><a:chExt cx="${400 * EMU}" cy="${300 * EMU}"/></a:xfrm></wpg:grpSpPr>`
  + groupPic(docPr * 10 + 1, 1000, 2000, 400 * EMU, 200 * EMU) + groupPic(docPr * 10 + 2, 1000 + 20 * EMU, 2000 + 220 * EMU, 360 * EMU, 80 * EMU)
  + `</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>`
  + `<mc:Fallback><w:pict><v:group style="position:absolute;width:200pt;height:150pt" coordorigin="1000,2000" coordsize="${400 * EMU},${300 * EMU}">`
  + `<v:shape style="position:absolute;left:1000;top:2000;width:${400 * EMU};height:${200 * EMU}"><v:imagedata r:id="rId5" o:title=""/></v:shape></v:group></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;

describe('Word pictures', () => {
  it('opens an EMF+ only picture as a picture that can be shown', async () => {
    const inline = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${100 * EMU}" cy="${50 * EMU}"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
      + `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture 1"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId6"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    const { doc } = await readDocx(wordFile(inline));
    const pic = Object.values(doc.objects).find((o) => o.kind === 'picture');
    expect(pic && pic.kind === 'picture' && pic.src.startsWith('data:image/x-emf')).toBe(true);
    expect(emfToSvg(new Uint8Array(Buffer.from((pic as { src: string }).src.split(',')[1], 'base64')))).not.toBeNull();
  });

  it('reads a group of pictures from the group: each picture placed and sized as Word has it, floating and grouped', async () => {
    const { doc, warnings } = await readDocx(wordFile(hplcGroup(3, 20) + hplcGroup(4, 250)));
    const pics = Object.values(doc.objects).filter((o) => o.kind === 'picture') as Extract<(typeof doc.objects)[number], { kind: 'picture' }>[];
    expect(pics).toHaveLength(4);
    expect(warnings).toEqual([]);
    // the trace (the group's top, full width) and its table below it, at half the children's size
    expect(pics[0]).toMatchObject({ w: 200, h: 100, float: { wrap: 'topBottom', x: 20, y: 10 } });
    expect(pics[1]).toMatchObject({ w: 180, h: 40, float: { wrap: 'topBottom', x: 30, y: 120 } });
    expect(pics[2].float).toMatchObject({ x: 250, y: 10 });
    // each group's pictures share a group, and the two groups differ
    expect(pics[0].float!.group).toBe(pics[1].float!.group);
    expect(pics[2].float!.group).toBe(pics[3].float!.group);
    expect(pics[0].float!.group).not.toBe(pics[2].float!.group);
  });

  it('saves the grouped pictures and opens them grouped again', async () => {
    const { doc } = await readDocx(wordFile(hplcGroup(3, 20)));
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    const pics = Object.values(again.objects).filter((o) => o.kind === 'picture') as { float?: { group?: number; x: number; y: number } }[];
    expect(pics).toHaveLength(2);
    expect(pics[0].float?.group).toBeDefined();
    expect(pics[0].float?.group).toBe(pics[1].float?.group);
    expect(pics[1].float).toMatchObject({ x: 30, y: 120 });
  });
});

describe('Word numbering, header and footer, contents', () => {
  const styles = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:i/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style>';
  const lvl = (i: number, fmt: string, text: string) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/></w:lvl>`;
  const numbering = `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'upperLetter', '%1.')}${lvl(1, 'decimal', '%1.%2')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
  const heading = (t: string, ilvl = 0) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const body = '<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Table of Contents</w:t></w:r></w:p>' + heading('Materials') + heading('Detail', 1) + heading('Synthesis');

  it('keeps a list\'s own numbering (A. at the top, 1.1 below) and saves it back as Word had it', async () => {
    const { doc, warnings } = await readDocx(wordFile(body, { styles, numbering }));
    expect(warnings.join(' ')).not.toMatch(/numbering/);
    expect(listInfo(doc.paras).map((x) => x.marker).filter(Boolean)).toEqual(['A.', 'A.1', 'B.']);
    const xml = strFromU8(unzipSync(await writeDocx(doc, deps))['word/numbering.xml']);
    expect(xml).toMatch(/<w:lvl w:ilvl="0">.*?<w:numFmt w:val="upperLetter"\/><w:lvlText w:val="%1\."\/>/);
    expect(xml).toMatch(/<w:lvl w:ilvl="1">.*?<w:numFmt w:val="decimal"\/><w:lvlText w:val="%1\.%2"\/>/);
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    expect(listInfo(again.paras).map((x) => x.marker).filter(Boolean)).toEqual(['A.', 'A.1', 'B.']);
  });

  it('leaves body-text styles based on a heading (TOC Heading) out of the contents, and numbers the headings', async () => {
    // (a line in the toc 1 style, as Word's contents have, so the file's style comes with it)
    const { doc } = await readDocx(wordFile(body + '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>Old line</w:t></w:r></w:p>', { styles, numbering }));
    expect(styleOf(doc, doc.paras[0]).outline).toBeUndefined();
    const entries = tocEntries(doc, 1);
    expect(entries.map((e) => [e.num, e.text])).toEqual([['A.', 'Materials'], ['A.1', 'Detail'], ['B.', 'Synthesis']]);
    // drawn in the file's toc 1 style: Times, bold italic
    const measure = (s: string, size: number) => s.length * size * 0.5;
    const lines = tocLines(entries, () => '3', styleOf(doc, undefined), 1, 400, measure, undefined, true, (n) => doc.styles[`TOC${n}`]);
    const first = lines[0].pieces[0];
    expect(first.family).toMatch(/Times New Roman/);
    expect(first.style).toBe('italic bold ');
    // the page number ends at the right, and the dots stop before it
    const num = lines[0].pieces[lines[0].pieces.length - 1];
    expect(num.x + num.w).toBeCloseTo(400);
    const dots = lines[0].pieces[lines[0].pieces.length - 2];
    expect(dots.x + dots.w).toBeLessThanOrEqual(num.x);
  });

  it('writes the file\'s own TOC styles once', async () => {
    const { doc } = await readDocx(wordFile(body, { styles, numbering }));
    const at = doc.runs.findIndex(() => true);
    expect(at).toBe(0);
    doc.objects[99] = { kind: 'toc', levels: 3 };
    doc.runs.push({ text: '\n' }, { text: '￼', obj: 99 });
    doc.paras.push({});
    const xml = strFromU8(unzipSync(await writeDocx(doc, deps))['word/styles.xml']);
    expect(xml.match(/w:styleId="TOC1"/g)).toHaveLength(1);
  });

  it('keeps a header with blank lines above, its own font and tab stops as Word\'s paragraphs', async () => {
    const blank = '<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>';
    const times = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr>';
    const header = blank + blank + `<w:p><w:pPr><w:pStyle w:val="Header"/><w:tabs><w:tab w:val="clear" w:pos="9360"/><w:tab w:val="left" w:pos="6746"/></w:tabs></w:pPr><w:r>${times}<w:tab/></w:r><w:r>${times}<w:tab/><w:t>Supporting Information</w:t></w:r></w:p>`;
    const { doc } = await readDocx(wordFile('<w:p><w:r><w:t>Text</w:t></w:r></w:p>', { styles, header }));
    const body = doc.hf?.bodies?.header;
    expect(body).toBeDefined();
    expect(body!.runs.some((r) => r.font === 'Times New Roman' && r.size === 12 && r.text.includes('Supporting Information'))).toBe(true);
    expect(body!.paras).toHaveLength(3);
    expect(body!.paras![2].tabs?.some((t) => Math.abs(t.pos - 337.3) < 0.1 && t.kind === 'left')).toBe(true);
  });

  it('puts a page number framed at the right of the margins at the right', async () => {
    const footer = '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/></w:pPr>'
      + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">PAGE  </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>15</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
      + '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:ind w:right="360"/></w:pPr></w:p><w:p/>';
    const { doc } = await readDocx(wordFile('<w:p><w:r><w:t>Text</w:t></w:r></w:p>', { styles, footer }));
    expect(doc.hf?.numbers).toBe('footer-right');
  });
});

// ---------------------------------------------------------------- page flow and text

const word2013 = '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>';

describe('page breaks, table rows', () => {
  const brk = '<w:p><w:r><w:t>Spectra</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>';

  it('starts the next page with the next paragraph after a page break that ends a paragraph (Word 2013 on)', async () => {
    const { doc } = await readDocx(wordFile(brk, { settings: word2013 }));
    expect(doc.paras).toHaveLength(2);
    expect(doc.paras[1].pageBreak).toBe(true);
    expect(doc.runs.map((r) => r.text).join('')).toBe('Spectra\nNext');
  });

  it('keeps the empty line on the next page in files made for older Words', async () => {
    const { doc } = await readDocx(wordFile(brk));
    expect(doc.paras).toHaveLength(3);
    expect(doc.paras[1].pageBreak).toBe(true);
  });

  it('takes a table\'s cell margins from its style and Word\'s Normal Table (none above and below)', async () => {
    const styles = '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
      + '<w:style w:type="table" w:styleId="GridTable1Light"><w:name w:val="Grid Table 1 Light"/><w:basedOn w:val="TableNormal"/></w:style>';
    const cell = '<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>';
    const tbl = `<w:tbl><w:tblPr><w:tblStyle w:val="GridTable1Light"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid><w:tr>${cell}</w:tr></w:tbl><w:p/>`;
    const { doc } = await readDocx(wordFile(tbl, { styles }));
    const t = Object.values(doc.objects).find((o) => o.kind === 'table');
    expect(t && t.kind === 'table' && t.table.pad).toEqual({ top: 0, bottom: 0, left: 5.4, right: 5.4 });
  });
});

describe('document text as Word lays it out', () => {
  const measure = (s: string, size: number) => s.length * size * 0.5;
  const run = (text: string, more: Partial<TextRun> = {}): TextRun => ({ font: 'Times New Roman', size: 12, text, ...more });

  it('sets subscripts and superscripts as Word does in documents, and as before elsewhere', () => {
    const runs = [run('C'), run('14', { sub: true }), run('x'), run('2', { sup: true })];
    const doc = layoutText({ runs, justify: 'left', boxes: true }, 12, measure).lines[0].pieces;
    const sub = doc.find((g) => g.text === '14')!, sup = doc.find((g) => g.text === '2')!;
    expect(sub.size).toBeCloseTo(8);
    expect(sub.dy).toBeCloseTo(0.96);
    expect(sup.dy).toBeCloseTo(-4);
    const drawing = layoutText({ runs, justify: 'left' }, 12, measure).lines[0].pieces.find((g) => g.text === '14')!;
    expect(drawing.size).toBeCloseTo(9);
    expect(drawing.dy).toBeCloseTo(2.64);
  });

  it('puts the extra of 1.15 line spacing below the text, so the first line is where single spacing puts it', () => {
    const one = layoutText({ runs: [run('Title')], justify: 'left', boxes: true }, 12, measure).lines[0];
    const more = layoutText({ runs: [run('Title')], paras: [{ line: 1.15 }], justify: 'left', boxes: true }, 12, measure).lines[0];
    expect(more.y).toBeCloseTo(one.y);
    expect(more.above).toBeCloseTo(one.above!);
    expect(more.below! - one.below!).toBeGreaterThan(1);
  });

  it('doesn\'t break a line after a slash in documents (EtOAc/hexanes), as Word doesn\'t', () => {
    const text = 'aaaa EtOAc/hexanes';
    const lines = layoutText({ runs: [run(text)], justify: 'left', boxes: true, wrap: 80 }, 12, measure).lines;
    expect(lines.map((l) => text.slice(l.start, l.end).trim())).toEqual(['aaaa', 'EtOAc/hexanes']);
  });

  it('moves a paragraph whose floating figure would run off the page to the next page, with the heading kept with it', () => {
    const d = newDocument();
    const N = d.styles.Normal;
    const filler = Array.from({ length: 40 }, (_, i) => `Line ${i}`);
    const runs: TextRun[] = [];
    filler.forEach((t) => runs.push(run(`${t}\n`)));
    runs.push(run('Heading\n'), run('￼', { obj: 1 }), run('Text under the figure'));
    const t: DocText = {
      ...d, runs,
      paras: [...filler.map(() => paraFromStyle(N, {})), { ...paraFromStyle(N, {}), keepNext: true }, paraFromStyle(N, {})],
      objects: { 1: { kind: 'picture', src: 'data:image/png;base64,', w: 300, h: 300, float: { wrap: 'topBottom', x: 0, y: 0 } } },
    };
    const lay = new DocLayouter({ measure, drawingSize: () => ({ w: 10, h: 10 }) }).layout(t);
    const fig = lay.objects.find((o) => o.id === 1)!;
    const page = lay.pages[fig.page];
    // on the next page, whole, at its top (the heading above it)
    expect(fig.page).toBe(1);
    expect(fig.y + fig.h).toBeLessThanOrEqual(page.top + t.page.h - t.page.bottom + 0.01);
  });
});
