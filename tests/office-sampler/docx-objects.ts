/**
 * Word sampler: pictures, shapes, text boxes, groups, equations, charts, SmartArt and embedded
 * objects, including ChemDraw objects (W-PIC, W-WRP, W-SHP, W-GRP, W-EQN, W-CHT, W-SMA, W-OLE).
 * ECMA-376 Part 1 §20.4 (DrawingML in Word: inline and anchor), §20.1 (DrawingML), §22.1 (math),
 * §21.2 (charts), §21.4 (diagrams), §17.3.3.19 (object); Word's Insert tab and Picture Format.
 *
 * Every drawing's name (wp:docPr) holds its item's id, and so does the paragraph it is in.
 *
 * Tags from src/io/docx-read.ts drawing (:2526), floatOf (:1379), shapeGeo (:2517), wordGroup
 * (:2621), embedded (:2771) and picture-xml.ts readPictureFx: inline and anchored pictures, the
 * wraps square, top-and-bottom, none (behind or in front), position offsets and alignment, distances,
 * z-order, name, description, hidden, rotation and flips, crop and the picture adjustments are read;
 * tight and through wraps become square; a wps text box is read, its VML fallback is not written;
 * shapes are read only for the geometries in src/design/geo.ts GEOS; groups of pictures are
 * regrouped; equations go through LaTeX (ommlToTex, toOmml); charts are rebuilt from their cached
 * values (office-chart.ts:97); SmartArt is dropped; an embedded object with a picture keeps its
 * bytes, and a ChemDraw object (ProgID ChemDraw.Document.6.0) keeps its CFB unless converted.
 */
import { type Item, type Sampler, type View, itemList, at, kid, up, NS, REL, CT, XML_HEAD, Pkg, png, xmlns, esc } from './kit';
import { wordFile, para, run, paraOf, val, type WordCtx } from './word';
import { chemdrawObject } from '../../src/io/ole-object';
import { cdxmlToCdx } from '../../src/io/cdx';
import { cfbStreams } from '../../src/io/cfb';

const items: Item[] = [];
const picI = itemList('W-PIC', items);
const wrpI = itemList('W-WRP', items);
const shpI = itemList('W-SHP', items);
const grpI = itemList('W-GRP', items);
const eqnI = itemList('W-EQN', items);
const chtI = itemList('W-CHT', items);
const smaI = itemList('W-SMA', items);
const oleI = itemList('W-OLE', items);
type T = 'supported' | 'kept' | 'loss';
/** Body parts, made when the file is built (they need relationship ids). */
const body: ((w: WordCtx) => string)[] = [];
const EMU = 12700;
let docPrId = 100;

/** The drawing (wp:inline or wp:anchor) whose docPr name holds `id`, else the one in the paragraph holding `id`. */
function drawingOf(v: View, id: string): Element | undefined {
  const d = v.all(/^word\/document\.xml$/, 'wp:docPr').find((e) => (at(e, 'name') ?? '').includes(id) || (at(e, 'descr') ?? '').includes(id));
  if (d?.parentElement) return d.parentElement;
  const p = paraOf(v, id);
  return p ? Array.from(p.getElementsByTagNameNS(NS.wp, '*')).find((e) => e.localName === 'inline' || e.localName === 'anchor') : undefined;
}
/** The pic:pic (or first graphic element) inside a drawing. */
const picOf = (d: Element | undefined) => d?.getElementsByTagNameNS(NS.pic, 'pic')[0];

