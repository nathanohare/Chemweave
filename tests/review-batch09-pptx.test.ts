// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 09: PowerPoint reading and writing (F124, F125, F126, F127, F586,
// F588, F590, F591). Files built here by the published layout (ECMA-376 part 1): a placeholder
// takes its place from the layout's placeholder with the same idx (19.3.1.36 ph); xfrm's flipH and
// flipV are xsd:boolean, "1" or "true" (20.1.7.6); outerShdw's dist is 0 when not given (20.1.8.49);
// a slide link is a hlinkClick with action "ppaction://hlinksldjump" and a relationship to the
// slide (21.1.2.3.5; [MS-PPTX]); buAutoNum's startAt is the item's number (21.1.2.4.1).

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, paragraphsXml, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { Package, NS, REL } from '../src/io/ooxml';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const u8 = (t: string) => new Uint8Array(new TextEncoder().encode(t));

const X = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const E = 12700;
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const xf = (x: number, y: number, w: number, h: number, extra = '') => `<a:xfrm${extra}><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/></a:xfrm>`;
const ph = (id: number, idx: number, spPr: string, body = '<a:p/>') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Content Placeholder ${id}"/><p:cNvSpPr/><p:nvPr><p:ph sz="half" idx="${idx}"/></p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;

/** A one-slide file shaped like PowerPoint's: the layout's shapes and the slide's shapes as given. */
function file(layoutTree: string, slideTree: string): Uint8Array {
  const pkg = new Package();
  const ct = (t: string) => `application/vnd.openxmlformats-officedocument.${t}+xml`;
  pkg.defaultType('png', 'image/png');
  pkg.relate('', REL.officeDocument, 'ppt/presentation.xml');
  const P = 'ppt/presentation.xml';
  const mRel = pkg.relate(P, REL.slideMaster, 'slideMasters/slideMaster1.xml');
  const sRel = pkg.relate(P, REL.slide, 'slides/slide1.xml');
  pkg.add(P, `${H}<p:presentation ${X}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${mRel}"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="${sRel}"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`, ct('presentationml.presentation.main'));
  pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.theme, '../theme/theme1.xml');
  pkg.add('ppt/theme/theme1.xml', `${H}<a:theme xmlns:a="${NS.a}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`, ct('theme'));
  const lRel = pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  pkg.add('ppt/slideMasters/slideMaster1.xml', `${H}<p:sldMaster ${X}><p:cSld><p:spTree>${GRP}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xf(36, 144, 648, 343)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="${lRel}"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`, ct('presentationml.slideMaster'));
  pkg.relate('ppt/slideLayouts/slideLayout1.xml', REL.slideMaster, '../slideMasters/slideMaster1.xml');
  pkg.add('ppt/slideLayouts/slideLayout1.xml', `${H}<p:sldLayout ${X} type="twoObj"><p:cSld name="Two Content"><p:spTree>${GRP}${layoutTree}</p:spTree></p:cSld></p:sldLayout>`, ct('presentationml.slideLayout'));
  const S = 'ppt/slides/slide1.xml';
  pkg.relate(S, REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  const img = pkg.relate(S, REL.image, '../media/image1.png');
  pkg.add('ppt/media/image1.png', PNG);
  pkg.add(S, `${H}<p:sld ${X}><p:cSld><p:spTree>${GRP}${slideTree.replace(/IMG/g, img)}</p:spTree></p:cSld></p:sld>`, ct('presentationml.slide'));
  return pkg.build();
}

const text = (runs: { text: string }[]) => runs.map((r) => r.text).join('');

describe('PowerPoint placeholders (F124)', () => {
  it('places the right-hand content placeholder of Two Content where the layout\'s idx 2 is', () => {
    // Two Content: two type-less content placeholders, idx 1 on the left and idx 2 on the right
    const layout = ph(2, 1, xf(36, 126, 318, 360)) + ph(3, 2, xf(366, 126, 318, 360));
    const slide = ph(2, 1, '', '<a:p><a:r><a:t>Left</a:t></a:r></a:p>') + ph(3, 2, '', '<a:p><a:r><a:t>Right</a:t></a:r></a:p>');
    const caps = readPptx(file(layout, slide)).slides[0].contents.captions;
    const at = (s: string) => caps.find((c) => text(c.runs) === s);
    // (the text inside its box: bodyPr lIns, 91440 EMU = 7.2 pt when not given, 21.1.2.1.1)
    expect(at('Left')?.x).toBeCloseTo(36 + 7.2, 1);
    expect(at('Right')?.x).toBeCloseTo(366 + 7.2, 1);
  });
});

