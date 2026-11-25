/**
 * PowerPoint sampler: slide master, layouts, theme, placeholders and the presentation's own
 * settings (P-MST): slide size, sections, custom shows, Set Up Show, guides, hidden slides,
 * backgrounds, headers and footers, and the parts kept as they are (custom XML, custom
 * properties). ECMA-376 Part 1 §19.2 (presentation), §19.3.1.42 (sldMaster), §19.3.1.39
 * (sldLayout), §20.1.6 (theme); PowerPoint's View ▸ Slide Master, Design ▸ Slide Size and
 * Format Background, Slide Show ▸ Set Up Show and Custom Slide Show, Home ▸ Section.
 *
 * Tags from src/io/pptx-read.ts (readPptx :365, readMaster, readTheme :465), src/deck/show-setup.ts,
 * src/deck/guides.ts, src/io/pptx-background.ts and src/io/kept-parts.ts.
 */
import { type Item, type Sampler, itemList, at, kid, NS, png, esc, XML_HEAD } from './kit';
import {
  deckFile, STD_LAYOUTS, ph, sp, txBody, para, r, solid, prst, line, textBox, pic,
  shapeOf, namedShape, boxOf, slideOrder, slideIndex, layoutOf, partOf, phOf, relTarget, bodyPrOf, rPrOf,
  LAYOUTS, MASTERS, PNS, type LayoutDef, type SlideDef, type SlideCtx,
} from './pptx';

const items: Item[] = [];
const it = itemList('P-MST', items);
type Tag = 'supported' | 'kept' | 'loss';
const add = (feature: string, tag: Tag, spec: string, check: (v: import('./kit').View) => boolean, basis?: string) => it(feature, tag, spec, check, basis);

const P = 'ppt/presentation.xml';
const pres = (v: import('./kit').View) => v.doc(P)?.documentElement;
const theme = (v: import('./kit').View) => {
  const name = v.partsLike(/^ppt\/theme\/theme\d+\.xml$/).find((p) => (v.parts[p] ?? '').includes('clrScheme') && !(v.parts[p] ?? '').includes('Sampler Notes'));
  return name ? v.doc(name)?.documentElement : undefined;
};
const tval = (v: import('./kit').View, path: string) => at(kid(kid(kid(theme(v), 'a:themeElements'), path.split('/')[0]), path.split('/').slice(1).join('/')) ?? null, 'val');

// ---------------------------------------------------------------- layouts

const art = add('Layout art shape (not a placeholder)', 'kept', '§19.3.1.39 sldLayout spTree; View ▸ Slide Master ▸ layout', (v) => !!namedShape(v, art, LAYOUTS), 'pptx-read.ts or pptx-write.ts, not traced to a line: layout art shapes kept as XML (pptx-read.ts:818)');
const custom = add('Custom layout with its own name', 'supported', '§19.3.1.39 sldLayout, cSld@name; Slide Master ▸ Insert Layout ▸ Rename', (v) => (at(kid(layoutOf(v, custom), 'p:cSld') ?? null, 'name') ?? '').includes(custom), 'pptx-read.ts or pptx-write.ts, not traced to a line: custom layouts become LayoutDefs (name)');
const noGfx = add('Layout Hide Background Graphics', 'supported', '§19.3.1.39 sldLayout@showMasterSp; Slide Master ▸ Hide Background Graphics', (v) => at(layoutOf(v, noGfx) ?? null, 'showMasterSp') === '0', 'pptx-read.ts:737');
const mapOvr = add('Layout color map override (dark background)', 'supported', '§19.3.1.6 clrMapOvr overrideClrMapping', (v) => at(kid(kid(layoutOf(v, mapOvr), 'p:clrMapOvr'), 'a:overrideClrMapping') ?? null, 'bg1') === 'dk1', 'pptx-read.ts:750');