const picGraphic = (rid: string, name: string, cx: number, cy: number, o: { srcRect?: string; xfrm?: string; blipFx?: string; spPr?: string } = {}) =>
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${esc(name)}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
  + `<pic:blipFill><a:blip r:embed="${rid}">${o.blipFx ?? ''}</a:blip>${o.srcRect ?? ''}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
  + `<pic:spPr><a:xfrm${o.xfrm ?? ''}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${o.spPr ?? ''}</pic:spPr></pic:pic></a:graphicData></a:graphic>`;
const docPr = (name: string, descr = '', extra = '') => `<wp:docPr id="${++docPrId}" name="${esc(name)}"${descr ? ` descr="${esc(descr)}"` : ''}${extra}/>`;
const inline = (name: string, graphic: string, cx: number, cy: number, descr = '', extra = '') =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr(name, descr, extra)}<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic}</wp:inline></w:drawing></w:r>`;
interface AnchorOpts { wrap: string; behind?: boolean; posH?: string; posV?: string; dist?: number; z?: number; overlap?: boolean }
const anchor = (name: string, graphic: string, cx: number, cy: number, o: AnchorOpts) =>
  `<w:r><w:drawing><wp:anchor distT="${o.dist ?? 0}" distB="${o.dist ?? 0}" distL="${o.dist ?? 114300}" distR="${o.dist ?? 114300}" simplePos="0" relativeHeight="${o.z ?? 251659264}" behindDoc="${o.behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="${o.overlap === false ? 0 : 1}">`
  + `<wp:simplePos x="0" y="0"/>${o.posH ?? '<wp:positionH relativeFrom="column"><wp:posOffset>3200400</wp:posOffset></wp:positionH>'}${o.posV ?? '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'}`
  + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${o.wrap}${docPr(name)}<wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing></w:r>`;
const LOREM = 'Text flows around the picture so its wrapping can be seen. '.repeat(6);
const PIC = png(96, 64);
let media = 0;
const addPic = (w: WordCtx, bytes = PIC) => w.media(`image${++media}.png`, bytes);

// ---------------------------------------------------------------------------------------------
// Pictures

const pItem = (feature: string, tag: T, spec: string, make: (w: WordCtx, id: string) => string, check: (d: Element | undefined, v: View, id: string) => boolean, basis?: string) => {
  const id = picI(feature, tag, spec, (v) => check(drawingOf(v, id), v, id), basis);
  body.push((w) => para(run(`${id} ${feature}: `) + make(w, id)));
};
const W = 96 * 9525, H = 64 * 9525;
pItem('Inline picture', 'supported', '§20.4.2.8 inline; Insert ▸ Pictures', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H), W, H), (d) => d?.localName === 'inline' && !!picOf(d));
pItem('Picture size 2 × 1 in', 'supported', '§20.4.2.7 extent', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, 1828800, 914400), 1828800, 914400), (d) => at(kid(d, 'wp:extent'), 'cx') === '1828800' && at(kid(d, 'wp:extent'), 'cy') === '914400');
pItem('Picture name (Selection Pane)', 'supported', '§20.4.2.5 docPr@name; Home ▸ Select ▸ Selection Pane', (w, id) => inline(`${id} named picture`, picGraphic(addPic(w), id, W, H), W, H), (d, _v, id) => at(kid(d, 'wp:docPr'), 'name') === `${id} named picture`, 'docx-read.ts drawing (docPr name read)');
pItem('Alt text description', 'supported', '§20.4.2.5 docPr@descr; Picture Format ▸ Alt Text', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H), W, H, `${id} sampler alt text`), (d, _v, id) => at(kid(d, 'wp:docPr'), 'descr') === `${id} sampler alt text`);
pItem('Hidden picture', 'supported', '§20.4.2.5 docPr@hidden; Selection Pane ▸ hide', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H), W, H, '', ' hidden="1"'), (d) => ['1', 'true'].includes(at(kid(d, 'wp:docPr'), 'hidden') ?? ''));
pItem('Cropped picture', 'supported', '§20.1.8.55 srcRect; Picture Format ▸ Crop', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W / 2, H / 2, { srcRect: '<a:srcRect l="25000" t="25000" r="25000" b="25000"/>' }), W / 2, H / 2),
  (d) => { const s = picOf(d)?.getElementsByTagNameNS(NS.a, 'srcRect')[0]; return at(s, 'l') === '25000' && at(s, 'b') === '25000'; });
pItem('Picture rotated 30°', 'supported', '§20.1.7.6 xfrm@rot; Picture Format ▸ Rotate', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { xfrm: ' rot="1800000"' }), W, H), (d) => at(picOf(d)?.getElementsByTagNameNS(NS.a, 'xfrm')[0], 'rot') === '1800000');
pItem('Picture flipped horizontally', 'supported', '§20.1.7.6 xfrm@flipH; Rotate ▸ Flip Horizontal', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { xfrm: ' flipH="1"' }), W, H), (d) => ['1', 'true'].includes(at(picOf(d)?.getElementsByTagNameNS(NS.a, 'xfrm')[0], 'flipH') ?? ''));
pItem('Picture flipped vertically', 'supported', '§20.1.7.6 xfrm@flipV', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { xfrm: ' flipV="1"' }), W, H), (d) => ['1', 'true'].includes(at(picOf(d)?.getElementsByTagNameNS(NS.a, 'xfrm')[0], 'flipV') ?? ''));
pItem('Brightness +20%, contrast +40%', 'supported', '§20.1.8.42 lum; Picture Format ▸ Corrections', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { blipFx: '<a:lum bright="20000" contrast="40000"/>' }), W, H), (d) => { const l = picOf(d)?.getElementsByTagNameNS(NS.a, 'lum')[0]; return at(l, 'bright') === '20000' && at(l, 'contrast') === '40000'; }, 'picture-xml.ts readPictureFx');
pItem('Grayscale', 'supported', '§20.1.8.34 grayscl; Picture Format ▸ Color ▸ Grayscale', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { blipFx: '<a:grayscl/>' }), W, H), (d) => (picOf(d)?.getElementsByTagNameNS(NS.a, 'grayscl').length ?? 0) > 0, 'picture-xml.ts readPictureFx');
pItem('Recolor duotone', 'supported', '§20.1.8.23 duotone; Color ▸ Recolor', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { blipFx: '<a:duotone><a:srgbClr val="1B7F79"/><a:srgbClr val="FFFFFF"/></a:duotone>' }), W, H), (d) => (picOf(d)?.getElementsByTagNameNS(NS.a, 'duotone').length ?? 0) > 0, 'picture-xml.ts readPictureFx');
pItem('Transparency 50%', 'supported', '§20.1.8.4 alphaModFix; Picture Format ▸ Transparency', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { blipFx: '<a:alphaModFix amt="50000"/>' }), W, H), (d) => at(picOf(d)?.getElementsByTagNameNS(NS.a, 'alphaModFix')[0], 'amt') === '50000', 'picture-xml.ts readPictureFx');
pItem('Picture border 3 pt', 'supported', '§20.1.2.2.24 ln; Picture Format ▸ Picture Border', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { spPr: '<a:ln w="38100"><a:solidFill><a:srgbClr val="C8553D"/></a:solidFill></a:ln>' }), W, H), (d) => at(picOf(d)?.getElementsByTagNameNS(NS.a, 'ln')[0], 'w') === '38100', 'docx-read.ts readLook');
pItem('Picture shadow', 'supported', '§20.1.8.49 outerShdw; Picture Effects ▸ Shadow', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { spPr: '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>' }), W, H), (d) => (picOf(d)?.getElementsByTagNameNS(NS.a, 'outerShdw').length ?? 0) > 0, 'docx-read.ts readLook');
pItem('Artistic effect (blur)', 'loss', 'Word 2010 a14:imgEffect artisticBlur; Picture Format ▸ Artistic Effects', (w, id) => { const rid = addPic(w); return inline(`${id} picture`, picGraphic(rid, id, W, H, { blipFx: `<a:extLst><a:ext uri="{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}"><a14:imgProps xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a14:imgLayer r:embed="${rid}"><a14:imgEffect><a14:artisticBlur radius="20"/></a14:imgEffect></a14:imgLayer></a14:imgProps></a:ext></a:extLst>` }), W, H); },
  (d) => (picOf(d)?.getElementsByTagNameNS(NS.a14, 'artisticBlur').length ?? 0) > 0, 'docx-read.ts WARN picture effects');
pItem('Picture with a soft edge', 'loss', '§20.1.8.53 softEdge; Picture Effects ▸ Soft Edges', (w, id) => inline(`${id} picture`, picGraphic(addPic(w), id, W, H, { spPr: '<a:effectLst><a:softEdge rad="63500"/></a:effectLst>' }), W, H), (d) => (picOf(d)?.getElementsByTagNameNS(NS.a, 'softEdge').length ?? 0) > 0, 'docx-read.ts readLook (soft edge not read)');

// ---------------------------------------------------------------------------------------------
// Floating pictures and wrapping

const poly = '<wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="21600" y="0"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon>';
const fItem = (feature: string, tag: T, spec: string, o: AnchorOpts, check: (d: Element | undefined) => boolean, basis?: string) => {
  const id = wrpI(feature, tag, spec, (v) => check(drawingOf(v, id)), basis);
  body.push((w) => para(anchor(`${id} floating picture`, picGraphic(addPic(w), id, W, H), W, H, o) + run(`${id} ${feature}. ${LOREM}`)));
};
fItem('Wrap square', 'supported', '§20.4.2.17 wrapSquare; Wrap Text ▸ Square', { wrap: '<wp:wrapSquare wrapText="bothSides"/>' }, (d) => d?.localName === 'anchor' && !!kid(d, 'wp:wrapSquare'));
fItem('Wrap square, text on the left only', 'supported', '§20.4.2.17 wrapSquare@wrapText left', { wrap: '<wp:wrapSquare wrapText="left"/>' }, (d) => at(kid(d, 'wp:wrapSquare'), 'wrapText') === 'left');
fItem('Wrap tight', 'loss', '§20.4.2.18 wrapTight; Wrap Text ▸ Tight', { wrap: `<wp:wrapTight wrapText="bothSides">${poly}</wp:wrapTight>` }, (d) => !!kid(d, 'wp:wrapTight'), 'docx-read.ts floatOf (tight becomes square)');
fItem('Wrap through', 'loss', '§20.4.2.19 wrapThrough; Wrap Text ▸ Through', { wrap: `<wp:wrapThrough wrapText="bothSides">${poly}</wp:wrapThrough>` }, (d) => !!kid(d, 'wp:wrapThrough'), 'docx-read.ts floatOf');
fItem('Wrap top and bottom', 'supported', '§20.4.2.20 wrapTopAndBottom; Wrap Text ▸ Top and Bottom', { wrap: '<wp:wrapTopAndBottom/>' }, (d) => !!kid(d, 'wp:wrapTopAndBottom'));
fItem('Behind text', 'supported', '§20.4.2.15 wrapNone, anchor@behindDoc; Wrap Text ▸ Behind Text', { wrap: '<wp:wrapNone/>', behind: true }, (d) => !!kid(d, 'wp:wrapNone') && ['1', 'true'].includes(at(d, 'behindDoc') ?? ''));
fItem('In front of text', 'supported', '§20.4.2.15 wrapNone; Wrap Text ▸ In Front of Text', { wrap: '<wp:wrapNone/>' }, (d) => !!kid(d, 'wp:wrapNone') && ['0', 'false'].includes(at(d, 'behindDoc') ?? ''));
fItem('Position centered on the margins', 'supported', '§20.4.2.10 positionH align; Position ▸ More Layout Options', { wrap: '<wp:wrapTopAndBottom/>', posH: '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>' }, (d) => kid(kid(d, 'wp:positionH'), 'wp:align')?.textContent === 'center');
fItem('Position 1 in from the page top', 'supported', '§20.4.2.11 positionV posOffset relativeFrom page', { wrap: '<wp:wrapSquare wrapText="bothSides"/>', posV: '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' }, (d) => at(kid(d, 'wp:positionV'), 'relativeFrom') === 'page' && kid(kid(d, 'wp:positionV'), 'wp:posOffset')?.textContent === '914400');
fItem('Position relative to the right margin', 'loss', '§20.4.2.10 positionH relativeFrom rightMargin', { wrap: '<wp:wrapSquare wrapText="bothSides"/>', posH: '<wp:positionH relativeFrom="rightMargin"><wp:align>left</wp:align></wp:positionH>' }, (d) => at(kid(d, 'wp:positionH'), 'relativeFrom') === 'rightMargin', 'docx-read.ts floatOf (relativeFrom set simplified)');
fItem('Distance from text 0.2 in', 'supported', '§20.4.2.3 anchor@distT/distB/distL/distR', { wrap: '<wp:wrapSquare wrapText="bothSides"/>', dist: 182880 }, (d) => at(d, 'distL') === '182880' && at(d, 'distT') === '182880');
fItem('Z-order (relativeHeight)', 'supported', '§20.4.2.3 anchor@relativeHeight; Bring Forward', { wrap: '<wp:wrapSquare wrapText="bothSides"/>', z: 251670000 }, (d) => Number(at(d, 'relativeHeight')) > 0);
fItem('Do not allow overlap', 'loss', '§20.4.2.3 anchor@allowOverlap', { wrap: '<wp:wrapSquare wrapText="bothSides"/>', overlap: false }, (d) => ['0', 'false'].includes(at(d, 'allowOverlap') ?? ''), 'docx-read.ts floatOf (allowOverlap not read)');

// ---------------------------------------------------------------------------------------------
// Shapes and text boxes (wps, with a VML fallback as Word writes them)

const LN = '<a:ln w="12700"><a:solidFill><a:srgbClr val="1F3A4D"/></a:solidFill></a:ln>';
const shape = (name: string, cx: number, cy: number, geom: string, fill: string, text: string, fallback: string, anchorOpts?: AnchorOpts, ln = LN) => {
  const wsp = `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr${text ? ' txBox="1"' : ''}/>`
    + `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>${geom}${fill}${ln}</wps:spPr>`
    + (text ? `<wps:txbx><w:txbxContent>${para(run(text))}</w:txbxContent></wps:txbx>` : '')
    + '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>';
  const drawing = anchorOpts ? anchor(name, wsp, cx, cy, anchorOpts) : inline(name, wsp, cx, cy);
  const inner = drawing.slice('<w:r>'.length, -'</w:r>'.length);
  return `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${inner}</mc:Choice><mc:Fallback><w:pict>${fallback}</w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
};
const prst = (p: string) => `<a:prstGeom prst="${p}"><a:avLst/></a:prstGeom>`;
const solid = (c: string) => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`;
const vmlBox = (text: string) => `<v:rect style="width:144pt;height:72pt" fillcolor="#EEF2E6" strokecolor="#1F3A4D">${text ? `<v:textbox><w:txbxContent>${para(run(text))}</w:txbxContent></v:textbox>` : ''}</v:rect>`;
/** The wps:wsp drawn for `id` (by its drawing's name). */
const wspOf = (v: View, id: string) => drawingOf(v, id)?.getElementsByTagNameNS(NS.wps, 'wsp')[0];
const prstOf = (v: View, id: string) => at(wspOf(v, id)?.getElementsByTagNameNS(NS.a, 'prstGeom')[0], 'prst');
const sItem = (feature: string, tag: T, spec: string, make: (id: string) => string, check: (v: View, id: string) => boolean, basis?: string) => {
  const id = shpI(feature, tag, spec, (v) => check(v, id), basis);
  body.push(() => para(run(`${id} ${feature}: `) + make(id)));
};
const C = 1828800, R = 914400;
sItem('Text box', 'supported', '§20.4 wps:txbx; Insert ▸ Text Box', (id) => shape(`${id} text box`, C, R, prst('rect'), solid('EEF2E6'), `${id} text inside the box`, vmlBox(`${id} text inside the box`)),
  (v, id) => (wspOf(v, id)?.getElementsByTagNameNS(NS.w, 'txbxContent')[0]?.textContent ?? '').includes(`${id} text inside the box`), 'docx-read.ts (textbox object)');
sItem('Floating text box with square wrap', 'supported', '§20.4.2.3 anchor with wps:txbx', (id) => shape(`${id} floating text box`, C, R, prst('rect'), solid('F2A541'), `${id} floating box`, vmlBox(`${id} floating box`), { wrap: '<wp:wrapSquare wrapText="bothSides"/>' }) + run(LOREM),
  (v, id) => drawingOf(v, id)?.localName === 'anchor' && !!wspOf(v, id));
sItem('Text box VML fallback for older Word', 'loss', 'MCE mc:Fallback with v:textbox (ECMA-376 Part 3)', (id) => shape(`${id} text box with fallback`, C, R, prst('rect'), solid('EEF2E6'), `${id} fallback text`, vmlBox(`${id} fallback text`)),
  (v, id) => v.all(/^word\/document\.xml$/, 'v:textbox').some((t) => (t.textContent ?? '').includes(`${id} fallback text`)), 'docx-write.ts:1328 (empty mc:Fallback)');
sItem('Shape in line with text', 'supported', '§20.4.2.8 inline with wps:wsp; Wrap Text ▸ In Line with Text', (id) => shape(`${id} inline shape`, R, R, prst('ellipse'), solid('1B7F79'), '', '<v:oval style="width:72pt;height:72pt"/>'), (v, id) => drawingOf(v, id)?.localName === 'inline');
for (const [p, color] of [['rect', '1B7F79'], ['ellipse', 'C8553D'], ['roundRect', '6A4C93'], ['triangle', 'F2A541'], ['star5', '3A86FF'], ['rightArrow', '8AB17D'], ['hexagon', '1F3A4D'], ['flowChartDecision', 'C8553D'], ['can', '6A4C93'], ['cloud', '3A86FF']] as const) {
  sItem(`Shape ${p}`, 'supported', `§20.1.9.18 prstGeom ${p}; Insert ▸ Shapes`, (id) => shape(`${id} ${p}`, R, R, prst(p), solid(color), '', `<v:oval style="width:72pt;height:72pt" fillcolor="#${color}"/>`), (v, id) => prstOf(v, id) === p, 'src/design/geo.ts GEOS');
}
for (const p of ['sun', 'moon', 'lightningBolt', 'wave']) {
  sItem(`Shape ${p} (not in Chemweave's library)`, 'loss', `§20.1.9.18 prstGeom ${p}`, (id) => shape(`${id} ${p}`, R, R, prst(p), solid('F2A541'), '', '<v:oval style="width:72pt;height:72pt" fillcolor="#F2A541"/>'), (v, id) => prstOf(v, id) === p, 'docx-read.ts shapeGeo (GEOS only)');
}
sItem('Shape with adjusted corner (roundRect adj)', 'loss', '§20.1.9.5 avLst gd', (id) => shape(`${id} rounded more`, C, R, '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst></a:prstGeom>', solid('8AB17D'), '', '<v:roundrect style="width:144pt;height:72pt" arcsize="0.4"/>'),
  (v, id) => at(wspOf(v, id)?.getElementsByTagNameNS(NS.a, 'gd')[0], 'fmla') === 'val 40000', 'docx-read.ts shapeGeo (adjust values)');
