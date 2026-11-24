/**
 * PowerPoint sampler: the slide show (P-TRN transitions, P-ANI animations, P-NOT speaker notes,
 * P-CMT comments). ECMA-376 Part 1 §19.3.1.50 (transition and its kinds §19.7.x), PowerPoint
 * 2010 and later transitions (p14, p15, p159 under mc:AlternateContent, with a Fade for older
 * programs), §19.5 (animation: timing, cTn, bldLst), §19.3.1.26 (notes), §19.4 (comments) and
 * PowerPoint 365's modern comments (p188); PowerPoint's Transitions and Animations tabs,
 * the Notes pane, Review ▸ New Comment.
 *
 * Tags from src/deck/animation.ts readTransition (:663: Fade, Push, Wipe, Cover, Morph; the
 * others come in as Fade) and readTiming (:846: Appear, Fly, Fade, Wipe; Pulse, Grow, Spin,
 * Transparency, colour changes; motion paths, triggers, by paragraph), src/io/pptx-read.ts notes()
 * (:1073) and src/io/pptx-comments.ts.
 */
import { type Item, type Sampler, type View, itemList, at, kid, NS, REL, esc, wav, XML_HEAD } from './kit';
import { deckFile, textBox, para, r, sp, prst, solid, txBody, partOf, NOTES, SLIDES, PNS, RELP, CTP, type SlideCtx, type SlideDef } from './pptx';

const items: Item[] = [];
type Tag = 'supported' | 'kept' | 'loss';
const slides: SlideDef[] = [];
const MC = NS.mc;
const P159 = PNS.p159;

const title = (s: SlideCtx, text: string) => textBox(s.id(), 'label', [40, 30, 860, 60], para(r(text, 'sz="2400"')), '<a:bodyPr wrap="square"><a:noAutofit/></a:bodyPr>');
const rootOf = (v: View, id: string) => { const p = partOf(v, id); return p ? v.doc(p)!.documentElement : undefined; };

// ---------------------------------------------------------------- transitions