describe('PowerPoint flips (F125, F586)', () => {
  const FLIP = 'Some flipped shapes and pictures came in unflipped.';

  it('reads flipH="true" as flipped, as it does flipH="1"', () => {
    const line = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Arrow 5"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xf(300, 300, 100, 0, ' flipH="true"')}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`;
    const arrow = readPptx(file('', line)).slides[0].contents.arrows[0];
    // flipped: drawn from right to left, the head at its end
    expect(arrow.tail).toEqual({ x: 400, y: 300 });
    expect(arrow.head).toEqual({ x: 300, y: 300 });
  });

  it('says so when a flipped arrow shape or picture comes in unflipped', () => {
    const arrow = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Right Arrow 3"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(100, 100, 120, 60, ' flipH="1"')}<a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr></p:sp>`;
    expect(readPptx(file('', arrow)).warnings).toContain(FLIP);
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture 4"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="IMG"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xf(100, 100, 80, 60, ' flipV="1"')}</p:spPr></p:pic>`;
    expect(readPptx(file('', pic)).warnings).toContain(FLIP);
    // a flipped rectangle looks the same: nothing to say
    const rect = arrow.replace('rightArrow', 'rect');
    expect(readPptx(file('', rect)).warnings).not.toContain(FLIP);
  });
});

describe('PowerPoint shadows (F588)', () => {
  it('reads a shadow with no distance as one right under the shape', () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Hexagon 3"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(100, 100, 120, 60)}<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>` +
      '<a:effectLst><a:outerShdw blurRad="63500" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr></p:sp>';
    const sh = readPptx(file('', sp)).slides[0].contents.shapes.find((s) => s.shadow);
    expect(sh?.shadowSize).toBe(0);
    // blurRad 63500 EMU = 5 pt (12700 EMU to the point)
    expect(sh?.shadowBlur).toBe(5);
  });
});

describe('PowerPoint lists (F127)', () => {
  it('numbers a third-level item i., ii. from 1, not from the letter i (9)', () => {
    const c = { id: 1, x: 0, y: 0, runs: [{ text: 'one\ndeep\ndeeper' }], paras: [{ list: 'number' as const }, { list: 'number' as const, level: 2 }, { list: 'number' as const, level: 2 }] } as never;
    const out = paragraphsXml(c, null, 18, (s: string) => s.length * 6);
    const nums = [...out.matchAll(/<a:buAutoNum type="(\w+)"(?: startAt="(\d+)")?\/>/g)].map((m) => [m[1], m[2] ?? '1']);
    expect(nums[1]).toEqual(['romanLcPeriod', '1']);
    expect(nums[2]).toEqual(['romanLcPeriod', '2']);
  });
});