sItem('Freeform shape (custom geometry)', 'loss', '§20.1.9.8 custGeom; Shapes ▸ Freeform', (id) => shape(`${id} freeform`, R, R, '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="50" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:cubicBezTo><a:pt x="70" y="60"/><a:pt x="30" y="60"/><a:pt x="0" y="100"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>', solid('C8553D'), '', '<v:oval style="width:72pt;height:72pt"/>'),
  (v, id) => (wspOf(v, id)?.getElementsByTagNameNS(NS.a, 'custGeom').length ?? 0) > 0, 'docx-read.ts shapeGeo');
sItem('Line with an arrowhead', 'loss', '§20.1.9.18 prstGeom line, §20.1.8.38 tailEnd', (id) => shape(`${id} arrow line`, C, 0, prst('line'), '', '', '<v:line from="0,0" to="144pt,0"/>', undefined, '<a:ln w="19050"><a:solidFill><a:srgbClr val="1F3A4D"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>'),
  (v, id) => prstOf(v, id) === 'line', 'docx-read.ts (other wps shapes warn "shapes")');
sItem('Shape with gradient fill', 'supported', '§20.1.8.33 gradFill', (id) => shape(`${id} gradient`, C, R, prst('rect'), '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="1B7F79"/></a:gs><a:gs pos="100000"><a:srgbClr val="EEF2E6"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>', '', '<v:rect style="width:144pt;height:72pt"/>'),
  (v, id) => (wspOf(v, id)?.getElementsByTagNameNS(NS.a, 'gradFill').length ?? 0) > 0);
