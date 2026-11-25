/**
 * PowerPoint sampler: shape formatting (P-FIL fills, P-LIN outlines, P-EFX effects). Each item is
 * a hexagon (a shape Chemweave reads as a design shape) whose name and text hold its id, unless it
 * says otherwise. ECMA-376 Part 1 §20.1.8 (fills: solidFill §20.1.8.54, gradFill §20.1.8.33,
 * pattFill §20.1.8.47, blipFill §20.1.8.14; effects: outerShdw §20.1.8.49, innerShdw §20.1.8.40,
 * glow §20.1.8.32, softEdge §20.1.8.53, reflection §20.1.8.50, prstShdw §20.1.8.48, blur
 * §20.1.8.15), §20.1.2.2.24 (ln), §20.1.5 (3-D: scene3d, sp3d); PowerPoint's Format Shape pane
 * (Fill & Line, Effects) and Shape Format ▸ Shape Fill, Shape Outline, Shape Effects.
 *
 * Tags from src/io/pptx-read.ts geoShape()/native() (:2020: solid, transparency, first and last
 * gradient stops, picture fill, effects), look() (:2608: pattern fills come in as plain colors,
 * dashes as dashed or dotted), effects() (:2144) and src/io/pptx-effects.ts readEffects (:47), and
 * src/io/pptx-write.ts geoSpPr (:2002).
 */
import { type Item, type Sampler, type View, itemList, at, kid, NS, png } from './kit';
import { colorIs, deckFile, sp, txBody, para, r, prst, solid, line, NOFILL, namedShape, spPrOf, type SlideCtx, type SlideDef } from './pptx';

const items: Item[] = [];
type Tag = 'supported' | 'kept' | 'loss';
type Maker = (s: SlideCtx) => string;
const slides: Maker[][] = [];
let cur: Maker[] = [];
const newSlide = () => { cur = []; slides.push(cur); };

const label = (id: string) => txBody(para(r(id, 'sz="800"', solid('000000')), 'algn="ctr"'), '<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr>');
const spPr = (v: View, id: string) => spPrOf(namedShape(v, id));
const OUT = line(1, solid('1F3A4D'));
const GREEN = solid('8AB17D');
const PIC = png(48, 36);

/** One item: a shape of `geom` with spPr's fill, line and effects `fmt`, checked on its saved spPr. */
const mk = (it: ReturnType<typeof itemList>) => (feature: string, tag: Tag, spec: string, fmt: string | ((s: SlideCtx) => string), check: (e: Element | undefined) => boolean, basis?: string, geom = prst('hexagon'), text = true) => {
  const id = it(feature, tag, spec, (v) => check(spPr(v, id)), basis);
  cur.push((s) => {
    const b = s.cell();
    const body = sp({ id: s.id(), name: `${id} ${feature}`, box: text ? b : [b[0], b[1], b[2], b[3] - 14], geom, fmt: typeof fmt === 'string' ? fmt : fmt(s), body: text ? label(id) : undefined });
    return body + (text ? '' : sp({ id: s.id(), name: 'label', txBox: true, box: [b[0], b[1] + b[3] - 12, b[2], 12], fmt: NOFILL, body: label(id) }));
  });
};
const a = (e: Element | undefined | null, n: string) => at(e ?? null, n);
const gsOf = (e: Element | undefined) => Array.from(kid(kid(e, 'a:gradFill'), 'a:gsLst')?.children ?? []);

// ---------------------------------------------------------------- fills

