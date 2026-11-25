/**
 * PowerPoint sampler: shapes (P-GEO preset and custom geometry with adjust values, P-CXN lines,
 * connectors and arrowheads, P-XFM rotation and flips, P-GRP groups, z-order, hidden shapes and
 * names). Each shape's name holds its id (and its text, when it has text). ECMA-376 Part 1 §20.1.9
 * (geometry: prstGeom §20.1.9.18, custGeom §20.1.9.8, ST_ShapeType §20.1.10.56), §19.3.1.19
 * (cxnSp), §20.1.7.6 (xfrm), §19.3.1.22 (grpSp); PowerPoint's Insert ▸ Shapes, Shape Format ▸
 * Edit Shape, Arrange ▸ Rotate, Group, Bring Forward, Selection Pane.
 *
 * Tags from src/io/pptx-read.ts shape() (:1858), geoShape() (:2002, presets in src/design/geo.ts
 * GEOS), line() (:2634), the grpSp case (:1149) and src/io/pptx-write.ts geo() (:1551).
 */
import { type Item, type Sampler, type View, itemList, at, kid, NS, png } from './kit';
import {
  deckFile, sp, cxn, grp, pic, txBody, para, r, prst, gd, solid, line, NOFILL,
  shapeOf, namedShape, spPrOf, boxOf, nameOf, partOf, SLIDES, type Box, type SlideCtx, type SlideDef,
} from './pptx';

const items: Item[] = [];
type Tag = 'supported' | 'kept' | 'loss';
type Maker = (s: SlideCtx) => string;
const slides: Maker[][] = [];
let cur: Maker[] = [];
const newSlide = () => { cur = []; slides.push(cur); };

const label = (id: string, size = 800) => txBody(para(r(id, `sz="${size}"`), 'algn="ctr"'), '<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr>');
const FILL = solid('8AB17D') + line(1, solid('1F3A4D'));
const prstOf = (v: View, id: string) => at(kid(spPrOf(shapeOf(v, id)), 'a:prstGeom') ?? null, 'prst');
const avOf = (v: View, id: string, name: string) => at(Array.from(kid(kid(spPrOf(shapeOf(v, id)), 'a:prstGeom'), 'a:avLst')?.children ?? []).find((g) => at(g, 'name') === name) ?? null, 'fmla');

// ---------------------------------------------------------------- preset geometry