sItem('VML-only text box (no DrawingML)', 'loss', 'VML v:textbox (ECMA-376 Part 4 §14.1)', (id) => `<w:r><w:pict>${vmlBox(`${id} VML only`)}</w:pict></w:r>`,
  (v, id) => v.all(/^word\/document\.xml$/, 'v:textbox').some((t) => (t.textContent ?? '').includes(`${id} VML only`)) || v.all(/^word\/document\.xml$/, 'w:txbxContent').some((t) => (t.textContent ?? '').includes(`${id} VML only`)), 'docx-read.ts (VML-only shapes warn "shapes")');

// ---------------------------------------------------------------------------------------------
// Groups

const group = (name: string, kids: string, cx: number, cy: number) => {
  const g = `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${cx}" cy="${cy}"/></a:xfrm></wpg:grpSpPr>${kids}</wpg:wgp></a:graphicData></a:graphic>`;
  const inner = anchor(name, g, cx, cy, { wrap: '<wp:wrapSquare wrapText="bothSides"/>' }).slice('<w:r>'.length, -'</w:r>'.length);
  return `<w:r><mc:AlternateContent><mc:Choice Requires="wpg">${inner}</mc:Choice><mc:Fallback><w:pict><v:group style="width:${cx / EMU}pt;height:${cy / EMU}pt" coordsize="${cx},${cy}"><v:rect style="width:${cx};height:${cy}"/></v:group></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
};
const grpPic = (rid: string, name: string, x: number) => `<pic:pic><pic:nvPicPr><pic:cNvPr id="${++docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="${W}" cy="${H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;
const grpOf = (v: View, id: string) => drawingOf(v, id)?.getElementsByTagNameNS(NS.wpg, 'wgp')[0];
const g1 = grpI('Group of two pictures', 'supported', '§20.4 wpg:wgp; Picture Format ▸ Group', (v) => (grpOf(v, g1)?.getElementsByTagNameNS(NS.pic, 'pic').length ?? 0) === 2, 'docx-read.ts:2621 wordGroup');
body.push((w) => para(group(`${g1} group`, grpPic(addPic(w), 'left', 0) + grpPic(addPic(w, png(96, 64, [60, 60, 200])), 'right', W + 91440), 2 * W + 91440, H) + run(`${g1} Group of two pictures. ${LOREM}`)));
const g2 = grpI('Group of a picture and a shape', 'loss', '§20.4 wpg:wgp with wps:wsp', (v) => (grpOf(v, g2)?.getElementsByTagNameNS(NS.wps, 'wsp').length ?? 0) === 1, 'docx-read.ts:2621 (shapes inside groups warn)');
body.push((w) => para(group(`${g2} group`, grpPic(addPic(w), 'picture', 0) + `<wps:wsp><wps:cNvPr id="${++docPrId}" name="shape"/><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="${W + 91440}" y="0"/><a:ext cx="${R}" cy="${R}"/></a:xfrm>${prst('ellipse')}${solid('C8553D')}</wps:spPr><wps:bodyPr/></wps:wsp>`, W + 91440 + R, R) + run(`${g2} Group of a picture and a shape. ${LOREM}`)));

// ---------------------------------------------------------------------------------------------
// Equations (Office Math)

const mr = (t: string) => `<m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>${esc(t)}</m:t></m:r>`;
const eItem = (feature: string, tag: T, spec: string, math: string, el: string, display = false, basis = 'docx-read.ts ommlToTex, toOmml', more?: (e: Element) => boolean) => {
  const id = eqnI(feature, tag, spec, (v) => {
    const p = paraOf(v, id);
    const ms = Array.from(p?.getElementsByTagNameNS(NS.m, 'oMath') ?? []);
    return ms.some((m) => Array.from(m.getElementsByTagNameNS(NS.m, el)).some((e) => !more || more(e)));
  }, basis);
  body.push(() => display ? `<w:p>${run(`${id} ${feature}:`)}<m:oMathPara><m:oMath>${math}</m:oMath></m:oMathPara></w:p>` : para(run(`${id} ${feature}: `) + `<m:oMath>${math}</m:oMath>`));
};
eItem('Fraction', 'supported', '§22.1.2.36 f; Insert ▸ Equation ▸ Fraction', `<m:f><m:num>${mr('a+b')}</m:num><m:den>${mr('c')}</m:den></m:f>`, 'f');
eItem('Square root', 'supported', '§22.1.2.88 rad', `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mr('x')}</m:e></m:rad>`, 'rad');
eItem('Subscript and superscript', 'supported', '§22.1.2.106 sSubSup', `<m:sSubSup><m:e>${mr('x')}</m:e><m:sub>${mr('i')}</m:sub><m:sup>${mr('2')}</m:sup></m:sSubSup>`, 'sSubSup');
eItem('Summation with limits (display)', 'supported', '§22.1.2.70 nary', `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${mr('i=1')}</m:sub><m:sup>${mr('n')}</m:sup><m:e>${mr('i')}</m:e></m:nary>`, 'nary', true);
eItem('Integral', 'supported', '§22.1.2.70 nary ∫', `<m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:sub>${mr('0')}</m:sub><m:sup>${mr('1')}</m:sup><m:e>${mr('f(x)dx')}</m:e></m:nary>`, 'nary');
eItem('Matrix 2 × 2 in brackets', 'supported', '§22.1.2.60 m, §22.1.2.24 d', `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:m><m:mr><m:e>${mr('1')}</m:e><m:e>${mr('0')}</m:e></m:mr><m:mr><m:e>${mr('0')}</m:e><m:e>${mr('1')}</m:e></m:mr></m:m></m:e></m:d>`, 'm');
eItem('Accent (hat)', 'supported', '§22.1.2.1 acc', `<m:acc><m:accPr><m:chr m:val="̂"/></m:accPr><m:e>${mr('H')}</m:e></m:acc>`, 'acc');
eItem('Reaction arrow with text above', 'supported', '§22.1.2.40 groupChr', `${mr('A')}<m:groupChr><m:groupChrPr><m:chr m:val="→"/><m:pos m:val="top"/></m:groupChrPr><m:e>${mr('Δ')}</m:e></m:groupChr>${mr('B')}`, 'groupChr', false, undefined,
  (g) => at(g.getElementsByTagNameNS(NS.m, 'pos')[0], 'm:val') === 'top');

// ---------------------------------------------------------------------------------------------
// Charts (with an embedded workbook, as Word writes them)

/** A small workbook (for a chart's data, or an embedded object), built here. */
function miniXlsx(rows: (string | number)[][]): Uint8Array {
  const pkg = new Pkg();
  pkg.rel('', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'xl/workbook.xml');
  pkg.add('xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${NS.x}" xmlns:r="${NS.r}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`, CT.workbook);
  pkg.rel('xl/workbook.xml', REL.worksheet, 'worksheets/sheet1.xml');
  const col = (i: number) => String.fromCharCode(65 + i);
  const cell = (v: string | number, ref: string) => typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  pkg.add('xl/worksheets/sheet1.xml', `${XML_HEAD}<worksheet xmlns="${NS.x}"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, `${col(j)}${i + 1}`)).join('')}</row>`).join('')}</sheetData></worksheet>`, CT.worksheet);
  return pkg.build();
}
const CATS = ['Mon', 'Tue', 'Wed', 'Thu'];
const VALS = [[4.3, 2.5, 3.5, 4.5], [2.4, 4.4, 1.8, 2.8]];
const strRef = (f: string, vals: string[]) => `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
const numRef = (f: string, vals: number[]) => `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`;
const ser = (i: number, extra = '') => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx>${strRef(`Sheet1!$${'BC'[i]}$1`, [`Series ${i + 1}`])}</c:tx>${extra}<c:cat>${strRef('Sheet1!$A$2:$A$5', CATS)}</c:cat><c:val>${numRef(`Sheet1!$${'BC'[i]}$2:$${'BC'[i]}$5`, VALS[i])}</c:val></c:ser>`;
const axes = '<c:catAx><c:axId val="500"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="501"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>'
  + '<c:valAx><c:axId val="501"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="500"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
const chartXml = (title: string, plot: string) => `${XML_HEAD}<c:chartSpace ${xmlns('c', 'a', 'r')}><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>`
  + `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
  + `<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
let charts = 0;
/** The chart part whose title holds `id`. */
const chartOf = (v: View, id: string) => v.partsLike(/^word\/charts\/chart\d+\.xml$/).map((p) => v.doc(p)!).find((d) => (d.getElementsByTagNameNS(NS.c, 'title')[0]?.textContent ?? '').includes(id));
const cItem = (feature: string, tag: T, spec: string, plot: string, el: string, check?: (d: Document) => boolean, basis = 'office-chart.ts:97 readChart') => {
  const id = chtI(feature, tag, spec, (v) => { const d = chartOf(v, id); return !!d && d.getElementsByTagNameNS(NS.c, el).length > 0 && (!check || check(d)); }, basis);
  body.push((w) => {
    const n = ++charts;
    const rid = w.part(`charts/chart${n}.xml`, chartXml(`${id} ${feature}`, plot), CT.chart, REL.chart);
    w.pkg.add(`word/embeddings/Microsoft_Excel_Worksheet${n}.xlsx`, miniXlsx([['', 'Series 1', 'Series 2'], ...CATS.map((c, i) => [c, VALS[0][i], VALS[1][i]])]));
    w.relFrom(`charts/chart${n}.xml`, REL.package, `../embeddings/Microsoft_Excel_Worksheet${n}.xlsx`);
    const g = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart ${xmlns('c', 'r')} r:id="${rid}"/></a:graphicData></a:graphic>`;
    return para(run(`${id} ${feature}: `) + inline(`${id} chart`, g, 4572000, 2743200));
  });
};
cItem('Clustered column chart', 'supported', '§21.2.2.16 barChart; Insert ▸ Chart ▸ Column', `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser(0)}${ser(1)}<c:gapWidth val="150"/><c:axId val="500"/><c:axId val="501"/></c:barChart>${axes}`, 'barChart', (d) => d.getElementsByTagNameNS(NS.c, 'ser').length === 2);
cItem('Line chart with markers', 'supported', '§21.2.2.97 lineChart', `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser(0, '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>')}<c:marker val="1"/><c:axId val="500"/><c:axId val="501"/></c:lineChart>${axes}`, 'lineChart');
cItem('Pie chart', 'supported', '§21.2.2.141 pieChart', `<c:pieChart><c:varyColors val="1"/>${ser(0)}<c:firstSliceAng val="0"/></c:pieChart>`, 'pieChart');
cItem('Scatter chart', 'supported', '§21.2.2.161 scatterChart', `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:xVal>${numRef('Sheet1!$B$2:$B$5', VALS[0])}</c:xVal><c:yVal>${numRef('Sheet1!$C$2:$C$5', VALS[1])}</c:yVal><c:smooth val="0"/></c:ser><c:axId val="500"/><c:axId val="501"/></c:scatterChart>`
  + axes.replace('<c:catAx>', '<c:valAx>').replace(/<c:auto val="1"\/><c:lblAlgn val="ctr"\/><c:lblOffset val="100"\/><\/c:catAx>/, '<c:crossBetween val="midCat"/></c:valAx>'), 'scatterChart');