const fil = mk(itemList('P-FIL', items));
newSlide();
fil('Solid fill', 'supported', '§20.1.8.54 solidFill; Format Shape ▸ Fill ▸ Solid fill', solid('C8553D') + OUT, (e) => a(kid(e, 'a:solidFill/a:srgbClr'), 'val')?.toUpperCase() === 'C8553D', 'pptx-read.ts:2025');
fil('Solid fill theme color Accent 4', 'supported', '§20.1.2.3.29 schemeClr (shown as its color)', `<a:solidFill><a:schemeClr val="accent4"/></a:solidFill>${OUT}`, (e) => a(kid(e, 'a:solidFill/a:schemeClr'), 'val') === 'accent4' || a(kid(e, 'a:solidFill/a:srgbClr'), 'val')?.toUpperCase() === 'F2A541', 'pptx-read.ts:180 colorIn');
fil('Solid fill keeps its theme color reference', 'kept', '§20.1.2.3.29 schemeClr', `<a:solidFill><a:schemeClr val="accent4"/></a:solidFill>${OUT}`, (e) => a(kid(e, 'a:solidFill/a:schemeClr'), 'val') === 'accent4', 'pptx-write.ts:2013 (written as RGB)');
fil('Solid fill theme color Darker 25% (lumMod)', 'kept', '§20.1.2.3.20 lumMod', `<a:solidFill><a:schemeClr val="accent5"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>${OUT}`, (e) => !!kid(e, 'a:solidFill/a:schemeClr/a:lumMod'), 'resolved to RGB');
fil('Solid fill transparency 50%', 'supported', '§20.1.2.3.1 alpha; Fill ▸ Transparency', solid('3A86FF', '<a:alpha val="50000"/>') + OUT, (e) => a(kid(e, 'a:solidFill/a:srgbClr/a:alpha'), 'val') === '50000', 'pptx-read.ts:2031 fillClear');
fil('No fill', 'supported', '§20.1.8.44 noFill; Fill ▸ No fill', NOFILL + OUT, (e) => !!kid(e, 'a:noFill'), 'pptx-read.ts:2620');
fil('Gradient fill linear, two stops, 90°', 'supported', '§20.1.8.33 gradFill, §20.1.8.41 lin; Fill ▸ Gradient fill', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="1B7F79"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' + OUT, (e) => gsOf(e).length === 2 && a(kid(kid(e, 'a:gradFill'), 'a:lin'), 'ang') === '5400000', 'pptx-read.ts:2035');
fil('Gradient fill linear at 45°', 'supported', '§20.1.8.41 lin@ang', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="F2A541"/></a:gs><a:gs pos="100000"><a:srgbClr val="C8553D"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>' + OUT, (e) => a(kid(kid(e, 'a:gradFill'), 'a:lin'), 'ang') === '2700000', 'pptx-read.ts:2042 gradAngle');
fil('Gradient fill stop colors (first and last)', 'supported', '§20.1.8.37 gs', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="F2A541"/></a:gs><a:gs pos="100000"><a:srgbClr val="6A4C93"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>' + OUT, (e) => { const g = gsOf(e); return g.length >= 2 && colorIs(g[0], 'F2A541') && colorIs(g[g.length - 1], '6A4C93'); }, 'pptx-read.ts:2037');
fil('Gradient fill with three stops', 'loss', '§20.1.8.36 gsLst', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="1B7F79"/></a:gs><a:gs pos="50000"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="C8553D"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>' + OUT, (e) => gsOf(e).length === 3, 'pptx-read.ts:2034 (first and last stops only)');
fil('Gradient stop at 30% position', 'loss', '§20.1.8.37 gs@pos', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="30000"><a:srgbClr val="1B7F79"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>' + OUT, (e) => a(gsOf(e)[0], 'pos') === '30000', 'pptx-read.ts:2034');
fil('Gradient stop transparency', 'loss', '§20.1.8.37 gs with alpha', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="3A86FF"><a:alpha val="20000"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="3A86FF"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>' + OUT, (e) => !!gsOf(e)[0]?.getElementsByTagNameNS(NS.a, 'alpha')[0], 'pptx-read.ts:2037');
fil('Gradient radial (path circle)', 'supported', '§20.1.8.46 path circle; Gradient fill ▸ Type Radial', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="6A4C93"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>' + OUT, (e) => a(kid(kid(e, 'a:gradFill'), 'a:path'), 'path') === 'circle', 'pptx-read.ts:2041 gradRadial');
fil('Gradient rectangular (path rect)', 'loss', '§20.1.10.43 ST_PathShadeType rect; Gradient fill ▸ Type Rectangular', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="8AB17D"/></a:gs></a:gsLst><a:path path="rect"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>' + OUT, (e) => a(kid(kid(e, 'a:gradFill'), 'a:path'), 'path') === 'rect', 'pptx-read.ts:2041 (read as radial)');
fil('Gradient path from the shape (path shape)', 'loss', '§20.1.10.43 ST_PathShadeType shape; Gradient fill ▸ Type Path', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="1B7F79"/></a:gs></a:gsLst><a:path path="shape"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>' + OUT, (e) => a(kid(kid(e, 'a:gradFill'), 'a:path'), 'path') === 'shape', 'pptx-read.ts:2041');
fil('Radial gradient from the top-left corner', 'loss', '§20.1.8.31 fillToRect; Gradient fill ▸ Direction From Top Left Corner', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="C8553D"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect r="100000" b="100000"/></a:path></a:gradFill>' + OUT, (e) => a(kid(kid(kid(e, 'a:gradFill'), 'a:path'), 'a:fillToRect'), 'r') === '100000', 'pptx-read.ts:2041');
fil('Gradient rotate with shape off', 'loss', '§20.1.8.33 gradFill@rotWithShape', '<a:gradFill rotWithShape="0"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="3A86FF"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' + OUT, (e) => a(kid(e, 'a:gradFill'), 'rotWithShape') === '0', 'not read');
for (const p of ['pct20', 'dkUpDiag', 'smCheck', 'horz', 'lgConfetti', 'shingle']) {
  fil(`Pattern fill ${p}`, 'loss', `§20.1.8.47 pattFill, §20.1.10.51 ST_PresetPatternVal ${p}; Fill ▸ Pattern fill`, `<a:pattFill prst="${p}"><a:fgClr><a:srgbClr val="1F3A4D"/></a:fgClr><a:bgClr><a:srgbClr val="F2A541"/></a:bgClr></a:pattFill>${OUT}`, (e) => a(kid(e, 'a:pattFill'), 'prst') === p, 'pptx-read.ts:2615 (Patterned fills came in as plain colors)');
}
fil('Pattern fill shown in its foreground color', 'supported', '§20.1.8.47 pattFill fgClr (as a plain color)', `<a:pattFill prst="dkHorz"><a:fgClr><a:srgbClr val="1F3A4D"/></a:fgClr><a:bgClr><a:srgbClr val="F2A541"/></a:bgClr></a:pattFill>${OUT}`, (e) => !!kid(e, 'a:pattFill') || a(kid(e, 'a:solidFill/a:srgbClr'), 'val')?.toUpperCase() === '1F3A4D', 'pptx-read.ts:2616');
newSlide();
fil('Picture fill stretched', 'supported', '§20.1.8.14 blipFill, §20.1.8.56 stretch; Fill ▸ Picture or texture fill', (s) => `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${s.media('fill-stretch.png', PIC)}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>${OUT}`, (e) => !!kid(kid(e, 'a:blipFill'), 'a:blip') && !!kid(kid(e, 'a:blipFill'), 'a:stretch'), 'pptx-read.ts:2050 picFill');
fil('Picture fill with transparency 40%', 'supported', '§20.1.8.4 alphaModFix; Fill ▸ Transparency', (s) => `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${s.media('fill-alpha.png', PIC)}"><a:alphaModFix amt="60000"/></a:blip><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>${OUT}`, (e) => a(kid(kid(e, 'a:blipFill'), 'a:blip/a:alphaModFix'), 'amt') === '60000', 'pptx-read.ts:2016 transparency');
fil('Picture fill tiled as texture', 'loss', '§20.1.8.58 tile; Fill ▸ Tile picture as texture', (s) => `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${s.media('fill-tile.png', PIC)}"/><a:srcRect/><a:tile tx="0" ty="0" sx="40000" sy="40000" flip="xy" algn="tl"/></a:blipFill>${OUT}`, (e) => !!kid(kid(e, 'a:blipFill'), 'a:tile'), 'pptx-read.ts or pptx-write.ts, not traced to a line: blipFill on shapes stretched');
fil('Picture fill with offsets (stretch fillRect)', 'loss', '§20.1.8.30 fillRect; Fill ▸ Offset left/right/top/bottom', (s) => `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${s.media('fill-off.png', PIC)}"/><a:srcRect/><a:stretch><a:fillRect l="10000" t="10000" r="10000" b="10000"/></a:stretch></a:blipFill>${OUT}`, (e) => a(kid(kid(kid(e, 'a:blipFill'), 'a:stretch'), 'a:fillRect'), 'l') === '10000', 'pptx-read.ts or pptx-write.ts, not traced to a line');
fil('Slide background fill (useBgFill)', 'loss', '§19.3.1.43 sp@useBgFill; Fill ▸ Slide background fill', `<a:noFill/>${OUT}`, (_e) => false, 'not read');
// (the shape above is given useBgFill below, when the slides are put together)

// ---------------------------------------------------------------- outlines

const lin = mk(itemList('P-LIN', items));
newSlide();
const lnOf = (e: Element | undefined) => kid(e, 'a:ln');
const ln = (rest = '', w = 3, attrs = '', fill = solid('1F3A4D')) => GREEN + line(w, fill, rest, attrs);
lin('Outline width 4.5 pt', 'supported', '§20.1.2.2.24 ln@w; Format Shape ▸ Line ▸ Width', ln('', 4.5), (e) => a(lnOf(e), 'w') === '57150', 'pptx-read.ts:2052 lineWidth');
lin('Outline color', 'supported', '§20.1.2.2.24 ln solidFill; Shape Outline ▸ color', ln('', 3, '', solid('C8553D')), (e) => a(kid(lnOf(e), 'a:solidFill/a:srgbClr'), 'val')?.toUpperCase() === 'C8553D', 'pptx-read.ts:2626');
lin('No outline', 'supported', '§20.1.8.44 noFill in ln; Shape Outline ▸ No Outline', GREEN + '<a:ln><a:noFill/></a:ln>', (e) => !!kid(lnOf(e), 'a:noFill'), 'pptx-read.ts:2627');
lin('Outline transparency 50%', 'loss', '§20.1.2.3.1 alpha in ln; Line ▸ Transparency', ln('', 3, '', solid('C8553D', '<a:alpha val="50000"/>')), (e) => !!kid(lnOf(e), 'a:solidFill/a:srgbClr/a:alpha'), 'not read');
lin('Gradient line', 'loss', '§20.1.8.33 gradFill in ln; Line ▸ Gradient line', ln('', 4, '', '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="1B7F79"/></a:gs><a:gs pos="100000"><a:srgbClr val="C8553D"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>'), (e) => !!kid(lnOf(e), 'a:gradFill'), 'pptx-read.ts:2626 (line color only)');
lin('Dash type Dash', 'supported', '§20.1.8.48 prstDash dash; Line ▸ Dash type', ln('<a:prstDash val="dash"/>'), (e) => a(kid(lnOf(e), 'a:prstDash'), 'val') === 'dash', 'pptx-read.ts:2630 dashed; pptx-write.ts:2014');
for (const d of ['sysDot', 'sysDash', 'dashDot', 'lgDash', 'lgDashDot', 'lgDashDotDot', 'sysDashDot', 'sysDashDotDot']) {
  lin(`Dash type ${d}`, 'loss', `§20.1.10.49 ST_PresetLineDashVal ${d}; Line ▸ Dash type`, ln(`<a:prstDash val="${d}"/>`), (e) => a(kid(lnOf(e), 'a:prstDash'), 'val') === d, 'pptx-read.ts or pptx-write.ts, not traced to a line: dashes collapse to dash (or sysDot on boxes)');
}
lin('Round Dot on a plain box (no text)', 'supported', '§20.1.10.49 sysDot', ln('<a:prstDash val="sysDot"/>'), (e) => a(kid(lnOf(e), 'a:prstDash'), 'val') === 'sysDot', 'pptx-read.ts:2632 dotted; pptx-write.ts:2143', prst('rect'), false);
lin('Outline width 3 pt on a plain box (no text)', 'loss', '§20.1.2.2.24 ln@w', ln('', 3), (e) => a(lnOf(e), 'w') === '38100', 'pptx-read.ts:1886 (plain box: only a bold flag, set when wider than 1.75 line widths)', prst('rect'), false);
lin('Custom dash (custDash)', 'loss', '§20.1.8.21 custDash', ln('<a:custDash><a:ds d="300000" sp="100000"/><a:ds d="100000" sp="100000"/></a:custDash>'), (e) => !!kid(lnOf(e), 'a:custDash'), 'not read');
lin('Cap type Round', 'loss', '§20.1.2.2.24 ln@cap rnd; Line ▸ Cap type', ln('<a:prstDash val="dash"/>', 4, ' cap="rnd"'), (e) => a(lnOf(e), 'cap') === 'rnd', 'not read');
lin('Cap type Square', 'loss', '§20.1.10.31 ST_LineCap sq', ln('<a:prstDash val="dash"/>', 4, ' cap="sq"'), (e) => a(lnOf(e), 'cap') === 'sq', 'not read');
lin('Join type Round', 'loss', '§20.1.8.52 round; Line ▸ Join type', ln('<a:round/>', 6), (e) => !!kid(lnOf(e), 'a:round'), 'not read: pptx-write.ts:2015 always writes round, so this one survives by chance (the other joins are lost)');
lin('Join type Bevel', 'loss', '§20.1.8.9 bevel (line join)', ln('<a:bevel/>', 6), (e) => !!kid(lnOf(e), 'a:bevel'), 'not read');
lin('Join type Miter', 'loss', '§20.1.8.43 miter', ln('<a:miter lim="800000"/>', 6), (e) => !!kid(lnOf(e), 'a:miter'), 'not read');
lin('Compound type Double', 'loss', '§20.1.10.15 ST_CompoundLine dbl; Line ▸ Compound type', ln('', 6, ' cmpd="dbl"'), (e) => a(lnOf(e), 'cmpd') === 'dbl', 'not read');
lin('Compound type Thick Thin', 'loss', '§20.1.10.15 thickThin', ln('', 6, ' cmpd="thickThin"'), (e) => a(lnOf(e), 'cmpd') === 'thickThin', 'not read');
lin('Compound type Triple', 'loss', '§20.1.10.15 tri', ln('', 6, ' cmpd="tri"'), (e) => a(lnOf(e), 'cmpd') === 'tri', 'not read');
lin('Line alignment inside (algn in)', 'loss', '§20.1.10.39 ST_PenAlignment in', ln('', 6, ' algn="in"'), (e) => a(lnOf(e), 'algn') === 'in', 'not read');
lin('Sketched line (Hand Drawn, a16 ext)', 'loss', 'PowerPoint 365 ask:lineSketchStyleProps; Line ▸ Sketched style', ln(`<a:extLst><a:ext uri="{C807C97D-BFC1-408E-A445-0C87EB9F89A2}"><ask:lineSketchStyleProps xmlns:ask="http://schemas.microsoft.com/office/drawing/2018/sketchyshapes" sd="1219033472"><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><ask:type><ask:lineSketchCurved/></ask:type></ask:lineSketchStyleProps></a:ext></a:extLst>`), (e) => !!kid(lnOf(e), 'a:extLst'), 'not read');

// ---------------------------------------------------------------- effects

const efx = mk(itemList('P-EFX', items));
newSlide();
const fxOf = (e: Element | undefined) => kid(e, 'a:effectLst');
const FX = (inner: string) => GREEN + OUT + `<a:effectLst>${inner}</a:effectLst>`;
efx('Outer shadow Offset: Bottom Right', 'supported', '§20.1.8.49 outerShdw; Shape Effects ▸ Shadow ▸ Outer', FX('<a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw>'), (e) => { const s = kid(fxOf(e), 'a:outerShdw'); return a(s, 'dir') === '2700000' && a(s, 'dist') === '38100' && a(s, 'blurRad') === '50800'; }, 'pptx-read.ts:2150');
efx('Outer shadow color and transparency', 'supported', '§20.1.8.49 outerShdw color, alpha', FX('<a:outerShdw blurRad="76200" dist="76200" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="C8553D"><a:alpha val="60000"/></a:srgbClr></a:outerShdw>'), (e) => { const s = kid(fxOf(e), 'a:outerShdw'); return a(kid(s, 'a:srgbClr'), 'val')?.toUpperCase() === 'C8553D' && a(kid(s, 'a:srgbClr/a:alpha'), 'val') === '60000'; }, 'pptx-read.ts:2158');
efx('Outer shadow size 110% (sx, sy)', 'loss', '§20.1.8.49 outerShdw@sx/@sy; Shadow ▸ Size', FX('<a:outerShdw blurRad="50800" dist="38100" dir="2700000" sx="110000" sy="110000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw>'), (e) => a(kid(fxOf(e), 'a:outerShdw'), 'sx') === '110000', 'pptx-read.ts:2150 (size not read)');
efx('Inner shadow', 'loss', '§20.1.8.40 innerShdw; Shadow ▸ Inner', FX('<a:innerShdw blurRad="63500" dist="50800" dir="13500000"><a:prstClr val="black"><a:alpha val="50000"/></a:prstClr></a:innerShdw>'), (e) => !!kid(fxOf(e), 'a:innerShdw'), 'pptx-read.ts or pptx-write.ts, not traced to a line: innerShdw lost');
efx('Perspective shadow (prstShdw)', 'loss', '§20.1.8.48 prstShdw', FX('<a:prstShdw prst="shdw17" dist="38100" dir="2700000"><a:srgbClr val="000000"/></a:prstShdw>'), (e) => !!kid(fxOf(e), 'a:prstShdw'), 'pptx-read.ts or pptx-write.ts, not traced to a line: prstShdw lost');
efx('Glow 10 pt Accent 4', 'supported', '§20.1.8.32 glow; Shape Effects ▸ Glow', FX('<a:glow rad="127000"><a:srgbClr val="F2A541"><a:alpha val="60000"/></a:srgbClr></a:glow>'), (e) => { const g = kid(fxOf(e), 'a:glow'); return a(g, 'rad') === '127000' && a(kid(g, 'a:srgbClr'), 'val')?.toUpperCase() === 'F2A541'; }, 'pptx-effects.ts:50');
efx('Soft edges 5 pt', 'supported', '§20.1.8.53 softEdge; Shape Effects ▸ Soft Edges', FX('<a:softEdge rad="63500"/>'), (e) => a(kid(fxOf(e), 'a:softEdge'), 'rad') === '63500', 'pptx-effects.ts:55');
efx('Reflection (tight, touching)', 'supported', '§20.1.8.50 reflection; Shape Effects ▸ Reflection', FX('<a:reflection blurRad="6350" stA="52000" endA="300" endPos="35000" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/>'), (e) => !!kid(fxOf(e), 'a:reflection'), 'pptx-effects.ts:57');
efx('Reflection keeps its end transparency (endA)', 'loss', '§20.1.8.50 reflection@endA', FX('<a:reflection blurRad="6350" stA="52000" endA="300" endPos="35000" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/>'), (e) => a(kid(fxOf(e), 'a:reflection'), 'endA') === '300', 'pptx-effects.ts:25 (written endA 0)');
efx('Shadow, glow and soft edges together', 'supported', '§20.1.8.26 effectLst order', FX('<a:glow rad="63500"><a:srgbClr val="3A86FF"><a:alpha val="40000"/></a:srgbClr></a:glow><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw><a:softEdge rad="31750"/>'), (e) => !!kid(fxOf(e), 'a:glow') && !!kid(fxOf(e), 'a:outerShdw') && !!kid(fxOf(e), 'a:softEdge'), 'pptx-effects.ts:16');
efx('Blur', 'loss', '§20.1.8.15 blur', FX('<a:blur rad="38100"/>'), (e) => !!kid(fxOf(e), 'a:blur'), 'not read');
const S3 = (scene: string, sp3d: string) => GREEN + OUT + scene + sp3d;
const CAM = '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>';
efx('Bevel top Circle', 'supported', '§20.1.5.9 sp3d bevelT; Shape Effects ▸ Bevel ▸ Circle', S3(CAM, '<a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d>'), (e) => !!kid(kid(e, 'a:sp3d'), 'a:bevelT'), 'pptx-effects.ts:60');
efx('Bevel top Art Deco (prst artDeco)', 'supported', '§20.1.10.9 ST_BevelPresetType artDeco', S3(CAM, '<a:sp3d><a:bevelT w="76200" h="76200" prst="artDeco"/></a:sp3d>'), (e) => a(kid(kid(e, 'a:sp3d'), 'a:bevelT'), 'prst') === 'artDeco', 'pptx-effects.ts:62 BEVELS');
efx('Bevel bottom', 'loss', '§20.1.5.8 bevelB', S3(CAM, '<a:sp3d><a:bevelB w="63500" h="25400"/></a:sp3d>'), (e) => !!kid(kid(e, 'a:sp3d'), 'a:bevelB'), 'pptx-read.ts or pptx-write.ts, not traced to a line: bevelB lost');
efx('3-D rotation Isometric Left Down (camera)', 'loss', '§20.1.5.5 camera prst; Shape Effects ▸ 3-D Rotation', S3('<a:scene3d><a:camera prst="isometricLeftDown"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>', '<a:sp3d/>'), (e) => a(kid(kid(e, 'a:scene3d'), 'a:camera'), 'prst') === 'isometricLeftDown', 'pptx-read.ts or pptx-write.ts, not traced to a line: scene3d camera lost');
efx('3-D rotation X 20°, Y 30° (camera rot)', 'loss', '§20.1.5.11 rot in camera', S3('<a:scene3d><a:camera prst="perspectiveFront" fov="2700000"><a:rot lat="1800000" lon="1200000" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"/></a:scene3d>', '<a:sp3d/>'), (e) => !!kid(kid(kid(e, 'a:scene3d'), 'a:camera'), 'a:rot'), 'pptx-read.ts or pptx-write.ts, not traced to a line');
efx('Lighting Sunrise', 'loss', '§20.1.5.10 lightRig rig sunrise; 3-D Format ▸ Lighting', S3('<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="sunrise" dir="t"/></a:scene3d>', '<a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d>'), (e) => a(kid(kid(e, 'a:scene3d'), 'a:lightRig'), 'rig') === 'sunrise', 'pptx-read.ts or pptx-write.ts, not traced to a line: light rig lost');
efx('Material Metal', 'loss', '§20.1.10.50 ST_PresetMaterialType metal; 3-D Format ▸ Material', S3(CAM, '<a:sp3d prstMaterial="metal"><a:bevelT w="63500" h="25400"/></a:sp3d>'), (e) => a(kid(e, 'a:sp3d'), 'prstMaterial') === 'metal', 'pptx-read.ts or pptx-write.ts, not traced to a line: material lost');
efx('Depth (extrusion) 10 pt with color', 'loss', '§20.1.5.12 sp3d@extrusionH, extrusionClr', S3('<a:scene3d><a:camera prst="isometricOffAxis1Right"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>', '<a:sp3d extrusionH="127000"><a:extrusionClr><a:srgbClr val="1F3A4D"/></a:extrusionClr></a:sp3d>'), (e) => a(kid(e, 'a:sp3d'), 'extrusionH') === '127000', 'pptx-read.ts or pptx-write.ts, not traced to a line: extrusion lost');
efx('Contour 2 pt', 'loss', '§20.1.5.12 sp3d@contourW, contourClr', S3(CAM, '<a:sp3d contourW="25400"><a:bevelT w="63500" h="25400"/><a:contourClr><a:srgbClr val="C8553D"/></a:contourClr></a:sp3d>'), (e) => a(kid(e, 'a:sp3d'), 'contourW') === '25400', 'pptx-read.ts or pptx-write.ts, not traced to a line');
efx('Effects on a plain box: outer shadow only', 'loss', '§20.1.8.49 outerShdw on a rectangle', FX('<a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw>'), (e) => !!kid(fxOf(e), 'a:outerShdw'), 'pptx-read.ts:112 fancyFill (a shadow alone keeps a plain box, which has no shadow)', prst('rect'), false);

const SLIDE_DEFS: SlideDef[] = slides.map((makers) => ({
  body: (s: SlideCtx) => {
    s.grid(6, Math.max(1, Math.ceil(makers.length / 6)));
    return makers.map((m) => m(s)).join('')
      .replace(/(<p:sp)(><p:nvSpPr><p:cNvPr id="\d+" name="P-FIL-\d+ Slide background fill)/, '$1 useBgFill="1"$2');
  },
}));

// the "useBgFill" item's check reads the attribute (the mk helper checks spPr only)
const bg = items.find((i) => i.feature === 'Slide background fill (useBgFill)')!;
bg.check = (v) => at(namedShape(v, bg.id) ?? null, 'useBgFill') === '1';

export const pptxFormat: Sampler = {
  name: 'pptx-format.pptx', area: 'PowerPoint shape formatting: fills, outlines and effects', items,
  build: () => deckFile({ title: 'PowerPoint sampler: fills, lines and effects', slides: SLIDE_DEFS }),
};