describe('PowerPoint slide links and canvas slides (F126, F590)', () => {
  async function canvasDeck() {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setLayout('blank');
    d.addCanvasSlide();
    d.setCanvas({ keys: [{ id: 1, x: 0, y: 0, zoom: 1 }, { id: 2, x: 960, y: 0, zoom: 1 }, { id: 3, x: 1920, y: 0, zoom: 1 }] });
    d.addSlide('blank');
    d.addSlide('blank');
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: s.id, layout: s.layout, doc: d.docOf(i), notes: s.notes, canvas: s.canvas, anims: s.anims })) }, opts);
    return { d, files: unzipSync(bytes) };
  }
  const rezip = (files: Record<string, Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(v)])));

  it('points a link PowerPoint made to the slide it names once the canvas\'s slides are one', async () => {
    const { d, files } = await canvasDeck();
    // the file: slide 1, the canvas as slides 2 to 4, then slides 5 and 6
    expect(Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length).toBe(6);
    // a text box on slide 1 linked, as PowerPoint links one, to the last slide (slide6.xml)
    const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
    const rels = strFromU8(files[relsPath]);
    files[relsPath] = u8(rels.replace('</Relationships>', `<Relationship Id="rIdJump" Type="${REL.slide}" Target="slide6.xml"/></Relationships>`));
    const box = `<p:sp><p:nvSpPr><p:cNvPr id="90" name="TextBox 89"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xf(100, 100, 200, 40)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rIdJump" action="ppaction://hlinksldjump"/></a:rPr><a:t>Go to the end</a:t></a:r></a:p></p:txBody></p:sp>';
    const s1 = strFromU8(files['ppt/slides/slide1.xml']);
    const at = s1.lastIndexOf('</p:spTree>');
    files['ppt/slides/slide1.xml'] = u8(s1.slice(0, at) + box + s1.slice(at));
    const back = readPptx(rezip(files));
    expect(back.slides).toHaveLength(d.slides.length);
    const cap = back.slides[0].contents.captions.find((c) => text(c.runs).includes('Go to the end'));
    const link = cap?.runs.find((r) => r.link)?.link;
    // the deck's fourth slide (place 3), not the file's sixth (5)
    expect(link).toBe('#slide-n=3');
  });

  it('keeps the comments on every keyframe slide of a canvas', async () => {
    const { files } = await canvasDeck();
    // a comment on the canvas's second keyframe slide (slide3.xml), as PowerPoint keeps one:
    // a comments part related to the slide, with its author in commentAuthors.xml
    const C = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
    const A = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors';
    const relsPath = 'ppt/slides/_rels/slide3.xml.rels';
    files[relsPath] = u8(strFromU8(files[relsPath]).replace('</Relationships>', `<Relationship Id="rIdCm" Type="${C}" Target="../comments/comment1.xml"/></Relationships>`));
    files['ppt/comments/comment1.xml'] = u8(`${H}<p:cmLst ${X}><p:cm authorId="0" dt="2026-11-20T10:00:00.000" idx="1"><p:pos x="10" y="10"/><p:text>Check this step</p:text></p:cm></p:cmLst>`);
    files['ppt/commentAuthors.xml'] = u8(`${H}<p:cmAuthorLst ${X}><p:cmAuthor id="0" name="A. Reviewer" initials="AR" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`);
    const pRels = 'ppt/_rels/presentation.xml.rels';
    files[pRels] = u8(strFromU8(files[pRels]).replace('</Relationships>', `<Relationship Id="rIdAu" Type="${A}" Target="commentAuthors.xml"/></Relationships>`));
    const back = readPptx(rezip(files));
    expect(JSON.stringify(back.slides[1].comments ?? [])).toContain('Check this step');
  });
});

describe('PowerPoint Summary Zoom (F591)', () => {
  it('keeps every part when one part\'s picture can\'t go in the zoom frame', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setLayout('blank');
    for (let i = 1; i < 5; i++) d.addSlide('blank');
    const ids = d.slides.map((s) => s.id);
    const parts = [{ first: ids[1], last: ids[2] }, { first: ids[3], last: ids[4] }];
    const svg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    d.insertSummary(1, (sd) => {
      parts.forEach((p, k) => sd.addShape({ kind: 'picture', x1: 100 + 300 * k, y1: 200, x2: 340 + 300 * k, y2: 335, src: k ? svg : DOT, px: { w: 1, h: 1 }, link: `#slide=${p.first}`, zoom: { back: true, summary: true, to: `#slide=${p.last}` } }));
    }, parts.map((p) => p.first), ['Synthesis', '']);
    const bytes = await writePptx({ size: d.size, master: d.master, sections: d.sectionCounts(), slides: d.slides.map((s, i) => ({ id: s.id, layout: s.layout, doc: d.docOf(i), notes: s.notes })) }, opts);
    const back = readPptx(bytes);
    // both parts on the slide, each still taking the show to its section (the SVG one as a linked
    // picture: a Slide Zoom's still can't be SVG either)
    const linked = back.slides[1].contents.shapes.filter((s) => s.kind === 'picture' && s.link);
    expect(linked).toHaveLength(2);
  });
});