const box = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x, y, w, h];
const bodyText = (t: string) => txBody(para(r(t)), '<a:bodyPr/>');
const LAYOUTS_ALL: LayoutDef[] = [
  ...STD_LAYOUTS,
  { name: 'Section Header', type: 'secHead', attrs: ' preserve="1"', shapes: ph(2, 'Title 1', 'type="title"', box(57, 120, 726, 200), bodyText('Click to edit Master title style')) + ph(3, 'Text Placeholder 2', 'type="body" idx="1"', box(57, 330, 726, 100), bodyText('Click to edit Master text styles')) },
  { name: 'Two Content', type: 'twoObj', attrs: ' preserve="1"', shapes: ph(2, 'Title 1', 'type="title"', null, bodyText('Click to edit Master title style')) + ph(3, 'Content Placeholder 2', 'sz="half" idx="1"', box(57, 144, 356, 380), bodyText('Click to edit Master text styles')) + ph(4, 'Content Placeholder 3', 'sz="half" idx="2"', box(428, 144, 356, 380), bodyText('Click to edit Master text styles')) },
  { name: 'Picture with Caption', type: 'picTx', attrs: ' preserve="1"', shapes: ph(2, 'Title 1', 'type="title"', box(57, 40, 280, 120), bodyText('Click to edit Master title style')) + ph(3, 'Picture Placeholder 2', 'type="pic" idx="1"', box(360, 40, 420, 480), bodyText('')) + ph(4, 'Text Placeholder 3', 'type="body" sz="half" idx="2"', box(57, 170, 280, 350), bodyText('Click to edit Master text styles')) },
  { name: `${custom} Sampler Custom Layout`, attrs: ' preserve="1" userDrawn="1"', shapes: ph(2, 'Title 1', 'type="title"', box(200, 30, 580, 80), bodyText('Click to edit Master title style')) + sp({ id: 3, name: `${art} layout art`, box: box(20, 20, 160, 40), geom: prst('rect'), fmt: solid('F2A541') + line(1, solid('C8553D')), body: txBody(para(r(`${art} layout art`, 'sz="1000"')), '<a:bodyPr anchor="ctr"/>') }) },
  { name: `${noGfx} No Master Graphics`, type: 'titleOnly', attrs: ' showMasterSp="0" preserve="1"', shapes: ph(2, 'Title 1', 'type="title"', null, bodyText('Click to edit Master title style')) },
  { name: `${mapOvr} Dark Map`, type: 'obj', attrs: ' preserve="1"', clrMapOvr: '<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>', shapes: ph(2, 'Title 1', 'type="title"', null, bodyText('Click to edit Master title style')) + ph(3, 'Content Placeholder 2', 'idx="1"', null, bodyText('Click to edit Master text styles')) },
];

// ---------------------------------------------------------------- slides

const BG_PIC = png(64, 48, [138, 177, 125]);

const slides: SlideDef[] = [];
const title = (s: SlideCtx, text: string, phAttrs = 'type="title"', b: [number, number, number, number] | null = null, rAttrs = '') => ph(s.id(), `Title ${text.slice(0, 9)}`, phAttrs, b, txBody(para(r(text, rAttrs)), '<a:bodyPr/>'));

// 1 Title Slide
const ctr = add('Title Slide: centered title placeholder', 'supported', '§19.3.1.36 ph type ctrTitle; Home ▸ Layout ▸ Title Slide', (v) => /^(ctrTitle|title)$/.test(at(phOf(shapeOf(v, ctr)) ?? null, 'type') ?? ''), 'pptx-read.ts:274 isTitle');
const ctrType = add('Centered title keeps placeholder type ctrTitle', 'supported', '§19.7.10 ST_PlaceholderType ctrTitle', (v) => at(phOf(shapeOf(v, ctrType)) ?? null, 'type') === 'ctrTitle');
const sub = add('Title Slide: subtitle placeholder', 'supported', '§19.7.10 ST_PlaceholderType subTitle', (v) => at(phOf(shapeOf(v, sub)) ?? null, 'type') === 'subTitle', 'pptx-read.ts:288 phKind subtitle');
const lTitle = add('Slide uses the Title Slide layout', 'supported', '§19.3.1.39 sldLayout@type title', (v) => at(layoutOf(v, lTitle) ?? null, 'type') === 'title', 'pptx-read.ts or pptx-write.ts, not traced to a line: built-in layout types map to known layouts');
slides.push({ layout: 0, body: (s) => title(s, `${ctr} ${ctrType} ${lTitle} Title Slide title`, 'type="ctrTitle"') + ph(s.id(), 'Subtitle 2', 'type="subTitle" idx="1"', null, txBody(para(r(`${sub} subtitle`)), '<a:bodyPr/>')) });

// 2 Title and Content
const t2 = add('Title and Content: title placeholder text', 'supported', '§19.3.1.36 ph type title', (v) => at(phOf(shapeOf(v, t2)) ?? null, 'type') === 'title');
const body = add('Content placeholder with bullet levels 1 to 3', 'supported', '§19.3.1.36 ph idx 1, §21.1.2.2.7 pPr@lvl', (v) => {
  const e = shapeOf(v, body); const lv = e ? Array.from(e.getElementsByTagNameNS(NS.a, 'pPr')).map((p) => at(p, 'lvl') ?? '0') : [];
  return !!phOf(e) && lv.includes('1') && lv.includes('2');
}, 'pptx-read.ts:2714');
const lObj = add('Slide uses the Title and Content layout', 'supported', '§19.3.1.39 sldLayout@type obj', (v) => at(layoutOf(v, lObj) ?? null, 'type') === 'obj');
const inh = add('Placeholder takes its position from the layout (no xfrm of its own)', 'loss', '§19.3.1.36 ph inheritance; §20.1.7.6 xfrm absent', (v) => !kid(kid(shapeOf(v, inh), 'p:spPr'), 'a:xfrm'), 'pptx-read.ts or pptx-write.ts, not traced to a line: placeholders written with explicit xfrm');
slides.push({ layout: 1, body: (s) => title(s, `${t2} ${lObj} ${inh} Title and Content`) + ph(s.id(), 'Content Placeholder 2', 'idx="1"', null, txBody(
  para(r(`${body} first level`)) + para(r('second level'), 'lvl="1"') + para(r('third level'), 'lvl="2"') + para(r('back to first')), '<a:bodyPr/>')) });