const geo = itemList('P-GEO', items);
newSlide();
let n = 0;
const shape = (feature: string, tag: Tag, spec: string, geom: string, check: (v: View, id: string) => boolean, basis?: string, fmt = FILL) => {
  if (n++ && n % 30 === 1) newSlide();
  const id = geo(feature, tag, spec, (v) => check(v, id), basis);
  cur.push((s) => sp({ id: s.id(), name: `${id} ${feature}`, box: s.cell(), geom, fmt, body: label(id) }));
};
const KNOWN = ['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star5', 'plus', 'can', 'cloud', 'heart', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'chevron', 'homePlate', 'flowChartProcess', 'flowChartAlternateProcess', 'flowChartDecision', 'flowChartTerminator', 'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartDocument', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartPreparation', 'flowChartMagneticDisk', 'flowChartDelay', 'flowChartConnector', 'flowChartMerge'];
for (const p of KNOWN) shape(`Preset shape ${p}`, 'supported', `§20.1.9.18 prstGeom, §20.1.10.56 ST_ShapeType ${p}; Insert ▸ Shapes`, prst(p), (v, id) => prstOf(v, id) === p, 'design/geo.ts GEOS; pptx-read.ts:1868');
const UNKNOWN = ['star7', 'sun', 'moon', 'smileyFace', 'lightningBolt', 'blockArc', 'donut', 'noSmoking', 'wave', 'ribbon2', 'wedgeRectCallout', 'wedgeEllipseCallout', 'cube', 'bevel', 'foldedCorner', 'frame', 'teardrop', 'pie', 'chord', 'gear6', 'snip2SameRect', 'round2DiagRect', 'bracketPair', 'leftBrace', 'mathPlus', 'mathNotEqual', 'arc', 'curvedRightArrow', 'circularArrow', 'irregularSeal1'];
for (const p of UNKNOWN) shape(`Preset shape ${p}`, 'loss', `§20.1.10.56 ST_ShapeType ${p}; Insert ▸ Shapes`, prst(p), (v, id) => prstOf(v, id) === p, 'pptx-read.ts:1879 (not in GEOS: comes in as a box)');
newSlide(); n = 0;
shape('Rounded rectangle corner size (adj 30000)', 'supported', '§20.1.9.5 avLst gd adj; drag the yellow handle', prst('roundRect', gd('adj', 'val 30000')), (v, id) => { const f = avOf(v, id, 'adj'); return !!f && Math.abs(Number(f.replace('val ', '')) - 30000) < 600; }, 'pptx-read.ts roundRadius (:3267)');
shape('Trapezoid adjust value', 'loss', '§20.1.9.5 avLst', prst('trapezoid', gd('adj', 'val 40000')), (v, id) => avOf(v, id, 'adj') === 'val 40000', 'pptx-read.ts or pptx-write.ts, not traced to a line: avLst lost except roundRect');
shape('Star 5 point depth (adj 30000)', 'loss', '§20.1.9.5 avLst star5 adj', prst('star5', gd('adj', 'val 30000') + gd('hf', 'val 105146') + gd('vf', 'val 110557')), (v, id) => avOf(v, id, 'adj') === 'val 30000', 'pptx-read.ts or pptx-write.ts, not traced to a line');
shape('Right arrow shaft and head (adj1, adj2)', 'loss', '§20.1.9.5 avLst rightArrow', prst('rightArrow', gd('adj1', 'val 30000') + gd('adj2', 'val 70000')), (v, id) => avOf(v, id, 'adj1') === 'val 30000' && avOf(v, id, 'adj2') === 'val 70000', 'pptx-read.ts or pptx-write.ts, not traced to a line');
shape('Chevron point (adj 25000)', 'loss', '§20.1.9.5 avLst chevron', prst('chevron', gd('adj', 'val 25000')), (v, id) => avOf(v, id, 'adj') === 'val 25000', 'pptx-read.ts or pptx-write.ts, not traced to a line');
shape('Can depth (adj 40000)', 'loss', '§20.1.9.5 avLst can', prst('can', gd('adj', 'val 40000')), (v, id) => avOf(v, id, 'adj') === 'val 40000', 'pptx-read.ts or pptx-write.ts, not traced to a line');
shape('Snip single corner rectangle', 'loss', '§20.1.10.56 snip1Rect', prst('snip1Rect'), (v, id) => prstOf(v, id) === 'snip1Rect', 'pptx-read.ts:1879 (PLAIN_PRST but not in GEOS)');
// custom geometry: Edit Points
const CUST = '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="1000"/></a:moveTo><a:lnTo><a:pt x="500" y="0"/></a:lnTo><a:cubicBezTo><a:pt x="700" y="300"/><a:pt x="1000" y="500"/><a:pt x="1000" y="1000"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>';
shape('Freeform (custom geometry with lines and a curve)', 'loss', '§20.1.9.8 custGeom, §20.1.9.15 path; Shape Format ▸ Edit Shape ▸ Edit Points', CUST, (v, id) => !!kid(spPrOf(shapeOf(v, id)), 'a:custGeom'), 'pptx-read.ts:1864 cust (comes in as a box)');
const ARC = '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="500"/></a:moveTo><a:arcTo wR="500" hR="500" stAng="10800000" swAng="10800000"/><a:quadBezTo><a:pt x="500" y="1200"/><a:pt x="0" y="500"/></a:quadBezTo><a:close/></a:path><a:path w="1000" h="1000" fill="none"><a:moveTo><a:pt x="200" y="500"/></a:moveTo><a:lnTo><a:pt x="800" y="500"/></a:lnTo></a:path></a:pathLst></a:custGeom>';
shape('Freeform with arcs, a quadratic curve and an unfilled second path', 'loss', '§20.1.9.3 arcTo, §20.1.9.21 quadBezTo, path@fill none', ARC, (v, id) => (kid(spPrOf(shapeOf(v, id)), 'a:custGeom')?.getElementsByTagNameNS(NS.a, 'path').length ?? 0) === 2, 'pptx-read.ts:1864');
shape('Freeform open path drawn with no fill (Scribble)', 'loss', '§20.1.9.15 path@fill none; Insert ▸ Shapes ▸ Scribble', '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="300" y="900"/></a:lnTo><a:lnTo><a:pt x="600" y="100"/></a:lnTo><a:lnTo><a:pt x="1000" y="1000"/></a:lnTo></a:path></a:pathLst></a:custGeom>', (v, id) => !!kid(spPrOf(shapeOf(v, id)), 'a:custGeom'), 'pptx-read.ts:1864', NOFILL + line(2, solid('C8553D')));

// ---------------------------------------------------------------- lines, connectors, arrowheads

const cx = itemList('P-CXN', items);
newSlide();
let row = 0;
const lineBox = (): Box => { const k = row++; return [30 + (k % 3) * 300, 30 + Math.floor(k / 3) * 42, 260, 30]; };
const lnOf = (v: View, id: string) => kid(spPrOf(namedShape(v, id, SLIDES, ['cxnSp', 'sp'])), 'a:ln');
const endOf = (v: View, id: string, which: 'headEnd' | 'tailEnd') => kid(lnOf(v, id), `a:${which}`);
/** A connector (cxnSp) of this geometry and line. */
const conn = (feature: string, tag: Tag, spec: string, geomName: string, ln: string, check: (v: View, id: string) => boolean, basis?: string, asSp = false) => {
  const id = cx(feature, tag, spec, (v) => check(v, id), basis);
  cur.push((s) => { const b = lineBox(); return (asSp ? sp({ id: s.id(), name: `${id} ${feature}`, box: b, geom: prst(geomName), fmt: ln }) : cxn({ id: s.id(), name: `${id} ${feature}`, box: b, geom: prst(geomName), fmt: ln })) + sp({ id: s.id(), name: 'label', txBox: true, box: [b[0], b[1] + 18, b[2], 14], fmt: NOFILL, body: txBody(para(r(`${id} ${feature}`, 'sz="700"')), '<a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>') }); });
};
const BLUE = solid('3A86FF');
const L = (rest = '', w = 2) => line(w, BLUE, rest);
conn('Straight connector', 'supported', '§19.3.1.19 cxnSp, straightConnector1; Insert ▸ Shapes ▸ Line', 'straightConnector1', L(), (v, id) => !!namedShape(v, id, SLIDES, ['cxnSp', 'sp']), 'pptx-read.ts:2634 line()');
conn('Line color', 'supported', '§20.1.2.2.24 ln solidFill; Shape Outline ▸ color', 'line', L(), (v, id) => at(kid(lnOf(v, id), 'a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === '3A86FF', 'pptx-read.ts:2675 color');
conn('Line width 2 pt', 'loss', '§20.1.2.2.24 ln@w; Shape Outline ▸ Weight', 'line', L(), (v, id) => at(lnOf(v, id) ?? null, 'w') === '25400', 'pptx-read.ts:2678 (a plain line has only a bold flag)');
conn('Arrow: end arrowhead triangle', 'supported', '§20.1.8.57 tailEnd type triangle; Shape Outline ▸ Arrows', 'straightConnector1', L('<a:tailEnd type="triangle"/>'), (v, id) => { const e = endOf(v, id, 'tailEnd'); return !!e && at(e, 'type') !== 'none'; }, 'pptx-read.ts:2656 arrow');
conn('Arrow: end arrowhead keeps type triangle', 'supported', '§20.1.10.33 ST_LineEndType triangle', 'straightConnector1', L('<a:tailEnd type="triangle"/>'), (v, id) => at(endOf(v, id, 'tailEnd') ?? null, 'type') === 'triangle', 'pptx-read.ts or pptx-write.ts, not traced to a line: others -> solid (triangle)');
conn('Arrow: begin arrowhead (head end)', 'supported', '§20.1.8.38 headEnd', 'straightConnector1', L('<a:headEnd type="triangle"/>'), (v, id) => { const h = endOf(v, id, 'headEnd'), t = endOf(v, id, 'tailEnd'); return [h, t].filter((e) => e && at(e, 'type') !== 'none').length === 1; }, 'pptx-read.ts:2654');
conn('Double arrow (both ends)', 'supported', '§20.1.8.38 headEnd, §20.1.8.57 tailEnd', 'straightConnector1', L('<a:headEnd type="triangle"/><a:tailEnd type="triangle"/>'), (v, id) => at(endOf(v, id, 'headEnd') ?? null, 'type') !== null && at(endOf(v, id, 'headEnd') ?? null, 'type') !== 'none' && at(endOf(v, id, 'tailEnd') ?? null, 'type') !== 'none', 'pptx-read.ts:2662 tailStyle');
conn('Open arrowhead (arrow)', 'supported', '§20.1.10.33 ST_LineEndType arrow', 'straightConnector1', L('<a:tailEnd type="arrow"/>'), (v, id) => at(endOf(v, id, 'tailEnd') ?? null, 'type') === 'arrow', 'pptx-read.ts:2663 headType angle');
conn('Stealth arrowhead', 'loss', '§20.1.10.33 ST_LineEndType stealth', 'straightConnector1', L('<a:tailEnd type="stealth"/>'), (v, id) => at(endOf(v, id, 'tailEnd') ?? null, 'type') === 'stealth', 'pptx-read.ts:2663 (solid)');
conn('Diamond arrowhead', 'loss', '§20.1.10.33 ST_LineEndType diamond', 'straightConnector1', L('<a:tailEnd type="diamond"/>'), (v, id) => at(endOf(v, id, 'tailEnd') ?? null, 'type') === 'diamond', 'pptx-read.ts:2663');
conn('Oval arrowhead', 'loss', '§20.1.10.33 ST_LineEndType oval', 'straightConnector1', L('<a:tailEnd type="oval"/>'), (v, id) => at(endOf(v, id, 'tailEnd') ?? null, 'type') === 'oval', 'pptx-read.ts:2663');
conn('Arrowhead large width and length', 'loss', '§20.1.8.57 tailEnd@w/@len lg', 'straightConnector1', L('<a:tailEnd type="triangle" w="lg" len="lg"/>'), (v, id) => at(endOf(v, id, 'tailEnd') ?? null, 'w') === 'lg' && at(endOf(v, id, 'tailEnd') ?? null, 'len') === 'lg', 'pptx-read.ts or pptx-write.ts, not traced to a line: sizes become one');
conn('Arrowhead small width, medium length', 'loss', '§20.1.10.34 ST_LineEndWidth sm', 'straightConnector1', L('<a:tailEnd type="triangle" w="sm" len="med"/>'), (v, id) => at(endOf(v, id, 'tailEnd') ?? null, 'w') === 'sm', 'pptx-read.ts or pptx-write.ts, not traced to a line');
conn('Elbow connector', 'loss', '§20.1.10.56 bentConnector3; Insert ▸ Shapes ▸ Connector: Elbow', 'bentConnector3', L('<a:tailEnd type="triangle"/>'), (v, id) => at(kid(spPrOf(namedShape(v, id)), 'a:prstGeom') ?? null, 'prst') === 'bentConnector3', 'pptx-read.ts:2641 (straight, warning)');
conn('Curved connector', 'loss', '§20.1.10.56 curvedConnector3', 'curvedConnector3', L('<a:tailEnd type="triangle"/>'), (v, id) => at(kid(spPrOf(namedShape(v, id)), 'a:prstGeom') ?? null, 'prst') === 'curvedConnector3', 'pptx-read.ts:2641');
conn('Line drawn as a shape (sp with prst line)', 'supported', '§20.1.10.56 line in p:sp', 'line', L(), (v, id) => !!namedShape(v, id, SLIDES, ['cxnSp', 'sp']), 'pptx-read.ts:1866', true);
// a line turned and flipped
{
  const id = cx('Line flipped vertically (rising)', 'supported', '§20.1.7.6 xfrm@flipV on a connector', (v) => { const e = namedShape(v, id); const x = kid(spPrOf(e), 'a:xfrm'); return !!e && (at(x ?? null, 'flipV') === '1' || at(x ?? null, 'flipH') === '1'); }, 'pptx-read.ts:2644 (ends from flips)');
  cur.push((s) => cxn({ id: s.id(), name: `${id} rising line`, box: [640, 400, 200, 80], xfrmAttrs: ' flipV="1"', geom: prst('straightConnector1'), fmt: L('<a:tailEnd type="triangle"/>') }));
}
// connectors glued to two shapes
{
  const id = cx('Connector glued to two shapes (begin and end connections)', 'loss', '§20.1.2.2.36 stCxn, §20.1.2.2.15 endCxn; drag a connector to a shape\'s points', (v) => { const e = namedShape(v, id, SLIDES, ['cxnSp']); const nv = kid(kid(e, 'p:nvCxnSpPr'), 'p:cNvCxnSpPr'); return !!kid(nv, 'a:stCxn') && !!kid(nv, 'a:endCxn'); }, 'pptx-read.ts or pptx-write.ts, not traced to a line: stCxn/endCxn lost on foreign files');
  cur.push((s) => {
    const a = s.id(), b = s.id();
    return sp({ id: a, name: `${id} start box`, box: [40, 420, 100, 60], geom: prst('rect'), fmt: FILL, body: label('start') })
      + sp({ id: b, name: `${id} end box`, box: [340, 460, 100, 60], geom: prst('ellipse'), fmt: FILL, body: label('end') })
      + cxn({ id: s.id(), name: `${id} glued connector`, box: [140, 450, 200, 40], geom: prst('straightConnector1'), fmt: L('<a:tailEnd type="triangle"/>'), st: [a, 3], end: [b, 2] });
  });
}

// ---------------------------------------------------------------- rotation and flips

const xf = itemList('P-XFM', items);
newSlide();
const xfOf = (v: View, id: string) => kid(spPrOf(shapeOf(v, id)), 'a:xfrm');
const turnItem = (feature: string, tag: Tag, spec: string, attrs: string, check: (x: Element | undefined, v: View, id: string) => boolean, basis?: string, geomName = 'rightArrow') => {
  const id = xf(feature, tag, spec, (v) => check(xfOf(v, id), v, id), basis);
  cur.push((s) => sp({ id: s.id(), name: `${id} ${feature}`, box: s.cell(), xfrmAttrs: attrs, geom: prst(geomName), fmt: FILL, body: label(id, 900) }));
};
turnItem('Rotation 30°', 'supported', '§20.1.7.6 xfrm@rot; Format Shape ▸ Size ▸ Rotation', ' rot="1800000"', (x) => at(x ?? null, 'rot') === '1800000', 'pptx-read.ts boxOf rot');
turnItem('Rotation 270°', 'supported', '§20.1.7.6 xfrm@rot', ' rot="16200000"', (x) => at(x ?? null, 'rot') === '16200000');
turnItem('Rotation 12.5° (fraction of a degree kept)', 'supported', '§20.1.7.6 xfrm@rot (60000ths of a degree)', ' rot="750000"', (x) => at(x ?? null, 'rot') === '750000');
turnItem('Flip Horizontal', 'loss', '§20.1.7.6 xfrm@flipH; Arrange ▸ Rotate ▸ Flip Horizontal', ' flipH="1"', (x) => at(x ?? null, 'flipH') === '1', 'pptx-read.ts or pptx-write.ts, not traced to a line: no flip field on geo shapes');
turnItem('Flip Vertical', 'loss', '§20.1.7.6 xfrm@flipV', ' flipV="1"', (x) => at(x ?? null, 'flipV') === '1', 'pptx-read.ts or pptx-write.ts, not traced to a line', 'rtTriangle');
turnItem('Rotation 45° and Flip Horizontal', 'loss', '§20.1.7.6 xfrm@rot and @flipH', ' rot="2700000" flipH="1"', (x) => at(x ?? null, 'flipH') === '1' && at(x ?? null, 'rot') === '2700000', 'pptx-read.ts or pptx-write.ts, not traced to a line');
turnItem('Shape keeps its position and size', 'supported', '§20.1.7.4 off, §20.1.7.3 ext; Format Shape ▸ Size & Position', '', (_x, v, id) => { const b = boxOf(shapeOf(v, id)); const c = itemBox.get(id); return !!b && !!c && b.every((q, k) => Math.abs(q - c[k]) < 0.5); }, 'pptx-read.ts boxOf', 'rect');
const itemBox = new Map<string, Box>();
{
  const id = xf('Picture rotated 20°', 'supported', '§20.1.7.6 xfrm@rot on p:pic', (v) => at(kid(spPrOf(namedShape(v, id, SLIDES, ['pic'])), 'a:xfrm') ?? null, 'rot') === '1200000', 'picture-xml.ts');
  cur.push((s) => pic({ id: s.id(), name: `${id} rotated picture`, rid: s.media('xfm1.png', PNG), box: s.cell(), xfrmAttrs: ' rot="1200000"' }));
  const id2 = xf('Picture flipped horizontally', 'loss', '§20.1.7.6 xfrm@flipH on p:pic; Picture Format ▸ Rotate ▸ Flip Horizontal', (v) => at(kid(spPrOf(namedShape(v, id2, SLIDES, ['pic'])), 'a:xfrm') ?? null, 'flipH') === '1', 'pptx-read.ts:1722 keepPicture (flipped pictures not kept)');
  cur.push((s) => pic({ id: s.id(), name: `${id2} flipped picture`, rid: s.media('xfm2.png', PNG), box: s.cell(), xfrmAttrs: ' flipH="1"' }));
  const id3 = xf('Picture flipped vertically', 'loss', '§20.1.7.6 xfrm@flipV on p:pic', (v) => at(kid(spPrOf(namedShape(v, id3, SLIDES, ['pic'])), 'a:xfrm') ?? null, 'flipV') === '1', 'pptx-read.ts:1722');
  cur.push((s) => pic({ id: s.id(), name: `${id3} flipped picture`, rid: s.media('xfm3.png', PNG), box: s.cell(), xfrmAttrs: ' flipV="1"' }));
}
const PNG = png(64, 48);

// ---------------------------------------------------------------- groups, order, names

/** A shape's box on the slide, through the groups it is in. */
function absBox(el: Element | undefined): Box | undefined {
  let b = boxOf(el);
  for (let g = el?.parentElement; b && g && g.localName === 'grpSp'; g = g.parentElement) {
    const x = kid(kid(g, 'p:grpSpPr'), 'a:xfrm');
    const n = (e: string, a: string) => Number(at(kid(x, e) ?? null, a)) / 12700;
    const sx = n('a:chExt', 'cx') ? n('a:ext', 'cx') / n('a:chExt', 'cx') : 1, sy = n('a:chExt', 'cy') ? n('a:ext', 'cy') / n('a:chExt', 'cy') : 1;
    b = [n('a:off', 'x') + (b[0] - n('a:chOff', 'x')) * sx, n('a:off', 'y') + (b[1] - n('a:chOff', 'y')) * sy, b[2] * sx, b[3] * sy];
  }
  return b;
}

const gr = itemList('P-GRP', items);
newSlide();
const box2 = (s: SlideCtx, name: string, b: Box, fill = '8AB17D', g = 'rect') => sp({ id: s.id(), name, box: b, geom: prst(g), fmt: solid(fill) + line(1, solid('1F3A4D')), body: label(name) });
{
  const id = gr('Group of two shapes', 'supported', '§19.3.1.22 grpSp; Arrange ▸ Group', (v) => { const g = namedShape(v, id, SLIDES, ['grpSp']) ?? Array.from(v.all(SLIDES, 'p:grpSp')).find((x) => (x.textContent ?? '').includes(`${id} A`)); return !!g && (g.textContent ?? '').includes(`${id} A`) && (g.textContent ?? '').includes(`${id} B`); }, 'pptx-read.ts:1149 groupNew');
  cur.push((s) => grp({ id: s.id(), name: `${id} group`, box: [30, 30, 260, 100], kids: box2(s, `${id} A`, [30, 30, 120, 100]) + box2(s, `${id} B`, [170, 30, 120, 100], 'F2A541', 'ellipse') }));
  const g2 = gr('Group keeps its name', 'supported', '§19.3.1.12 cNvPr@name on grpSp; Selection Pane', (v) => !!namedShape(v, g2, SLIDES, ['grpSp']), 'pptx-read.ts:1211 nameNew (groups skipped?)');
  cur.push((s) => grp({ id: s.id(), name: `${g2} named group`, box: [320, 30, 260, 100], kids: box2(s, `${g2} A`, [320, 30, 120, 100]) + box2(s, `${g2} B`, [460, 30, 120, 100]) }));
  const nest = gr('Group inside a group (nested)', 'loss', '§19.3.1.22 grpSp in grpSp', (v) => v.all(SLIDES, 'p:grpSp').some((g) => (g.textContent ?? '').includes(nest) && Array.from(g.children).some((c) => c.localName === 'grpSp')), 'pptx-read.ts:1166 (one level deep)');
  cur.push((s) => grp({ id: s.id(), name: `${nest} outer group`, box: [610, 30, 320, 100], kids: box2(s, `${nest} outer`, [610, 30, 100, 100]) + grp({ id: s.id(), name: `${nest} inner group`, box: [720, 30, 210, 100], kids: box2(s, `${nest} innerA`, [720, 30, 100, 100], 'C8553D') + box2(s, `${nest} innerB`, [830, 30, 100, 100], '6A4C93') }) }));
  const scaled = gr('Group with scaled child space (chExt differs from ext)', 'supported', '§20.1.7.5 grpSpPr xfrm chOff/chExt', (v) => { const e = shapeOf(v, `${scaled} A`); const b = absBox(e); return !!b && Math.abs(b[2] - 60) < 1 && Math.abs(b[3] - 50) < 1; }, 'pptx-read.ts:1151 (children placed through the group)');
  cur.push((s) => grp({ id: s.id(), name: `${scaled} scaled group`, box: [30, 160, 130, 50], chBox: [0, 0, 260, 100], kids: box2(s, `${scaled} A`, [0, 0, 120, 100]) + box2(s, `${scaled} B`, [140, 0, 120, 100], 'F2A541') }));
  const grot = gr('Group rotated 15°', 'loss', '§20.1.7.5 grpSpPr xfrm@rot', (v) => { const g = v.all(SLIDES, 'p:grpSp').find((x) => (x.textContent ?? '').includes(grot)); return at(kid(kid(g, 'p:grpSpPr'), 'a:xfrm') ?? null, 'rot') === '900000'; }, 'pptx-read.ts or pptx-write.ts, not traced to a line: group rot/flip applied to the shapes in it');
  cur.push((s) => grp({ id: s.id(), name: `${grot} rotated group`, box: [200, 160, 260, 100], xfrmAttrs: ' rot="900000"', kids: box2(s, `${grot} A`, [200, 160, 120, 100]) + box2(s, `${grot} B`, [340, 160, 120, 100], 'F2A541') }));
  const grotKid = gr('Rotated group: its shapes turned with it', 'supported', '§20.1.7.5 (rotation applied to children)', (v) => { const e = shapeOf(v, `${grotKid} A`); const g = e ? (e.parentElement?.localName === 'grpSp' ? e.parentElement : null) : null; const own = Number(at(kid(spPrOf(e), 'a:xfrm') ?? null, 'rot') ?? 0); const gro = Number(at(kid(kid(g, 'p:grpSpPr'), 'a:xfrm') ?? null, 'rot') ?? 0); return own + gro === 900000; }, 'pptx-read.ts:1170 poseNew');
  cur.push((s) => grp({ id: s.id(), name: `${grotKid} rotated group 2`, box: [500, 160, 260, 100], xfrmAttrs: ' rot="900000"', kids: box2(s, `${grotKid} A`, [500, 160, 120, 100]) + box2(s, `${grotKid} B`, [640, 160, 120, 100], 'F2A541') }));
  const gfill = gr('Shapes filled with the group\'s fill (grpFill)', 'loss', '§20.1.8.35 grpFill', (v) => { const e = shapeOf(v, `${gfill} A`); return !!kid(spPrOf(e), 'a:grpFill'); }, 'pptx-read.ts or pptx-write.ts, not traced to a line: grpFill lost');
  cur.push((s) => grp({ id: s.id(), name: `${gfill} group with fill`, box: [790, 160, 140, 100], fmt: solid('3A86FF'), kids: sp({ id: s.id(), name: `${gfill} A`, box: [790, 160, 140, 100], geom: prst('ellipse'), fmt: '<a:grpFill/>' + line(1, solid('1F3A4D')), body: label(`${gfill} A`) }) }));
  const gflip = gr('Group flipped horizontally', 'loss', '§20.1.7.5 grpSpPr xfrm@flipH', (v) => { const g = v.all(SLIDES, 'p:grpSp').find((x) => (x.textContent ?? '').includes(gflip)); return at(kid(kid(g, 'p:grpSpPr'), 'a:xfrm') ?? null, 'flipH') === '1'; }, 'pptx-read.ts or pptx-write.ts, not traced to a line');
  cur.push((s) => grp({ id: s.id(), name: `${gflip} flipped group`, box: [30, 290, 260, 80], xfrmAttrs: ' flipH="1"', kids: box2(s, `${gflip} A`, [30, 290, 120, 80], '8AB17D', 'rightArrow') + box2(s, `${gflip} B`, [170, 290, 120, 80], 'F2A541', 'triangle') }));
}
{
  // z-order: three overlapping boxes, back to front A, B, C
  const z = gr('Z-order (Bring Forward / Send Backward): back to front A, B, C', 'supported', '§19.3.1.45 spTree order; Arrange ▸ Bring Forward', (v) => {
    const p = partOf(v, z); if (!p) return false;
    const names = v.inPart(p, 'p:sp').map((e) => nameOf(e) + ' ' + (kid(e, 'p:txBody')?.textContent ?? ''));
    const k = (x: string) => names.findIndex((nm) => nm.includes(`${z} ${x}`));
    return k('A') >= 0 && k('A') < k('B') && k('B') < k('C');
  }, 'pptx-read.ts or pptx-write.ts, not traced to a line: z-order kept');
  cur.push((s) => box2(s, `${z} A`, [330, 290, 120, 80], 'C8553D') + box2(s, `${z} B`, [370, 310, 120, 80], 'F2A541') + box2(s, `${z} C`, [410, 330, 120, 80], '3A86FF'));
  const hid = gr('Hidden shape (Selection Pane eye off)', 'supported', '§19.3.1.12 cNvPr@hidden; Selection Pane', (v) => at(kid(kid(namedShape(v, hid), 'p:nvSpPr'), 'p:cNvPr') ?? null, 'hidden') === '1', 'pptx-read.ts or pptx-write.ts, not traced to a line: hidden kept');
  cur.push((s) => sp({ id: s.id(), name: `${hid} hidden shape`, hidden: true, box: [570, 290, 120, 80], geom: prst('rect'), fmt: FILL, body: label(hid) }));
  const nm = gr('Shape name from the Selection Pane', 'supported', '§19.3.1.12 cNvPr@name', (v) => !!namedShape(v, `${nm} Renamed in the Selection Pane`), 'pptx-read.ts:1211 nameNew');
  cur.push((s) => sp({ id: s.id(), name: `${nm} Renamed in the Selection Pane`, box: [720, 290, 120, 80], geom: prst('ellipse'), fmt: FILL, body: label(nm) }));
  const alt = gr('Shape alt text (description)', 'loss', '§19.3.1.12 cNvPr@descr; Format Shape ▸ Alt Text', (v) => (at(kid(kid(shapeOf(v, alt), 'p:nvSpPr'), 'p:cNvPr') ?? null, 'descr') ?? '').includes('Alt text of a shape'), 'pptx-read.ts:1381 (read for shapes?)');
  cur.push((s) => sp({ id: s.id(), name: `${alt} shape with alt text`, descr: `${alt} Alt text of a shape`, box: [30, 400, 120, 80], geom: prst('roundRect'), fmt: FILL, body: label(alt) }));
  const title = gr('Shape alt text title', 'loss', '§19.3.1.12 cNvPr@title', (v) => v.all(SLIDES, 'p:cNvPr').some((c) => (at(c, 'title') ?? '') === `${title} title`), 'not read');
  cur.push((s) => sp({ id: s.id(), name: `${title} shape with a title`, box: [180, 400, 120, 80], geom: prst('roundRect'), fmt: FILL, body: label(title) }).replace(`name="${title} shape with a title"`, `name="${title} shape with a title" title="${title} title"`));
  const lock = gr('Shape locks (no move, no resize)', 'loss', '§20.1.2.2.34 spLocks', (v) => { const l = kid(kid(kid(shapeOf(v, lock), 'p:nvSpPr'), 'p:cNvSpPr'), 'a:spLocks'); return at(l ?? null, 'noMove') === '1'; }, 'not read');
  cur.push((s) => sp({ id: s.id(), name: `${lock} locked shape`, locks: '<a:spLocks noMove="1" noResize="1"/>', box: [330, 400, 120, 80], geom: prst('rect'), fmt: FILL, body: label(lock) }));
  const style = gr('Shape style reference (Shape Styles gallery: lnRef, fillRef, effectRef, fontRef)', 'loss', '§19.3.1.46 style, §20.1.4.2.19 fillRef', (v) => !!kid(shapeOf(v, style), 'p:style'), 'pptx-read.ts:2608 look() (style resolved to colors)');
  cur.push((s) => sp({ id: s.id(), name: `${style} styled shape`, box: [480, 400, 120, 80], geom: prst('rect'), style: '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>', body: label(style) }));
  const styled = gr('Shape style colors shown (fill from fillRef accent 2)', 'supported', '§20.1.4.2.19 fillRef (resolved)', (v) => { const e = shapeOf(v, styled); return !!kid(e, 'p:style') || at(kid(spPrOf(e), 'a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'C8553D' || at(kid(spPrOf(e), 'a:solidFill/a:schemeClr') ?? null, 'val') === 'accent2'; }, 'pptx-read.ts:2618');
  cur.push((s) => sp({ id: s.id(), name: `${styled} styled shape 2`, box: [630, 400, 120, 80], geom: prst('ellipse'), style: '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>', body: label(styled) }));
}

const SLIDE_DEFS: SlideDef[] = slides.map((makers) => ({
  body: (s: SlideCtx) => {
    s.grid(6, Math.max(1, Math.ceil(makers.length / 6)));
    return makers.map((m) => {
      const x = m(s);
      // remember the box each "keeps its position" item was given
      const name = /name="(P-XFM-\d+) Shape keeps its position/.exec(x)?.[1];
      const b = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/.exec(x);
      if (name && b) itemBox.set(name, [Number(b[1]) / 12700, Number(b[2]) / 12700, Number(b[3]) / 12700, Number(b[4]) / 12700].map((q) => Math.round(q * 10) / 10) as Box);
      return x;
    }).join('');
  },
}));

export const pptxShapes: Sampler = {
  name: 'pptx-shapes.pptx', area: 'PowerPoint shapes: preset and custom geometry, lines and connectors, rotation and flips, groups and order', items,
  build: () => deckFile({ title: 'PowerPoint sampler: shapes', slides: SLIDE_DEFS }),
};