cItem('Combo chart: columns and a line', 'loss', '§21.2.2.16 barChart with §21.2.2.97 lineChart; Change Chart Type ▸ Combo', `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser(0)}<c:gapWidth val="150"/><c:axId val="500"/><c:axId val="501"/></c:barChart><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser(1)}<c:marker val="1"/><c:axId val="500"/><c:axId val="501"/></c:lineChart>${axes}`, 'lineChart', (d) => d.getElementsByTagNameNS(NS.c, 'barChart').length > 0, 'docx-read.ts WARN (combo charts collapse)');

// ---------------------------------------------------------------------------------------------
// SmartArt

const sma = smaI('SmartArt basic list of three items', 'loss', '§21.4 diagrams; Insert ▸ SmartArt', (v) => v.all(/^word\/document\.xml$/, 'dgm:relIds').length > 0, 'docx-read.ts (SmartArt warns "shapes" and is dropped)');
body.push((w) => {
  const L = 'urn:microsoft.com/office/officeart/2005/8/layout/default', Q = 'urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1', K = 'urn:microsoft.com/office/officeart/2005/8/colors/accent1_2';
  const ids = { doc: '{00000000-0000-0000-0000-000000000001}', n: [1, 2, 3].map((i) => `{00000000-0000-0000-0000-00000000001${i}}`), par: [1, 2, 3].map((i) => `{00000000-0000-0000-0000-00000000002${i}}`), sib: [1, 2, 3].map((i) => `{00000000-0000-0000-0000-00000000003${i}}`), cxn: [1, 2, 3].map((i) => `{00000000-0000-0000-0000-00000000004${i}}`) };
  const t = (s: string) => `<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(s)}</a:t></a:r></a:p></dgm:t>`;
  const data = `${XML_HEAD}<dgm:dataModel ${xmlns('dgm', 'a', 'r')}><dgm:ptLst><dgm:pt modelId="${ids.doc}" type="doc"><dgm:prSet loTypeId="${L}" loCatId="list" qsTypeId="${Q}" qsCatId="simple" csTypeId="${K}" csCatId="accent1"/><dgm:spPr/>${t('')}</dgm:pt>`
    + ids.n.map((m, i) => `<dgm:pt modelId="${m}"><dgm:prSet phldrT="[Text]"/><dgm:spPr/>${t(i === 0 ? `${sma} first` : ['', 'second', 'third'][i])}</dgm:pt>`
      + `<dgm:pt modelId="${ids.par[i]}" type="parTrans" cxnId="${ids.cxn[i]}"><dgm:prSet/><dgm:spPr/>${t('')}</dgm:pt><dgm:pt modelId="${ids.sib[i]}" type="sibTrans" cxnId="${ids.cxn[i]}"><dgm:prSet/><dgm:spPr/>${t('')}</dgm:pt>`).join('')
    + `</dgm:ptLst><dgm:cxnLst>${ids.n.map((m, i) => `<dgm:cxn modelId="${ids.cxn[i]}" srcId="${ids.doc}" destId="${m}" srcOrd="${i}" destOrd="0" parTransId="${ids.par[i]}" sibTransId="${ids.sib[i]}"/>`).join('')}</dgm:cxnLst><dgm:bg/><dgm:whole/></dgm:dataModel>`;
  const dm = w.part('diagrams/data1.xml', data, CT.dgmData, REL.diagramData);
  const lo = w.part('diagrams/layout1.xml', `${XML_HEAD}<dgm:layoutDef ${xmlns('dgm', 'a')} uniqueId="${L}"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="list" pri="400"/></dgm:catLst><dgm:layoutNode name="diagram"><dgm:alg type="snake"/><dgm:shape/><dgm:forEach name="Name0" axis="ch" ptType="node"><dgm:layoutNode name="node"><dgm:alg type="tx"/><dgm:shape type="rect"/><dgm:presOf axis="desOrSelf" ptType="node"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`, CT.dgmLayout, REL.diagramLayout);
  const qs = w.part('diagrams/quickStyle1.xml', `${XML_HEAD}<dgm:styleDef ${xmlns('dgm', 'a')} uniqueId="${Q}"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="simple" pri="10100"/></dgm:catLst><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:styleLbl name="node1"><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dgm:style></dgm:styleLbl></dgm:styleDef>`, CT.dgmStyle, REL.diagramQuickStyle);
  const cs = w.part('diagrams/colors1.xml', `${XML_HEAD}<dgm:colorsDef ${xmlns('dgm', 'a')} uniqueId="${K}"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="accent1" pri="11200"/></dgm:catLst><dgm:styleLbl name="node1"><dgm:fillClrLst meth="repeat"><a:schemeClr val="accent1"/></dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:linClrLst><dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:txFillClrLst><dgm:txEffectClrLst/></dgm:styleLbl></dgm:colorsDef>`, CT.dgmColors, REL.diagramColors);
  const g = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds ${xmlns('dgm', 'r')} r:dm="${dm}" r:lo="${lo}" r:qs="${qs}" r:cs="${cs}"/></a:graphicData></a:graphic>`;
  return para(run(`${sma} SmartArt: `) + inline(`${sma} SmartArt`, g, 4572000, 1828800));
});

// ---------------------------------------------------------------------------------------------
// Embedded objects, ChemDraw among them

/** A ChemDraw drawing written here: a six-membered ring of `n` carbons with alternating double bonds, and a label. */
function ringCdxml(cx: number, cy: number, label: string): string {
  const r = 14.4, pts = Array.from({ length: 6 }, (_, i) => [cx + r * Math.cos((Math.PI / 3) * i + Math.PI / 6), cy + r * Math.sin((Math.PI / 3) * i + Math.PI / 6)]);
  const nodes = pts.map(([x, y], i) => `<n id="${10 + i}" p="${x.toFixed(2)} ${y.toFixed(2)}" Z="${10 + i}"/>`).join('');
  const bonds = pts.map((_, i) => `<b id="${20 + i}" Z="${20 + i}" B="${10 + i}" E="${10 + ((i + 1) % 6)}"${i % 2 ? '' : ' Order="2"'}/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" ?><!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" ><CDXML BondLength="14.4"><page id="1" BoundingBox="0 0 540 720"><fragment id="2">${nodes}${bonds}</fragment>`
    + `<t id="3" p="${cx - 20} ${cy + 30}"><s font="3" size="10">${esc(label)}</s></t></page></CDXML>`;
}
const CDX1 = cdxmlToCdx(ringCdxml(100, 100, 'W-OLE ring'));
const CDX2 = cdxmlToCdx(ringCdxml(80, 60, 'W-OLE second'));
const CHEM1 = chemdrawObject(CDX1);
const CHEM2 = chemdrawObject(CDX2);
/** The ChemDraw drawing (CDX, the CONTENTS stream) inside an object's compound file. */
const cdxIn = (b: Uint8Array | undefined) => { if (!b) return undefined; try { return cfbStreams(b).get('CONTENTS'); } catch { return undefined; } };
const isChemDraw = (o: Element | undefined) => /^ChemDraw/i.test(at(o, 'ProgID') ?? '');
const XLSX_OBJ = miniXlsx([['Embedded', 'workbook'], [1, 2], [3, 4]]);
/** A VML style's width in points (pt, in, cm, mm or px at 96 per inch). */
const widthPt = (style: string | null | undefined) => { const m = /width:\s*([\d.]+)(pt|in|cm|mm|px)?/.exec(style ?? ''); if (!m) return NaN; const k = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75 }[(m[2] ?? 'px') as 'pt']; return Number(m[1]) * k; };
const same = (a: Uint8Array | undefined, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
/** The o:OLEObject in the paragraph holding `id`, and the bytes it embeds. */
function oleOf(v: View, id: string): { ole?: Element; bytes?: Uint8Array } {
  const ole = paraOf(v, id)?.getElementsByTagNameNS(NS.o, 'OLEObject')[0];
  const t = ole && v.target('word/document.xml', at(ole, 'r:id') ?? '');
  return { ole, bytes: t ? v.binary[t.startsWith('/') ? t.slice(1) : `word/${t}`] : undefined };
}
let oles = 0;
const oItem = (feature: string, tag: T, spec: string, o: { prog: string; bytes: Uint8Array; ext: string; rel: string; style: string; icon?: boolean; link?: string }, check: (v: View, id: string) => boolean, basis?: string) => {
  const id = oleI(feature, tag, spec, (v) => check(v, id), basis);
  body.push((w) => {
    const n = ++oles;
    const preview = addPic(w, png(120, 80, [27, 127, 121]));
    let oleRid: string;
    if (o.link) oleRid = w.rel(REL.oleObject, o.link, true);
    else { w.pkg.add(`word/embeddings/oleObject${n}.${o.ext}`, o.bytes); oleRid = w.rel(o.rel, `embeddings/oleObject${n}.${o.ext}`); }
    return para(run(`${id} ${feature}: `) + `<w:r><w:object w:dxaOrig="2400" w:dyaOrig="1600"><v:shape id="_x0000_i10${n}" type="#_x0000_t75" style="${o.style}" o:ole=""><v:imagedata r:id="${preview}" o:title=""/></v:shape>`
      + `<o:OLEObject Type="${o.link ? 'Link' : 'Embed'}" ProgID="${o.prog}" ShapeID="_x0000_i10${n}" DrawAspect="${o.icon ? 'Icon' : 'Content'}" ObjectID="_${1700000000 + n}" r:id="${oleRid}"${o.link ? ' UpdateMode="Always"' : ''}/></w:object></w:r>`);
  });
};
oItem('ChemDraw object', 'kept', 'ChemDraw.Document.6.0 OLE object (§17.3.3.19 object); Insert ▸ Object ▸ ChemDraw Document', { prog: 'ChemDraw.Document.6.0', bytes: CHEM1, ext: 'bin', rel: REL.oleObject, style: 'width:120pt;height:80pt' },
  (v, id) => { const o = oleOf(v, id); return isChemDraw(o.ole) && same(cdxIn(o.bytes), CDX1); }, 'docx-read.ts:2771 embedded (CFB written back as it was)');
oItem('Second ChemDraw object, smaller', 'kept', 'ChemDraw OLE object', { prog: 'ChemDraw.Document.6.0', bytes: CHEM2, ext: 'bin', rel: REL.oleObject, style: 'width:72pt;height:48pt' },
  (v, id) => { const o = oleOf(v, id); return same(cdxIn(o.bytes), CDX2) && Math.abs(widthPt(paraOf(v, id)?.getElementsByTagNameNS(NS.v, 'shape')[0]?.getAttribute('style')) - 72) < 0.5; }, 'docx-read.ts:2771');
oItem('ChemDraw object shown as an icon', 'kept', 'o:OLEObject@DrawAspect Icon; Object ▸ Display as icon', { prog: 'ChemDraw.Document.6.0', bytes: CHEM1, ext: 'bin', rel: REL.oleObject, style: 'width:48pt;height:48pt', icon: true },
  (v, id) => { const o = oleOf(v, id); return at(o.ole, 'DrawAspect') === 'Icon' && same(cdxIn(o.bytes), CDX1); }, 'docx-read.ts:2771');
oItem('ChemDraw object stored byte for byte, with its ProgID', 'kept', 'OLE compound file (MS-CFB) as embedded', { prog: 'ChemDraw.Document.6.0', bytes: CHEM1, ext: 'bin', rel: REL.oleObject, style: 'width:120pt;height:80pt' },
  (v, id) => { const o = oleOf(v, id); return at(o.ole, 'ProgID') === 'ChemDraw.Document.6.0' && same(o.bytes, CHEM1); }, 'docx-read.ts:2771 (the original bytes written back)');
oItem('Excel worksheet object', 'kept', 'Excel.Sheet.12 embedded package (§17.3.3.19); Insert ▸ Object ▸ Microsoft Excel Worksheet', { prog: 'Excel.Sheet.12', bytes: XLSX_OBJ, ext: 'xlsx', rel: REL.package, style: 'width:120pt;height:48pt' },
  (v, id) => { const o = oleOf(v, id); return at(o.ole, 'ProgID') === 'Excel.Sheet.12' && same(o.bytes, XLSX_OBJ); }, 'docx-read.ts:2771 (an object with a picture keeps its bytes)');
oItem('Linked object (file on disk)', 'loss', 'o:OLEObject Type Link; Object ▸ Link to file', { prog: 'Excel.Sheet.12', bytes: new Uint8Array(), ext: 'xlsx', rel: REL.oleObject, style: 'width:120pt;height:48pt', link: 'file:///C:/Samples/linked.xlsx' },
  (v, id) => at(oleOf(v, id).ole, 'Type') === 'Link', 'docx-read.ts:2771 (linked objects become pictures)');

// ---------------------------------------------------------------------------------------------

export const docxObjects: Sampler = {
  name: 'docx-objects.docx', area: 'Word pictures, wrapping, shapes, text boxes, groups, equations, charts, SmartArt and embedded objects (ChemDraw)', items,
  build: () => {
    media = 0; charts = 0; oles = 0; docPrId = 100;
    return wordFile({ title: 'Word sampler: objects', body: (w) => body.map((b) => b(w)).join('') });
  },
};