// 3 Title Only, placeholder moved and resized, own size and anchor
const moved = add('Placeholder moved and resized on the slide', 'supported', '§20.1.7.6 xfrm on a placeholder', (v) => { const b = boxOf(shapeOf(v, moved)); return !!b && Math.abs(b[0] - 100) < 1 && Math.abs(b[1] - 300) < 1 && Math.abs(b[2] - 500) < 1 && Math.abs(b[3] - 80) < 1; });
const phSz = add('Placeholder text size 20 pt on the slide', 'supported', '§21.1.2.3.9 rPr@sz in a placeholder', (v) => at(rPrOf(v, phSz) ?? null, 'sz') === '2000');
const phAnchor = add('Placeholder bottom anchor on the slide (own bodyPr)', 'loss', '§21.1.2.1.1 bodyPr@anchor on a placeholder', (v) => at(bodyPrOf(v, phAnchor) ?? null, 'anchor') === 'b', 'pptx-read.ts or pptx-write.ts, not traced to a line: placeholder bodyPr rewritten');
slides.push({ layout: 2, body: (s) => ph(s.id(), 'Title 1', 'type="title"', [100, 300, 500, 80], txBody(para(r(`${moved} ${phSz} ${phAnchor} moved title`, 'sz="2000"')), '<a:bodyPr anchor="b"/>')) });

// 4 Section Header
const sec = add('Section Header layout (type secHead)', 'loss', '§19.7.15 ST_SlideLayoutType secHead; Home ▸ Layout ▸ Section Header', (v) => at(layoutOf(v, sec) ?? null, 'type') === 'secHead', 'pptx-read.ts or pptx-write.ts, not traced to a line: other layout types become custom LayoutDefs');
const secName = add('Section Header layout keeps its name', 'loss', '§19.3.1.39 cSld@name', (v) => at(kid(layoutOf(v, secName), 'p:cSld') ?? null, 'name') === 'Section Header', 'pptx-read.ts:1052 layoutId (secHead mapped to the Title Slide layout)');
slides.push({ layout: 4, body: (s) => title(s, `${sec} ${secName} Section Header`) + ph(s.id(), 'Text Placeholder 2', 'type="body" idx="1"', null, txBody(para(r('section header text')), '<a:bodyPr/>')) });

// 5 Two Content
const two = add('Two Content layout', 'supported', '§19.7.15 ST_SlideLayoutType twoObj', (v) => at(layoutOf(v, two) ?? null, 'type') === 'twoObj', 'pptx-read.ts or pptx-write.ts, not traced to a line: twoObj maps to a known layout');
const right = add('Second content placeholder (idx 2) text', 'supported', '§19.3.1.36 ph idx', (v) => !!phOf(shapeOf(v, right)));
slides.push({ layout: 5, body: (s) => title(s, `${two} Two Content`) + ph(s.id(), 'Content Placeholder 2', 'sz="half" idx="1"', null, txBody(para(r('left column')), '<a:bodyPr/>')) + ph(s.id(), 'Content Placeholder 3', 'sz="half" idx="2"', null, txBody(para(r(`${right} right column`)), '<a:bodyPr/>')) });

// 6 Picture with Caption, its picture placeholder filled
const picTx = add('Picture with Caption layout keeps its name', 'supported', '§19.7.15 picTx; Home ▸ Layout ▸ Picture with Caption', (v) => at(kid(layoutOf(v, picTx), 'p:cSld') ?? null, 'name') === 'Picture with Caption', 'pptx-read.ts or pptx-write.ts, not traced to a line: LayoutDefs (pic placeholders)');
const picPh = add('Layout picture placeholder', 'supported', '§19.7.10 ST_PlaceholderType pic', (v) => { const l = layoutOf(v, picPh); return !!l && Array.from(l.getElementsByTagNameNS(NS.p, 'ph')).some((p) => at(p, 'type') === 'pic'); }, 'pptx-read.ts or pptx-write.ts, not traced to a line: pic placeholders');
const picIn = add('Picture placed in a picture placeholder', 'supported', '§19.3.1.37 pic with ph type pic', (v) => { const e = namedShape(v, picIn, undefined, ['pic']); return !!e && !!kid(e, 'p:blipFill'); }, 'pptx-read.ts picture placeholder');
slides.push({ layout: 6, body: (s) => title(s, `${picTx} ${picPh} Picture with Caption`) + pic({ id: s.id(), name: `${picIn} placeholder picture`, rid: s.media('mst-pic.png', png(80, 60)), box: [360, 40, 420, 315], nvPr: '<p:ph type="pic" idx="1"/>', locks: '<a:picLocks noGrp="1" noChangeAspect="1"/>' }) + ph(s.id(), 'Text Placeholder 3', 'type="body" sz="half" idx="2"', null, txBody(para(r('caption text')), '<a:bodyPr/>')) });