const tr = itemList('P-TRN', items);
/** Every p:transition on the slide holding `id` (in mc:Choice and mc:Fallback alike). */
const trans = (v: View, id: string) => Array.from(rootOf(v, id)?.getElementsByTagNameNS(NS.p, 'transition') ?? []);
const kindIn = (v: View, id: string, ns: string, local: string) => trans(v, id).some((t) => Array.from(t.children).some((c) => c.namespaceURI === ns && c.localName === local));
/** A transition slide: `xml` is the slide's transition (with its AlternateContent). */
const tslide = (feature: string, tag: Tag, spec: string, xml: string | ((s: SlideCtx) => string), check: (v: View, id: string) => boolean, basis?: string) => {
  const id = tr(feature, tag, spec, (v) => check(v, id), basis);
  slides.push({ transition: xml, body: (s) => title(s, `${id} Transition: ${feature}`) });
};
const p14 = (inner: string, attrs = ' spd="slow" p14:dur="1250"') => `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${NS.p14}" Requires="p14"><p:transition${attrs}>${inner}</p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
const plain = (inner: string, attrs = ' spd="med"') => `<p:transition${attrs}>${inner}</p:transition>`;
tslide('Fade', 'supported', '§19.3.1.24 fade; Transitions ▸ Fade', p14('<p:fade/>'), (v, id) => kindIn(v, id, NS.p, 'fade'), 'animation.ts:675');
tslide('Fade Through Black', 'loss', '§19.3.1.24 fade@thruBlk', p14('<p:fade thruBlk="1"/>'), (v, id) => trans(v, id).some((t) => at(kid(t, 'p:fade') ?? null, 'thruBlk') === '1'), 'animation.ts:656 (written as plain fade)');
tslide('Push From Right', 'supported', '§19.3.1.40 push dir; Transitions ▸ Push ▸ Effect Options', p14('<p:push dir="r"/>'), (v, id) => trans(v, id).some((t) => at(kid(t, 'p:push') ?? null, 'dir') === 'r'), 'animation.ts:677');
tslide('Wipe From Top', 'supported', '§19.3.1.53 wipe dir', p14('<p:wipe dir="u"/>'), (v, id) => trans(v, id).some((t) => at(kid(t, 'p:wipe') ?? null, 'dir') === 'u'), 'animation.ts:677');
tslide('Cover From Bottom', 'supported', '§19.3.1.12 cover dir', p14('<p:cover dir="u"/>'), (v, id) => trans(v, id).some((t) => !!kid(t, 'p:cover')), 'animation.ts:677');
tslide('Morph', 'supported', 'p159:morph (PowerPoint 2019); Transitions ▸ Morph', `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p159="${P159}" xmlns:p14="${NS.p14}" Requires="p159"><p:transition spd="slow" p14:dur="2000"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`, (v, id) => kindIn(v, id, P159, 'morph'), 'animation.ts:676');
tslide('Duration 2.00 s', 'supported', 'p14:dur on transition; Transitions ▸ Duration', p14('<p:fade/>', ' spd="slow" p14:dur="2000"'), (v, id) => trans(v, id).some((t) => t.getAttributeNS(NS.p14, 'dur') === '2000'), 'animation.ts:666');
tslide('Speed Slow (no duration of its own)', 'supported', '§19.3.1.50 transition@spd', plain('<p:fade/>', ' spd="slow"'), (v, id) => trans(v, id).some((t) => at(t, 'spd') === 'slow'), 'animation.ts:668');
tslide('Advance Slide After 5 s', 'supported', '§19.3.1.50 transition@advTm; Transitions ▸ After', p14('<p:fade/>', ' spd="med" p14:dur="700" advTm="5000"'), (v, id) => trans(v, id).some((t) => at(t, 'advTm') === '5000'), 'animation.ts:669');
tslide('Advance On Mouse Click off', 'loss', '§19.3.1.50 transition@advClick', p14('<p:fade/>', ' spd="med" p14:dur="700" advClick="0" advTm="3000"'), (v, id) => trans(v, id).some((t) => at(t, 'advClick') === '0'), 'inventory: advClick lost');
tslide('Transition sound', 'loss', '§19.3.1.47 sndAc; Transitions ▸ Sound', (s) => p14(`<p:fade/><p:sndAc><p:stSnd><p:snd r:embed="${s.media('chime.wav', wav(200), REL.audio)}" name="chime.wav"/></p:stSnd></p:sndAc>`), (v, id) => trans(v, id).some((t) => !!kid(t, 'p:sndAc')), 'inventory: sndAc lost');
for (const [k, inner] of [['split', '<p:split orient="vert" dir="out"/>'], ['blinds', '<p:blinds dir="vert"/>'], ['checker', '<p:checker/>'], ['circle', '<p:circle/>'], ['dissolve', '<p:dissolve/>'], ['comb', '<p:comb/>'], ['cut', '<p:cut/>'], ['zoom', '<p:zoom/>'], ['wheel', '<p:wheel spokes="4"/>'], ['randomBar', '<p:randomBar/>'], ['newsflash', '<p:newsflash/>'], ['plus', '<p:plus/>'], ['strips', '<p:strips dir="rd"/>'], ['wedge', '<p:wedge/>'], ['pull', '<p:pull dir="l"/>'], ['random', '<p:random/>'], ['diamond', '<p:diamond/>']] as const) {
  tslide(`Transition ${k}`, 'loss', `§19.3.1 ${k} (ECMA-376 transition)`, p14(inner), (v, id) => kindIn(v, id, NS.p, k), 'animation.ts:681 (imported as Fade)');
}
for (const [k, inner] of [['vortex', '<p14:vortex dir="r"/>'], ['ripple', '<p14:ripple/>'], ['honeycomb', '<p14:honeycomb/>'], ['glitter', '<p14:glitter pattern="hexagon"/>'], ['shred', '<p14:shred/>'], ['flash', '<p14:flash/>'], ['reveal', '<p14:reveal/>'], ['doors', '<p14:doors dir="vert"/>'], ['window', '<p14:window dir="vert"/>'], ['ferris', '<p14:ferris dir="l"/>'], ['conveyor', '<p14:conveyor dir="l"/>'], ['pan', '<p14:pan dir="u"/>'], ['gallery', '<p14:gallery dir="l"/>'], ['flythrough', '<p14:flythrough/>'], ['prism', '<p14:prism/>'], ['switch', '<p14:switch dir="r"/>'], ['flip', '<p14:flip dir="r"/>'], ['warp', '<p14:warp dir="in"/>'], ['wheelReverse', '<p14:wheelReverse spokes="1"/>']] as const) {
  tslide(`Transition ${k} (PowerPoint 2010)`, 'loss', `p14:${k}; Transitions ▸ Exciting`, p14(inner), (v, id) => kindIn(v, id, NS.p14, k), 'animation.ts:681 (imported as Fade)');
}
for (const k of ['curtains', 'wind', 'fallOver', 'drape', 'fracture', 'crush', 'peelOff', 'pageCurlDouble', 'airplane', 'origami']) {
  tslide(`Transition ${k} (PowerPoint 2013, prstTrans)`, 'loss', `p15:prstTrans prst="${k}"`, `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p15="${PNS.p15}" Requires="p15"><p:transition spd="slow" p14:dur="2000" xmlns:p14="${NS.p14}"><p15:prstTrans prst="${k}"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`, (v, id) => trans(v, id).some((t) => at(kid(t, 'p15:prstTrans') ?? Array.from(t.children).find((c) => c.localName === 'prstTrans') ?? null, 'prst') === k), 'animation.ts:681');
}

// ---------------------------------------------------------------- animations

const an = itemList('P-ANI', items);
interface Eff { id: string; cls: 'entr' | 'exit' | 'emph' | 'path'; preset: number; sub?: number; node?: 'clickEffect' | 'withEffect' | 'afterEffect'; delay?: number; dur?: number; extra?: string; para?: number; bhvr: (spid: number, ids: () => number, tgt: string) => string }
/** The timing tree for these effects (each on its own shape `spid`), one click (or with/after) each. */
function timing(effs: (Eff & { spid: number })[], triggers: { spid: number; on: number; eff: Eff }[] = [], paras = new Set<number>()): string {
  let n = 2;
  const ids = () => ++n;
  const tgt = (spid: number, p?: number) => `<p:tgtEl><p:spTgt spid="${spid}"${p === undefined ? '/>' : `><p:txEl><p:pRg st="${p}" end="${p}"/></p:txEl></p:spTgt>`}</p:tgtEl>`;
  const effect = (e: Eff & { spid: number }, node: string) => `<p:par><p:cTn id="${ids()}" presetID="${e.preset}" presetClass="${e.cls}" presetSubtype="${e.sub ?? 0}"${e.extra ?? ''} fill="hold" grpId="0" nodeType="${node}"><p:stCondLst><p:cond delay="${e.delay ?? 0}"/></p:stCondLst><p:childTnLst>${e.bhvr(e.spid, ids, tgt(e.spid, e.para))}</p:childTnLst></p:cTn></p:par>`;
  // group effects into clicks: a click starts a new one; with and after join the click before
  const clicks: (Eff & { spid: number })[][] = [];
  for (const e of effs) { if ((e.node ?? 'clickEffect') === 'clickEffect' || !clicks.length) clicks.push([e]); else clicks[clicks.length - 1].push(e); }
  const main = clicks.map((list) => {
    const pars: string[] = [];
    let group: string[] = [];
    list.forEach((e, k) => {
      if (k && e.node === 'afterEffect') { pars.push(group.join('')); group = []; }
      group.push(effect(e, k ? e.node ?? 'withEffect' : 'clickEffect'));
    });
    pars.push(group.join(''));
    return `<p:par><p:cTn id="${ids()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>${pars.map((g, k) => `<p:par><p:cTn id="${ids()}" fill="hold"><p:stCondLst><p:cond delay="${k ? 500 : 0}"/></p:stCondLst><p:childTnLst>${g}</p:childTnLst></p:cTn></p:par>`).join('')}</p:childTnLst></p:cTn></p:par>`;
  }).join('');
  const trig = triggers.map((t) => `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${ids()}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0">${tgt(t.on)}</p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>`
    + `<p:par><p:cTn id="${ids()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${ids()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effect({ ...t.eff, spid: t.spid }, 'clickEffect')}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`
    + `</p:childTnLst></p:cTn><p:nextCondLst><p:cond evt="onClick" delay="0">${tgt(t.on)}</p:cond></p:nextCondLst></p:seq>`).join('');
  const spids = [...new Set([...effs.map((e) => e.spid), ...triggers.map((t) => t.spid)])];
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>`
    + `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${main}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
    + `${trig}</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${spids.map((s) => `<p:bldP spid="${s}" grpId="0"${paras.has(s) ? ' build="p"' : ''}/>`).join('')}</p:bldLst></p:timing>`;
}
const vis = (ids: () => number, tgt: string, val = 'visible', at0 = 0) => `<p:set><p:cBhvr><p:cTn id="${ids()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${at0}"/></p:stCondLst></p:cTn>${tgt}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
const fx = (filter: string, inOut: 'in' | 'out', d: number) => (ids: () => number, tgt: string) => `<p:animEffect transition="${inOut}" filter="${filter}"><p:cBhvr><p:cTn id="${ids()}" dur="${d}"/>${tgt}</p:cBhvr></p:animEffect>`;
const anim = (attr: string, from: string, to: string, d: number) => (ids: () => number, tgt: string) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${ids()}" dur="${d}" fill="hold"/>${tgt}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
const B = {
  appear: (_s: number, ids: () => number, t: string) => vis(ids, t),
  fade: (_s: number, ids: () => number, t: string) => vis(ids, t) + fx('fade', 'in', 500)(ids, t),
  wipeLeft: (_s: number, ids: () => number, t: string) => vis(ids, t) + fx('wipe(right)', 'in', 500)(ids, t),
  flyBottom: (_s: number, ids: () => number, t: string) => vis(ids, t) + anim('ppt_x', '#ppt_x', '#ppt_x', 500)(ids, t) + anim('ppt_y', '1+#ppt_h/2', '#ppt_y', 500)(ids, t),
  zoom: (_s: number, ids: () => number, t: string) => vis(ids, t) + anim('ppt_w', '0', '#ppt_w', 500)(ids, t) + anim('ppt_h', '0', '#ppt_h', 500)(ids, t) + fx('fade', 'in', 500)(ids, t),
  floatIn: (_s: number, ids: () => number, t: string) => vis(ids, t) + anim('ppt_x', '#ppt_x', '#ppt_x', 1000)(ids, t) + anim('ppt_y', '#ppt_y+.1', '#ppt_y', 1000)(ids, t) + fx('fade', 'in', 1000)(ids, t),
  split: (_s: number, ids: () => number, t: string) => vis(ids, t) + fx('barn(inVertical)', 'in', 500)(ids, t),
  wheel: (_s: number, ids: () => number, t: string) => vis(ids, t) + fx('wheel(1)', 'in', 2000)(ids, t),
  randomBars: (_s: number, ids: () => number, t: string) => vis(ids, t) + fx('randombar(horizontal)', 'in', 500)(ids, t),
  fadeOut: (_s: number, ids: () => number, t: string) => fx('fade', 'out', 500)(ids, t) + vis(ids, t, 'hidden', 499),
  flyOut: (_s: number, ids: () => number, t: string) => anim('ppt_x', '#ppt_x', '#ppt_x', 500)(ids, t) + anim('ppt_y', '#ppt_y', '1+#ppt_h/2', 500)(ids, t) + vis(ids, t, 'hidden', 499),
  disappear: (_s: number, ids: () => number, t: string) => vis(ids, t, 'hidden'),
  wipeOut: (_s: number, ids: () => number, t: string) => fx('wipe(down)', 'out', 500)(ids, t) + vis(ids, t, 'hidden', 499),
  pulse: (_s: number, ids: () => number, t: string) => `<p:animScale><p:cBhvr><p:cTn id="${ids()}" dur="250" autoRev="1" fill="hold"/>${t}</p:cBhvr><p:by x="105000" y="105000"/></p:animScale>`,
  grow: (_s: number, ids: () => number, t: string) => `<p:animScale><p:cBhvr><p:cTn id="${ids()}" dur="2000" fill="hold"/>${t}</p:cBhvr><p:by x="150000" y="150000"/></p:animScale>`,
  spin: (_s: number, ids: () => number, t: string) => `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${ids()}" dur="2000" fill="hold"/>${t}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`,
  transparency: (_s: number, ids: () => number, t: string) => `<p:set><p:cBhvr><p:cTn id="${ids()}" dur="2000" fill="hold"/>${t}<p:attrNameLst><p:attrName>style.opacity</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="0.5"/></p:to></p:set><p:animEffect filter="image" prLst="opacity: 0.5"><p:cBhvr rctx="IE"><p:cTn id="${ids()}" dur="2000" fill="hold"/>${t}</p:cBhvr></p:animEffect>`,
  fillColor: (_s: number, ids: () => number, t: string) => `<p:animClr clrSpc="rgb" dir="cw"><p:cBhvr><p:cTn id="${ids()}" dur="2000" fill="hold"/>${t}<p:attrNameLst><p:attrName>fillcolor</p:attrName></p:attrNameLst></p:cBhvr><p:to><a:srgbClr val="C8553D"/></p:to></p:animClr><p:set><p:cBhvr><p:cTn id="${ids()}" dur="2000" fill="hold"/>${t}<p:attrNameLst><p:attrName>fill.type</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="solid"/></p:to></p:set>`,
  teeter: (_s: number, ids: () => number, t: string) => `<p:animRot by="120000"><p:cBhvr><p:cTn id="${ids()}" dur="100" fill="hold"/>${t}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`,
  path: (_s: number, ids: () => number, t: string) => `<p:animMotion origin="layout" path="M 0 0 L 0.25 0.1 L 0.4 -0.05 E" pathEditMode="relative" ptsTypes="AAA"><p:cBhvr><p:cTn id="${ids()}" dur="2000" fill="hold"/>${t}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>`,
};
/** The effects (presetClass, presetID, nodeType…) on the shape whose text holds `id`, in the saved slide. */
function effectsOn(v: View, id: string): { cls: string; preset: string; sub: string; node: string; delay: string; durs: string[]; el: Element }[] {
  const root = rootOf(v, id);
  if (!root) return [];
  const shape = Array.from(root.getElementsByTagNameNS(NS.p, 'sp')).find((e) => (kid(e, 'p:txBody')?.textContent ?? '').includes(id));
  const spid = at(kid(kid(shape, 'p:nvSpPr'), 'p:cNvPr') ?? null, 'id');
  return Array.from(root.getElementsByTagNameNS(NS.p, 'cTn')).filter((c) => c.hasAttribute('presetClass') && c.getElementsByTagNameNS(NS.p, 'spTgt')[0]?.getAttribute('spid') === spid)
    .map((c) => ({ cls: at(c, 'presetClass') ?? '', preset: at(c, 'presetID') ?? '', sub: at(c, 'presetSubtype') ?? '', node: at(c, 'nodeType') ?? '', delay: at(kid(kid(c, 'p:stCondLst'), 'p:cond') ?? null, 'delay') ?? '', durs: Array.from(c.getElementsByTagNameNS(NS.p, 'cTn')).map((x) => at(x, 'dur') ?? ''), el: c }));
}
const has = (v: View, id: string, cls: string, preset: number, more: (e: ReturnType<typeof effectsOn>[number]) => boolean = () => true) => effectsOn(v, id).some((e) => e.cls === cls && e.preset === String(preset) && more(e));
type A = { feature: string; tag: Tag; spec: string; eff: Omit<Eff, 'id'>; check: (v: View, id: string) => boolean; basis?: string };
const ANI: A[][] = [[
  { feature: 'Entrance Appear', tag: 'supported', spec: '§19.5.29 cTn presetClass entr presetID 1; Animations ▸ Appear', eff: { cls: 'entr', preset: 1, bhvr: B.appear }, check: (v, id) => has(v, id, 'entr', 1), basis: 'animation.ts:911' },
  { feature: 'Entrance Fade', tag: 'supported', spec: 'presetID 10 animEffect fade', eff: { cls: 'entr', preset: 10, bhvr: B.fade }, check: (v, id) => has(v, id, 'entr', 10) },
  { feature: 'Entrance Fly In From Bottom', tag: 'supported', spec: 'presetID 2 presetSubtype 4', eff: { cls: 'entr', preset: 2, sub: 4, bhvr: B.flyBottom }, check: (v, id) => has(v, id, 'entr', 2, (e) => e.sub === '4') },
  { feature: 'Entrance Wipe From Left', tag: 'supported', spec: 'presetID 22 presetSubtype 8', eff: { cls: 'entr', preset: 22, sub: 8, bhvr: B.wipeLeft }, check: (v, id) => has(v, id, 'entr', 22, (e) => e.sub === '8') },
  { feature: 'Entrance Zoom', tag: 'loss', spec: 'presetID 53', eff: { cls: 'entr', preset: 53, sub: 16, bhvr: B.zoom }, check: (v, id) => has(v, id, 'entr', 53), basis: 'animation.ts:912 (imported as Fade)' },
  { feature: 'Entrance Float In', tag: 'loss', spec: 'presetID 42', eff: { cls: 'entr', preset: 42, bhvr: B.floatIn }, check: (v, id) => has(v, id, 'entr', 42), basis: 'animation.ts:912' },
  { feature: 'Entrance Split', tag: 'loss', spec: 'presetID 16', eff: { cls: 'entr', preset: 16, sub: 21, bhvr: B.split }, check: (v, id) => has(v, id, 'entr', 16), basis: 'animation.ts:912' },
  { feature: 'Entrance Wheel', tag: 'loss', spec: 'presetID 21', eff: { cls: 'entr', preset: 21, sub: 1, bhvr: B.wheel }, check: (v, id) => has(v, id, 'entr', 21), basis: 'animation.ts:912' },
  { feature: 'Entrance Random Bars', tag: 'loss', spec: 'presetID 14', eff: { cls: 'entr', preset: 14, sub: 10, bhvr: B.randomBars }, check: (v, id) => has(v, id, 'entr', 14), basis: 'animation.ts:912' },
], [
  { feature: 'Exit Fade', tag: 'supported', spec: 'presetClass exit presetID 10', eff: { cls: 'exit', preset: 10, bhvr: B.fadeOut }, check: (v, id) => has(v, id, 'exit', 10) },
  { feature: 'Exit Fly Out To Bottom', tag: 'supported', spec: 'presetClass exit presetID 2', eff: { cls: 'exit', preset: 2, sub: 4, bhvr: B.flyOut }, check: (v, id) => has(v, id, 'exit', 2) },
  { feature: 'Exit Disappear', tag: 'supported', spec: 'presetClass exit presetID 1', eff: { cls: 'exit', preset: 1, bhvr: B.disappear }, check: (v, id) => has(v, id, 'exit', 1) },
  { feature: 'Exit Wipe', tag: 'supported', spec: 'presetClass exit presetID 22', eff: { cls: 'exit', preset: 22, sub: 4, bhvr: B.wipeOut }, check: (v, id) => has(v, id, 'exit', 22) },
  { feature: 'Emphasis Pulse', tag: 'supported', spec: 'presetClass emph presetID 26', eff: { cls: 'emph', preset: 26, bhvr: B.pulse }, check: (v, id) => has(v, id, 'emph', 26), basis: 'animation.ts:948 readEmphasis' },
  { feature: 'Emphasis Grow/Shrink 150%', tag: 'supported', spec: 'presetID 6 animScale', eff: { cls: 'emph', preset: 6, bhvr: B.grow }, check: (v, id) => has(v, id, 'emph', 6, (e) => at(e.el.getElementsByTagNameNS(NS.p, 'by')[0] ?? null, 'x') === '150000') },
  { feature: 'Emphasis Spin 360°', tag: 'supported', spec: 'presetID 8 animRot', eff: { cls: 'emph', preset: 8, bhvr: B.spin }, check: (v, id) => has(v, id, 'emph', 8, (e) => at(e.el.getElementsByTagNameNS(NS.p, 'animRot')[0] ?? null, 'by') === '21600000') },
  { feature: 'Emphasis Transparency 50%', tag: 'supported', spec: 'presetID 9', eff: { cls: 'emph', preset: 9, bhvr: B.transparency }, check: (v, id) => has(v, id, 'emph', 9) },
  { feature: 'Emphasis Fill Color', tag: 'supported', spec: 'presetID 1 animClr fillcolor', eff: { cls: 'emph', preset: 1, bhvr: B.fillColor }, check: (v, id) => effectsOn(v, id).some((e) => e.cls === 'emph' && e.el.getElementsByTagNameNS(NS.p, 'animClr').length > 0) },
  { feature: 'Emphasis Teeter', tag: 'loss', spec: 'presetID 32', eff: { cls: 'emph', preset: 32, bhvr: B.teeter }, check: (v, id) => has(v, id, 'emph', 32), basis: 'animation.ts:950 (others as Pulse; animRot read as Spin)' },
], [
  { feature: 'Motion Path (custom)', tag: 'supported', spec: '§19.5.4 animMotion path; Animations ▸ Motion Paths ▸ Custom Path', eff: { cls: 'path', preset: 0, bhvr: B.path }, check: (v, id) => effectsOn(v, id).some((e) => e.cls === 'path' && (at(e.el.getElementsByTagNameNS(NS.p, 'animMotion')[0] ?? null, 'path') ?? '').replace(/\s+/g, ' ').startsWith('M 0 0 L 0.25 0.1')), basis: 'animation.ts:897' },
  { feature: 'Motion Path Lines (preset 42)', tag: 'loss', spec: 'presetClass path presetID 42', eff: { cls: 'path', preset: 42, bhvr: B.path }, check: (v, id) => has(v, id, 'path', 42), basis: 'animation.ts:900 (read as a custom path)' },
  { feature: 'Start With Previous', tag: 'supported', spec: '§19.5.33 cTn@nodeType withEffect; Animations ▸ Start', eff: { cls: 'entr', preset: 10, node: 'withEffect', bhvr: B.fade }, check: (v, id) => effectsOn(v, id).some((e) => e.node === 'withEffect'), basis: 'animation.ts:893' },
  { feature: 'Start After Previous', tag: 'supported', spec: '§19.5.33 cTn@nodeType afterEffect', eff: { cls: 'entr', preset: 10, node: 'afterEffect', bhvr: B.fade }, check: (v, id) => effectsOn(v, id).some((e) => e.node === 'afterEffect'), basis: 'animation.ts:893' },
  { feature: 'Delay 0.75 s', tag: 'supported', spec: '§19.5.26 cond@delay; Animations ▸ Delay', eff: { cls: 'entr', preset: 10, delay: 750, bhvr: B.fade }, check: (v, id) => effectsOn(v, id).some((e) => e.delay === '750'), basis: 'animation.ts:868 delayOf' },
  { feature: 'Duration 2.00 s', tag: 'supported', spec: '§19.5.33 cTn@dur; Animations ▸ Duration', eff: { cls: 'entr', preset: 10, bhvr: (_s, ids, t) => vis(ids, t) + fx('fade', 'in', 2000)(ids, t) }, check: (v, id) => effectsOn(v, id).some((e) => e.durs.includes('2000')), basis: 'animation.ts:916' },
  { feature: 'Repeat 3 times', tag: 'loss', spec: '§19.5.33 cTn@repeatCount; Effect Options ▸ Timing ▸ Repeat', eff: { cls: 'emph', preset: 26, extra: ' repeatCount="3000"', bhvr: B.pulse }, check: (v, id) => effectsOn(v, id).some((e) => at(e.el, 'repeatCount') === '3000'), basis: 'not read' },
  { feature: 'Rewind when done playing', tag: 'loss', spec: '§19.5.33 cTn@fill remove (rewind)', eff: { cls: 'emph', preset: 6, extra: ' restart="whenNotActive"', bhvr: B.grow }, check: (v, id) => effectsOn(v, id).some((e) => at(e.el, 'restart') === 'whenNotActive'), basis: 'not read' },
  { feature: 'Smooth start and end (accel, decel)', tag: 'loss', spec: '§19.5.33 cTn@accel/@decel; Effect Options ▸ Smooth start', eff: { cls: 'path', preset: 0, extra: ' accel="50000" decel="50000"', bhvr: B.path }, check: (v, id) => effectsOn(v, id).some((e) => at(e.el, 'accel') === '50000'), basis: 'not read' },
]];
for (const list of ANI) {
  const made = list.map((a) => { const id: string = an(a.feature, a.tag, a.spec, (v) => a.check(v, id), a.basis); return { ...a, id }; });
  slides.push({
    body: (s) => { s.grid(4, 3, 100); return title(s, 'Animations (each shape plays its own)') + made.map((m) => sp({ id: s.id(m.id), name: `${m.id} animated`, box: s.cell(), geom: prst('roundRect'), fmt: solid('8AB17D'), body: txBody(para(r(`${m.id} ${m.feature}`, 'sz="1100"'), 'algn="ctr"'), '<a:bodyPr anchor="ctr"/>') })).join(''); },
    timing: (s) => timing(made.map((m) => ({ ...m.eff, id: m.id, spid: s.spid(m.id) }))),
  });
}
{
  // a trigger, and text built by paragraph
  const trig = an('Trigger: On Click of another shape', 'supported', '§19.5.71 seq interactiveSeq with onClick of a shape; Animations ▸ Trigger', (v) => { const root = rootOf(v, trig); return !!root && Array.from(root.getElementsByTagNameNS(NS.p, 'cTn')).some((c) => at(c, 'nodeType') === 'interactiveSeq') && effectsOn(v, trig).length > 0; }, 'animation.ts:857 triggers');
  const byPara = an('Text By Paragraph (each paragraph its own click)', 'supported', '§19.5.13 bldP@build p; Effect Options ▸ Sequence ▸ By Paragraph', (v) => { const root = rootOf(v, byPara); return !!root && Array.from(root.getElementsByTagNameNS(NS.p, 'bldP')).some((b) => at(b, 'build') === 'p') && Array.from(root.getElementsByTagNameNS(NS.p, 'pRg')).length >= 2; }, 'animation.ts:880 paraBuilt');
  const part = an('One paragraph of a text box animated alone', 'loss', '§19.5.81 txEl pRg on one paragraph', (v) => { const root = rootOf(v, part); return !!root && Array.from(root.getElementsByTagNameNS(NS.p, 'pRg')).some((p) => at(p, 'st') === '1' && at(p, 'end') === '1') && !Array.from(root.getElementsByTagNameNS(NS.p, 'bldP')).some((b) => at(b, 'build') === 'p' && b.getAttribute('spid') === at(kid(kid(v.all(SLIDES, 'p:sp').find((e) => (kid(e, 'p:txBody')?.textContent ?? '').includes(part)), 'p:nvSpPr'), 'p:cNvPr') ?? null, 'id')); }, 'animation.ts:892 (moves the whole text box)');
  slides.push({
    body: (s) => title(s, 'Triggers and paragraphs')
      + sp({ id: s.id('button'), name: 'trigger button', box: [40, 120, 160, 60], geom: prst('roundRect'), fmt: solid('C8553D'), body: txBody(para(r('Click me', 'sz="1400"'), 'algn="ctr"'), '<a:bodyPr anchor="ctr"/>') })
      + sp({ id: s.id('target'), name: `${trig} triggered`, box: [240, 120, 200, 60], geom: prst('ellipse'), fmt: solid('3A86FF'), body: txBody(para(r(`${trig} appears on click`, 'sz="1200"'), 'algn="ctr"'), '<a:bodyPr anchor="ctr"/>') })
      + textBox(s.id('paras'), `${byPara} by paragraph`, [40, 220, 400, 120], [`${byPara} first paragraph`, 'second paragraph', 'third paragraph'].map((t) => para(r(t, 'sz="1400"'))).join(''))
      + textBox(s.id('part'), `${part} one paragraph`, [480, 220, 400, 120], [`${part} paragraph one`, 'paragraph two (animated alone)', 'paragraph three'].map((t) => para(r(t, 'sz="1400"'))).join('')),
    timing: (s) => {
      const p = s.spid('paras');
      const effs = [0, 1, 2].map((k) => ({ id: byPara, cls: 'entr' as const, preset: 10, para: k, spid: p, bhvr: B.fade }));
      return timing([...effs, { id: part, cls: 'entr', preset: 10, para: 1, spid: s.spid('part'), bhvr: B.fade }], [{ spid: s.spid('target'), on: s.spid('button'), eff: { id: trig, cls: 'entr', preset: 10, bhvr: B.fade } }], new Set([p]));
    },
  });
}