// 7 custom layout; 8 layout without master graphics; 9 layout with its own color map
slides.push({ layout: 7, body: (s) => title(s, `${custom} ${art} slide on the custom layout`) });
slides.push({ layout: 8, body: (s) => title(s, `${noGfx} slide on a layout hiding master graphics`) });
slides.push({ layout: 9, body: (s) => title(s, `${mapOvr} slide on a layout with a dark color map`) + ph(s.id(), 'Content Placeholder 2', 'idx="1"', null, txBody(para(r('light text on dark')), '<a:bodyPr/>')) });

// slide-level settings
const lbl = (s: SlideCtx, text: string) => textBox(s.id(), `${text.slice(0, 9)} label`, [40, 40, 600, 60], para(r(text, 'sz="2400"')));
const hidden = add('Hidden slide', 'supported', '§19.3.1.38 sld@show; Slide Show ▸ Hide Slide', (v) => { const p = partOf(v, hidden); return !!p && at(v.doc(p)!.documentElement, 'show') === '0'; }, 'pptx-read.ts:930');
slides.push({ attrs: ' show="0"', body: (s) => lbl(s, `${hidden} hidden slide`) });
const hideBg = add('Slide Hide Background Graphics', 'supported', '§19.3.1.38 sld@showMasterSp; Format Background ▸ Hide background graphics', (v) => { const p = partOf(v, hideBg); return !!p && at(v.doc(p)!.documentElement, 'showMasterSp') === '0'; }, 'pptx-read.ts:928');
slides.push({ attrs: ' showMasterSp="0"', body: (s) => lbl(s, `${hideBg} slide without master graphics`) });
const bgOf = (v: import('./kit').View, id: string) => { const p = partOf(v, id); return p ? kid(kid(kid(v.doc(p)!.documentElement, 'p:cSld'), 'p:bg'), 'p:bgPr') : undefined; };
const bgSolid = add('Slide background solid fill', 'supported', '§19.3.1.1 bg, §19.3.1.2 bgPr solidFill; Format Background ▸ Solid fill', (v) => at(kid(bgOf(v, bgSolid), 'a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'DCEBF5', 'pptx-background.ts');
slides.push({ bg: `<p:bg><p:bgPr>${solid('DCEBF5')}<a:effectLst/></p:bgPr></p:bg>`, body: (s) => lbl(s, `${bgSolid} solid background`) });
const bgTrans = add('Slide background solid fill with transparency', 'supported', '§20.1.2.3.1 alpha in bgPr; Format Background ▸ Transparency', (v) => at(kid(bgOf(v, bgTrans), 'a:solidFill/a:srgbClr/a:alpha') ?? null, 'val') === '50000', 'pptx-background.ts:13');
slides.push({ bg: `<p:bg><p:bgPr>${solid('6A4C93', '<a:alpha val="50000"/>')}<a:effectLst/></p:bgPr></p:bg>`, body: (s) => lbl(s, `${bgTrans} see-through background`) });
const bgLin = add('Slide background linear gradient, three stops at 45°', 'supported', '§20.1.8.33 gradFill, §20.1.8.41 lin; Format Background ▸ Gradient fill', (v) => { const g = kid(bgOf(v, bgLin), 'a:gradFill'); return (kid(g, 'a:gsLst')?.children.length ?? 0) === 3 && at(kid(g, 'a:lin') ?? null, 'ang') === '2700000'; }, 'pptx-background.ts:26');
slides.push({ bg: '<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="1B7F79"/></a:gs><a:gs pos="50000"><a:srgbClr val="F2A541"/></a:gs><a:gs pos="100000"><a:srgbClr val="C8553D"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>', body: (s) => lbl(s, `${bgLin} linear gradient background`) });
const bgRad = add('Slide background radial gradient from center', 'supported', '§20.1.8.46 path circle, fillToRect', (v) => at(kid(kid(bgOf(v, bgRad), 'a:gradFill'), 'a:path') ?? null, 'path') === 'circle', 'pptx-background.ts:30');
slides.push({ bg: '<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="3A86FF"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill><a:effectLst/></p:bgPr></p:bg>', body: (s) => lbl(s, `${bgRad} radial gradient background`) });
const bgPic = add('Slide background picture stretched', 'supported', '§20.1.8.14 blipFill, §20.1.8.56 stretch; Format Background ▸ Picture or texture fill', (v) => { const b = kid(bgOf(v, bgPic), 'a:blipFill'); return !!kid(b, 'a:blip') && !!kid(b, 'a:stretch'); }, 'pptx-background.ts:36');
slides.push({ bg: (s) => `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${s.media('bg-pic.png', BG_PIC)}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`, body: (s) => lbl(s, `${bgPic} picture background`) });
const bgTile = add('Slide background picture tiled', 'supported', '§20.1.8.58 tile; Format Background ▸ Tile picture as texture', (v) => !!kid(kid(bgOf(v, bgTile), 'a:blipFill'), 'a:tile'), 'pptx-background.ts:40');
slides.push({ bg: (s) => `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${s.media('bg-tile.png', BG_PIC)}"/><a:srcRect/><a:tile tx="0" ty="0" sx="50000" sy="50000" flip="none" algn="tl"/></a:blipFill><a:effectLst/></p:bgPr></p:bg>`, body: (s) => lbl(s, `${bgTile} tiled picture background`) });
const bgPat = add('Slide background pattern (Large grid)', 'supported', '§20.1.8.47 pattFill lgGrid; Format Background ▸ Pattern fill', (v) => at(kid(bgOf(v, bgPat), 'a:pattFill') ?? null, 'prst') === 'lgGrid', 'pptx-background.ts:48');
slides.push({ bg: '<p:bg><p:bgPr><a:pattFill prst="lgGrid"><a:fgClr><a:srgbClr val="8AB17D"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill><a:effectLst/></p:bgPr></p:bg>', body: (s) => lbl(s, `${bgPat} pattern background`) });
const bgRef = add('Slide background from the theme (Background Styles, bgRef 1003)', 'loss', '§19.3.1.3 bgRef; Design ▸ Variants ▸ Background Styles', (v) => { const p = partOf(v, bgRef); return !!p && !!kid(kid(kid(v.doc(p)!.documentElement, 'p:cSld'), 'p:bg'), 'p:bgRef'); }, 'pptx-background.ts (theme background read as its fill)');
slides.push({ bg: '<p:bg><p:bgRef idx="1003"><a:schemeClr val="accent1"/></p:bgRef></p:bg>', body: (s) => lbl(s, `${bgRef} theme background style`) });
const sMap = add('Slide color map override', 'loss', '§19.3.1.6 clrMapOvr on a slide', (v) => { const p = partOf(v, sMap); return !!p && !!kid(kid(v.doc(p)!.documentElement, 'p:clrMapOvr'), 'a:overrideClrMapping'); }, 'pptx-read.ts:750 (read; written as masterClrMapping)');
slides.push({ clrMapOvr: '<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>', body: (s) => lbl(s, `${sMap} slide with its own color map`) });
const cname = add('Slide name (cSld name)', 'loss', '§19.3.1.16 cSld@name', (v) => { const p = partOf(v, cname); return !!p && (at(kid(v.doc(p)!.documentElement, 'p:cSld') ?? null, 'name') ?? '') === 'Named slide'; }, 'not modelled');
slides.push({ name: 'Named slide', body: (s) => lbl(s, `${cname} named slide`) });

// header and footer placeholders on a slide
const ftr = add('Footer placeholder text on a slide', 'supported', '§19.7.10 ph type ftr; Insert ▸ Header & Footer ▸ Footer', (v) => at(phOf(shapeOf(v, ftr)) ?? null, 'type') === 'ftr', 'pptx-read.ts or pptx-write.ts, not traced to a line: dt/ftr/sldNum regenerated from master settings');
const sldNum = add('Slide number placeholder on a slide', 'supported', '§19.7.10 ph type sldNum; Insert ▸ Header & Footer ▸ Slide number', (v) => { const p = partOf(v, sldNum); return !!p && v.inPart(p, 'p:ph').some((x) => at(x, 'type') === 'sldNum'); }, 'pptx-read.ts or pptx-write.ts, not traced to a line');
const dt = add('Date placeholder (fixed date text) on a slide', 'supported', '§19.7.10 ph type dt; Header & Footer ▸ Date and time ▸ Fixed', (v) => { const p = partOf(v, dt); return !!p && v.inPart(p, 'p:ph').some((x) => at(x, 'type') === 'dt'); }, 'pptx-read.ts or pptx-write.ts, not traced to a line');
slides.push({ layout: 1, body: (s) => title(s, `${sldNum} ${dt} header and footer`)
  + ph(s.id(), 'Date Placeholder 3', 'type="dt" sz="half" idx="10"', null, txBody(para(r('March 3, 2026')), '<a:bodyPr/>'))
  + ph(s.id(), 'Footer Placeholder 4', 'type="ftr" sz="quarter" idx="11"', null, txBody(para(r(`${ftr} footer text`)), '<a:bodyPr/>'))
  + ph(s.id(), 'Slide Number Placeholder 5', 'type="sldNum" sz="quarter" idx="12"', null, txBody('<a:p><a:fld id="{9C2C5E43-4A55-4E46-8A8B-6D2F35D7C002}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld></a:p>', '<a:bodyPr/>')) });

// ---------------------------------------------------------------- master and theme

const mArt = add('Slide master art shape (logo box on every slide)', 'kept', '§19.3.1.42 sldMaster spTree; View ▸ Slide Master', (v) => !!namedShape(v, mArt, MASTERS), 'pptx-read.ts or pptx-write.ts, not traced to a line: master art kept as XML (pptx-read.ts:818)');
const mBg = add('Slide master background solid fill', 'supported', '§19.3.1.1 bg on sldMaster; Slide Master ▸ Background Styles', (v) => { const m = v.partsLike(MASTERS)[0]; return !!m && at(kid(kid(kid(kid(v.doc(m)!.documentElement, 'p:cSld'), 'p:bg'), 'p:bgPr'), 'a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'FBFAF5'; }, 'pptx-background.ts');
const tStyle = add('Master title style 40 pt bold', 'supported', '§19.3.1.49 titleStyle lvl1pPr defRPr', (v) => { const m = v.partsLike(MASTERS)[0]; const d = m ? v.doc(m)!.documentElement.getElementsByTagNameNS(NS.p, 'titleStyle')[0] : undefined; const rp = kid(kid(d, 'a:lvl1pPr'), 'a:defRPr'); return at(rp ?? null, 'sz') === '4000' && at(rp ?? null, 'b') === '1'; }, 'pptx-read.ts or pptx-write.ts, not traced to a line: txStyles lvl1 title/body font, size, bold, color read');
const bStyle = add('Master body style level 2 at 23 pt', 'loss', '§19.3.1.5 bodyStyle lvl2pPr', (v) => { const m = v.partsLike(MASTERS)[0]; const d = m ? v.doc(m)!.documentElement.getElementsByTagNameNS(NS.p, 'bodyStyle')[0] : undefined; return at(kid(kid(d, 'a:lvl2pPr'), 'a:defRPr') ?? null, 'sz') === '2300'; }, 'pptx-read.ts or pptx-write.ts, not traced to a line: other levels lost');
const accent = add('Theme color Accent 1', 'supported', '§20.1.4.1.9 clrScheme accent1; Design ▸ Variants ▸ Colors', (v) => tval(v, 'a:clrScheme/a:accent1/a:srgbClr')?.toUpperCase() === '1B7F79', 'pptx-read.ts:465 readTheme');
const hl = add('Theme color Hyperlink', 'supported', '§20.1.4.1.19 hlink', (v) => tval(v, 'a:clrScheme/a:hlink/a:srgbClr')?.toUpperCase() === '0B5FA5');
const major = add('Theme Headings font Georgia', 'supported', '§20.1.4.1.24 majorFont; Design ▸ Variants ▸ Fonts', (v) => at(kid(kid(kid(theme(v), 'a:themeElements'), 'a:fontScheme'), 'a:majorFont/a:latin') ?? null, 'typeface') === 'Georgia');
const minor = add('Theme Body font Calibri', 'supported', '§20.1.4.1.25 minorFont', (v) => at(kid(kid(kid(theme(v), 'a:themeElements'), 'a:fontScheme'), 'a:minorFont/a:latin') ?? null, 'typeface') === 'Calibri');
const tName = add('Theme name', 'kept', '§20.1.6.9 theme@name', (v) => at(theme(v) ?? null, 'name') === 'Sampler', 'pptx-read.ts or pptx-write.ts, not traced to a line: theme part kept whole');
const fmt = add('Theme effect style with shadow (format scheme)', 'kept', '§20.1.4.1.12 effectStyleLst', (v) => !!theme(v)?.getElementsByTagNameNS(NS.a, 'effectStyleLst')[0]?.getElementsByTagNameNS(NS.a, 'outerShdw')[0], 'pptx-read.ts or pptx-write.ts, not traced to a line: theme part kept whole');

// ---------------------------------------------------------------- presentation settings

const size = add('Slide size A4 Paper', 'supported', '§19.2.1.39 sldSz; Design ▸ Slide Size ▸ Custom Slide Size', (v) => at(kid(pres(v), 'p:sldSz') ?? null, 'cx') === '10692000' && at(kid(pres(v), 'p:sldSz') ?? null, 'cy') === '7560000', 'pptx-read.ts:376');
const sizeType = add('Slide size type A4', 'supported', '§19.7.20 ST_SlideSizeType A4', (v) => at(kid(pres(v), 'p:sldSz') ?? null, 'type') === 'A4', 'deck.ts:54 SLIDE_SIZE_TYPES');
const notesSz = add('Notes page size Letter', 'loss', '§19.2.1.22 notesSz; Slide Size ▸ Notes, Handouts & Outline', (v) => at(kid(pres(v), 'p:notesSz') ?? null, 'cx') === '7772400', 'pptx-read.ts or pptx-write.ts, not traced to a line: notesSz rewritten');
const first = add('Number slides from 5', 'loss', '§19.2.1.26 presentation@firstSlideNum; Slide Size ▸ Number slides from', (v) => at(pres(v) ?? null, 'firstSlideNum') === '5', 'not read');
const secs = add('Sections with names', 'supported', 'p14:sectionLst (PowerPoint 2010); Home ▸ Section ▸ Add Section', (v) => { const n = Array.from(pres(v)?.getElementsByTagNameNS(NS.p14, 'section') ?? []).map((x) => at(x, 'name') ?? ''); return n.some((x) => x.includes(secs)) && n.some((x) => x.includes('Backgrounds')); }, 'pptx-read.ts:3222 readSections');
const secMem = add('Section membership: Backgrounds section starts at the hidden slide', 'supported', 'p14:section sldIdLst', (v) => {
  const s = Array.from(pres(v)?.getElementsByTagNameNS(NS.p14, 'section') ?? []).find((x) => (at(x, 'name') ?? '').includes('Backgrounds'));
  const ids = s ? Array.from(s.getElementsByTagNameNS(NS.p14, 'sldId')).map((x) => at(x, 'id')) : [];
  const order = slideOrder(v); const k = slideIndex(v, hidden);
  return k >= 0 && ids[0] === order[k].sldId && ids.length === order.length - k;
}, 'pptx-read.ts:3222');
const show = add('Custom show (slides 3 then 1)', 'supported', '§19.2.1.6 custShow; Slide Show ▸ Custom Slide Show', (v) => {
  const c = Array.from(kid(pres(v), 'p:custShowLst')?.children ?? []).find((x) => (at(x, 'name') ?? '').includes(show));
  const t = c ? Array.from(kid(c, 'p:sldLst')?.children ?? []).map((x) => relTarget(v, P, at(x, 'r:id') ?? '')) : [];
  const o = slideOrder(v).map((x) => x.part);
  return t.length === 2 && t[0] === o[2] && t[1] === o[0];
}, 'show-setup.ts:110 readCustShows');
const kiosk = add('Set Up Show: Browsed at a kiosk', 'supported', '§19.2.1.18 kiosk in showPr; Slide Show ▸ Set Up Show', (v) => !!v.doc('ppt/presProps.xml')?.documentElement.getElementsByTagNameNS(NS.p, 'kiosk')[0], 'show-setup.ts:77 readShowPr');
const range = add('Set Up Show: slides 2 to 5', 'supported', '§19.2.1.36 sldRg', (v) => { const g = v.doc('ppt/presProps.xml')?.documentElement.getElementsByTagNameNS(NS.p, 'sldRg')[0]; return at(g ?? null, 'st') === '2' && at(g ?? null, 'end') === '5'; }, 'show-setup.ts:77');
const guides = add('Drawing guides (one vertical, one horizontal)', 'supported', 'p15:sldGuideLst (PowerPoint 2013); View ▸ Guides', (v) => { const g = Array.from(pres(v)?.getElementsByTagNameNS(PNS.p15, 'guide') ?? []); return g.some((x) => at(x, 'orient') === 'horz' && at(x, 'pos') === '2160') && g.some((x) => at(x, 'orient') !== 'horz' && at(x, 'pos') === '1680'); }, 'guides.ts:114 readSlideGuides');
const grid = add('Grid spacing 0.1 in', 'supported', '§19.2.1.17 gridSpacing; View ▸ Grid Settings', (v) => at(v.doc('ppt/viewProps.xml')?.documentElement.getElementsByTagNameNS(NS.p, 'gridSpacing')[0] ?? null, 'cx') === '91440', 'guides.ts:128 readViewProps');
const dts = add('Default text style level 1 at 20 pt', 'loss', '§19.2.1.8 defaultTextStyle', (v) => at(kid(kid(kid(pres(v), 'p:defaultTextStyle'), 'a:lvl1pPr'), 'a:defRPr') ?? null, 'sz') === '2000', 'pptx-read.ts or pptx-write.ts, not traced to a line: regenerated');
const tags = add('Presentation tags (custDataLst)', 'loss', '§19.3.1.17 custDataLst, §19.3.3.2 tag', (v) => Object.values(v.parts).some((x) => x.includes(`val="${tags}"`)), 'pptx-read.ts or pptx-write.ts, not traced to a line: foreign p:tags dropped');
const cxml = add('Custom XML part', 'kept', 'ECMA-376 Part 1 §22.5 custom XML data storage', (v) => Object.entries(v.parts).some(([n, x]) => /^customXml\/item\d+\.xml$/.test(n) && x.includes(cxml)), 'kept-parts.ts:134');
const cprop = add('Custom document property', 'kept', '§22.3 custom properties; File ▸ Info ▸ Properties ▸ Advanced ▸ Custom', (v) => (v.parts['docProps/custom.xml'] ?? '').includes(cprop), 'kept-parts.ts:153');
const core = add('Document title (core properties)', 'kept', 'Part 2 §11 core properties dc:title; File ▸ Info ▸ Title', (v) => (v.parts['docProps/core.xml'] ?? '').includes(core), 'pptx-read.ts or pptx-write.ts, not traced to a line: core props copied');

const tx = (lvl2 = 2300) => `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4000" b="1" kern="1200"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>`
  + '<p:bodyStyle>' + [[1, 228600, 2800], [2, 685800, lvl2], [3, 1143000, 2000]].map(([n, m, z]) => `<a:lvl${n}pPr marL="${m}" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="${z}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`).join('') + '</p:bodyStyle>'
  + '<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:otherStyle></p:txStyles>';


/** Items with nothing of their own to show on a slide: listed on the last slide, so their ids are in the file. */
const INDEX = items.filter((i) => [tStyle, bStyle, accent, hl, major, minor, tName, fmt, size, sizeType, notesSz, first, secs, secMem, kiosk, range, guides, grid, dts, mBg, tags, cxml, cprop, core, show].includes(i.id)).map((i) => [i.id, i.feature]);

export const pptxMasters: Sampler = {
  name: 'pptx-masters.pptx', area: 'PowerPoint slide master, layouts, theme, placeholders, backgrounds and presentation settings', items,
  build: () => {
    return deckFile({
      title: `PowerPoint sampler: masters ${core}`,
      size: { cx: 10692000, cy: 7560000, type: 'A4' },
      notesSz: { cx: 7772400, cy: 10058400 },
      presAttrs: ` firstSlideNum="5" saveSubsetFonts="1"`,
      layouts: LAYOUTS_ALL,
      slides: [...slides, { body: (s) => textBox(s.id(), 'settings index', [30, 30, 780, 540], INDEX.map(([id, f]) => para(r(`${id} ${f}`, 'sz="1100"'))).join(''), '<a:bodyPr wrap="square" numCol="2"><a:normAutofit/></a:bodyPr>') }],
      masterArt: sp({ id: 20, name: `${mArt} master art`, box: [740, 545, 90, 40], geom: prst('roundRect'), fmt: solid('6A4C93'), body: txBody(para(r(`${mArt} master`, 'sz="900"'), 'algn="ctr"'), '<a:bodyPr anchor="ctr"/>') }),
      masterBg: `<p:bg><p:bgPr>${solid('FBFAF5')}<a:effectLst/></p:bgPr></p:bg>`,
      txStyles: tx(),
      defaultTextStyle: '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle>',
      custShows: (rids) => `<p:custShowLst><p:custShow name="${show} Short show" id="0"><p:sldLst><p:sld r:id="${rids[2]}"/><p:sld r:id="${rids[0]}"/></p:sldLst></p:custShow></p:custShowLst>`,
      presExt: (ids) => {
        const k = slides.findIndex((d) => d.attrs === ' show="0"');
        const sec = (name: string, guid: string, list: number[]) => `<p14:section name="${esc(name)}" id="${guid}"><p14:sldIdLst>${list.map((i) => `<p14:sldId id="${i}"/>`).join('')}</p14:sldIdLst></p14:section>`;
        return `<p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="${NS.p14}">${sec(`${secs} Layouts`, '{0F1E2D3C-4B5A-4978-8695-A4B3C2D1E0F1}', ids.slice(0, k))}${sec('Backgrounds', '{1F2E3D4C-5B6A-4978-8695-A4B3C2D1E0F2}', ids.slice(k))}</p14:sectionLst></p:ext>`
          + `<p:ext uri="{EFAFB233-063F-42B5-8137-9DF3F51BA10A}"><p15:sldGuideLst xmlns:p15="${PNS.p15}"><p15:guide id="1" orient="horz" pos="2160"><p15:clr><a:srgbClr val="A4A3A4"/></p15:clr></p15:guide><p15:guide id="2" pos="1680"><p15:clr><a:srgbClr val="A4A3A4"/></p15:clr></p15:guide></p15:sldGuideLst></p:ext>`;
      },
      presTags: `<p:tag name="SAMPLER_ID" val="${tags}"/>`,
      presProps: '<p:showPr loop="1" showNarration="1"><p:kiosk/><p:sldRg st="2" end="5"/></p:showPr>',
      viewProps: '<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr snapToGrid="0"><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst><p:guide orient="horz" pos="2160"/><p:guide pos="1680"/></p:guideLst></p:cSldViewPr></p:slideViewPr><p:gridSpacing cx="91440" cy="91440"/>',
      extra: (pkg) => {
        // custom XML and its properties
        pkg.add('customXml/item1.xml', `${XML_HEAD}<sampler xmlns="urn:chemweave:sampler">${cxml}</sampler>`);
        pkg.add('customXml/itemProps1.xml', `${XML_HEAD}<ds:datastoreItem ds:itemID="{6C1F6A2E-9B1D-4E8C-A1E2-3F4B5C6D7E80}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>`, 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml');
        pkg.rel('customXml/item1.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps', 'itemProps1.xml');
        pkg.rel(P, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml', '../customXml/item1.xml');
        // custom document properties
        pkg.add('docProps/custom.xml', `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="SamplerId"><vt:lpwstr>${cprop}</vt:lpwstr></property></Properties>`, 'application/vnd.openxmlformats-officedocument.custom-properties+xml');
        pkg.rel('', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties', 'docProps/custom.xml');
      },
    });
  },
};