// ---------------------------------------------------------------- speaker notes

const nt = itemList('P-NOT', items);
const notesText = (v: View, id: string) => v.all(NOTES, 'a:r').find((x) => (x.textContent ?? '').includes(id));
{
  const plainN = nt('Speaker notes, plain text', 'supported', '§19.3.1.26 notes body placeholder; View ▸ Notes', (v) => !!notesText(v, plainN), 'pptx-read.ts:1073 notes()');
  const two = nt('Notes with two paragraphs', 'supported', '§21.1.2.2.6 p in notes', (v) => { const r0 = notesText(v, two); const tb = r0 ? r0.parentElement?.parentElement : null; return !!tb && tb.getElementsByTagNameNS(NS.a, 'p').length >= 2; });
  const bold = nt('Notes with a bold word', 'kept', '§21.1.2.3.9 rPr@b in notes', (v) => v.all(NOTES, 'a:r').some((x) => (x.textContent ?? '').includes('bold word') && at(kid(x, 'a:rPr') ?? null, 'b') === '1'), 'inventory: formatted notes kept while text unchanged');
  const color = nt('Notes with colored text', 'kept', 'solidFill in notes rPr', (v) => v.all(NOTES, 'a:r').some((x) => (x.textContent ?? '').includes('red words') && at(kid(x, 'a:rPr/a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'C8553D'), 'inventory');
  const bullets = nt('Notes with a bulleted list', 'supported', 'buChar in notes', (v) => v.all(NOTES, 'a:p').some((p) => (p.textContent ?? '').includes('first point')) && (v.all(NOTES, 'a:buChar').length > 0 || v.all(NOTES, 'a:t').some((t) => (t.textContent ?? '').startsWith('• first point'))), 'pptx-read.ts:1073 (a bulleted paragraph starting "• ")');
  const big = nt('Notes text size 16 pt', 'kept', 'rPr@sz in notes', (v) => v.all(NOTES, 'a:r').some((x) => (x.textContent ?? '').includes(big) && at(kid(x, 'a:rPr') ?? null, 'sz') === '1600'), 'inventory');
  slides.push({ body: (s) => title(s, `${plainN} ${two} ${bold} ${color} ${bullets} ${big} slide with notes`), notes: para(r(`${plainN} ${two} These are the speaker notes.`)) + para(r('Second paragraph of notes.')) });
  slides.push({ body: (s) => title(s, `${bold} ${color} ${bullets} ${big} formatted notes`), notes: `<a:p>${r(`${bold} ${color} notes with a `)}${r('bold word', 'b="1"')}${r(' and ')}${r('red words', '', solid('C8553D'))}</a:p>`
    + para(r('first point'), 'marL="171450" indent="-171450"', '<a:buFont typeface="Arial"/><a:buChar char="•"/>') + para(r('second point'), 'marL="171450" indent="-171450"', '<a:buFont typeface="Arial"/><a:buChar char="•"/>') + para(r(`${big} sixteen point notes`, 'sz="1600"')) });
}

// ---------------------------------------------------------------- comments

const cm = itemList('P-CMT', items);
let modernAuthor = '';
const legacy = (v: View) => v.all(/^ppt\/comments\/comment\d+\.xml$/, 'p:cm');
const anyCommentText = (v: View, id: string) => Object.entries(v.parts).some(([n, x]) => /^ppt\/comments\//.test(n) && x.includes(id));
{
  const c1 = cm('Comment (legacy, ECMA-376)', 'supported', '§19.4.1 cm, §19.4.6 text; Review ▸ New Comment', (v) => legacy(v).some((c) => (kid(c, 'p:text')?.textContent ?? '').includes(c1)), 'pptx-comments.ts:107 readLegacyComments');
  const auth = cm('Comment author name and initials', 'supported', '§19.4.2 cmAuthor', (v) => { const c = legacy(v).find((x) => (kid(x, 'p:text')?.textContent ?? '').includes(auth)); const a = v.all(/^ppt\/commentAuthors\.xml$/, 'p:cmAuthor').find((x) => at(x, 'id') === at(c ?? null, 'authorId')); return at(a ?? null, 'name') === 'Second Reviewer'; }, 'pptx-comments.ts:86');
  const pos = cm('Comment pinned at a point', 'supported', '§19.4.5 pos', (v) => { const c = legacy(v).find((x) => (kid(x, 'p:text')?.textContent ?? '').includes(pos)); return at(kid(c, 'p:pos') ?? null, 'x') === '2400' && at(kid(c, 'p:pos') ?? null, 'y') === '1200'; }, 'pptx-comments.ts UNITS');
  const date = cm('Comment date', 'supported', '§19.4.1 cm@dt', (v) => legacy(v).some((x) => (kid(x, 'p:text')?.textContent ?? '').includes(date) && (at(x, 'dt') ?? '').startsWith('2026-01-02T10:30')), 'pptx-comments.ts:40 pptDate');
  const reply = cm('Reply to a comment (PowerPoint 2013 threading)', 'supported', 'p15:threadingInfo parentCm', (v) => legacy(v).some((x) => (kid(x, 'p:text')?.textContent ?? '').includes(reply) && x.getElementsByTagNameNS(PNS.p15, 'parentCm').length > 0), 'pptx-comments.ts:17 THREADING');
  slides.push({
    body: (s) => title(s, `${c1} ${auth} ${pos} ${date} ${reply} legacy comments`),
    comments: `<p:cm authorId="1" dt="2026-01-01T09:00:00.000" idx="1"><p:pos x="100" y="100"/><p:text>${esc(`${c1} first comment`)}</p:text></p:cm>`
      + `<p:cm authorId="2" dt="2026-01-01T09:05:00.000" idx="1"><p:pos x="400" y="100"/><p:text>${esc(`${auth} by the second reviewer`)}</p:text></p:cm>`
      + `<p:cm authorId="1" dt="2026-01-01T09:10:00.000" idx="2"><p:pos x="2400" y="1200"/><p:text>${esc(`${pos} pinned lower right`)}</p:text></p:cm>`
      + `<p:cm authorId="1" dt="2026-01-02T10:30:00.000" idx="3"><p:pos x="800" y="800"/><p:text>${esc(`${date} dated comment`)}</p:text></p:cm>`
      + `<p:cm authorId="2" dt="2026-01-02T11:00:00.000" idx="2"><p:pos x="100" y="100"/><p:text>${esc(`${reply} a reply`)}</p:text><p:extLst><p:ext uri="{C676402C-5697-4E1C-873F-D02D1690AC5C}"><p15:threadingInfo xmlns:p15="${PNS.p15}" timeZoneBias="0"><p15:parentCm authorId="1" idx="1"/></p15:threadingInfo></p:ext></p:extLst></p:cm>`,
  });
  const modern = cm('Modern comment (PowerPoint 365) text', 'supported', 'p188:cm (PowerPoint 365 comments)', (v) => anyCommentText(v, modern), 'pptx-comments.ts:173 readModernComments (written as legacy)');
  const modernForm = cm('Modern comment kept as a modern comment', 'loss', 'p188:cmLst part', (v) => Object.entries(v.parts).some(([n, x]) => /^ppt\/comments\/modernComment/.test(n) && x.includes(modernForm)), 'inventory: written as legacy');
  const mreply = cm('Modern comment reply', 'supported', 'p188:replyLst', (v) => anyCommentText(v, mreply), 'pptx-comments.ts:173');
  const AUTHOR = '{5E8A0B1C-2D3E-4F50-8A6B-7C8D9E0F1A2B}';
  slides.push({
    body: (s) => title(s, `${modern} ${modernForm} ${mreply} modern comments`),
    ext: (s) => {
      const n = Number(/slide(\d+)\.xml$/.exec(s.path)![1]);
      const xml = `${XML_HEAD}<p188:cmLst xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p188="${PNS.p188}"><p188:cm id="{6A1B2C3D-4E5F-4061-8273-94A5B6C7D8E9}" authorId="${AUTHOR}" created="2026-01-03T09:00:00.000"><pc:sldMkLst xmlns:pc="http://schemas.microsoft.com/office/powerpoint/2013/main/command"><pc:docMk/><pc:sldMk cId="0" sldId="${255 + n}"/></pc:sldMkLst>`
        + `<p188:replyLst><p188:reply id="{7B2C3D4E-5F60-4172-8384-A5B6C7D8E9F0}" authorId="${AUTHOR}" created="2026-01-03T09:30:00.000"><p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${mreply} modern reply</a:t></a:r></a:p></p188:txBody></p188:reply></p188:replyLst>`
        + `<p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${modern} ${modernForm} modern comment</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>`;
      const rid = s.part(`comments/modernComment_${255 + n}_0.xml`, xml, CTP.modernComments, RELP.modernComments);
      return `<p:ext uri="{6950BFC3-D8DA-4A85-94F7-54DA5524770B}"><p188:commentRel xmlns:p188="${PNS.p188}" r:id="${rid}"/></p:ext>`;
    },
  });
  modernAuthor = `${XML_HEAD}<p188:authorLst xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p188="${PNS.p188}"><p188:author id="${AUTHOR}" name="Modern Author" initials="MA" userId="Modern Author" providerId="None"/></p188:authorLst>`;
}

export const pptxShow: Sampler = {
  name: 'pptx-show.pptx', area: 'PowerPoint slide show: transitions, animations, speaker notes and comments', items,
  build: () => deckFile({
    title: 'PowerPoint sampler: slide show',
    slides,
    extra: (pkg) => {
      pkg.add('ppt/authors.xml', modernAuthor, CTP.modernAuthors);
      pkg.rel('ppt/presentation.xml', RELP.modernAuthors, 'authors.xml');
    },
  }),
};
