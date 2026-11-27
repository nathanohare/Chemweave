// Text above and below a reaction arrow (reagents and conditions, and the Results line of yield,
// ee or dr under the text below): which captions are there now, where a new line goes, setting it
// from plain text, and fitting the arrow to it. The dashed text guides on the drawing and the
// fields in the side panel both work through these; the gaps, size, alignment and fitting come
// from the drawing style and the scheme settings (Chemistry > Reactions and Schemes > Scheme
// Settings), and an arrow can have its own alignment (Arrow.textLook).

import type { Arrow, ArrowTextSide, Caption, Doc, Justify, TextRun } from '../model';
import type { Rect, Vec } from '../geom';
import { add, mul } from '../geom';
import type { Measure } from '../editor/arrange';
import { plainText } from '../richtext';
import * as rt from '../richtext';
import { formulaDigits } from '../text/chemtext';
import { arrowFrame, inFrame, isReactionArrow, itemFinder, rolesOf, schemeItems, type Frame, type Item } from './reaction';
import { isNumberedList, STEP_MARK } from './step-list';

export { isNumberedList };
import { alignFor, alignOn, fittedLength, justifyFor, labelsOf, lineStart, prefsOf, schemePrefs, resultsFloor, spacing, textGapOn } from './scheme-layout';

export type ArrowSide = ArrowTextSide;
export const ARROW_SIDES: ArrowSide[] = ['above', 'below', 'results'];
type Align = 'left' | 'center' | 'right';

/**
 * The captions above and below an arrow, nearest the arrow first (`items`: the drawing's scheme
 * items, when already made). The Results line is text below the arrow marked as such: in a
 * reaction step (and in ChemDraw) it is text below the arrow like the rest.
 */
export function arrowTexts(doc: Doc, m: Measure, r: Arrow, items = schemeItems(doc, m)): Record<ArrowSide, Caption[]> {
  const roles = rolesOf(r, items, doc.style.bondLength);
  const f = arrowFrame(r);
  const pick = (refs: string[], sign: 1 | -1) => refs
    .filter((ref) => ref[0] === 'c')
    .map((ref) => doc.captions.get(Number(ref.slice(1))))
    .filter((c): c is Caption => !!c)
    .sort((a, b) => near(f, m.captionBox(a), sign) - near(f, m.captionBox(b), sign));
  const under = pick(roles.below, -1);
  return { above: pick(roles.above, 1), below: under.filter((c) => !c.results), results: under.filter((c) => c.results) };
}

/** Text with each numbered step on a line of its own ("1. n-BuLi; 2. PhCHO" → two lines). */
export function splitStepsText(text: string): string {
  return text.replace(new RegExp(`\\s*[;,]\\s*(?=${STEP_MARK}\\s)`, 'gi'), '\n');
}

/** Caption runs with each numbered step on a line of its own, keeping their formatting; null when nothing would change. */
export function splitStepRuns(runs: TextRun[]): TextRun[] | null {
  const text = plainText(runs);
  if (!isNumberedList(text)) return null;
  const re = new RegExp(`\\s*[;,]\\s*(?=${STEP_MARK}\\s)`, 'gi');
  const cuts: [number, number][] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) if (m[0].length) cuts.push([m.index, m.index + m[0].length]);
  if (!cuts.length) return null;
  let out = runs;
  for (const [a, b] of cuts.reverse()) out = rt.replaceRange(out, a, b, [{ ...rt.styleOf(rt.sliceRuns(out, a, a + 1)[0] ?? { text: '' }), text: '\n' }]);
  return rt.normalizeRuns(out);
}

/**
 * How the text on one side of an arrow lines up: as set for this arrow, else on the left when it
 * is a numbered list of steps (and the settings say so), else as the drawing style says.
 */
export const sideAlign = (doc: Doc, r: Arrow, side: ArrowSide, texts?: Caption[]): Align => alignFor(r, side, texts, prefsOf(doc));

/**
 * The lines-up a side's captions are given when the text is lined up: the arrow's own choice or
 * a numbered list's left; otherwise left as they are (text lined up by hand keeps its alignment).
 */
const setJustify = (doc: Doc, r: Arrow, side: ArrowSide, texts: Caption[]): Align | undefined => justifyFor(r, side, texts, prefsOf(doc));

/** How far a box's edge nearest the arrow is from it, on one side. */
const near = (f: Frame, b: Rect, sign: 1 | -1) => { const q = inFrame(f, b); return sign > 0 ? q.s1 : -q.s2; };

/** The arrowhead's length (the text stops short of it). */
const headOf = (r: Arrow) => (r.headStyle !== 'none' || r.tailStyle !== 'none' ? r.headLength : 0);

/**
 * Where the Results line starts out from an arrow: past the text below it, and never nearer the
 * arrow than the least Results distance (one line of text, unless set), so a yield with no
 * conditions under the arrow still sits clear of it.
 */
function resultsGapOf(doc: Doc, m: Measure, r: Arrow, below: Caption[]): number {
  const f = arrowFrame(r);
  const p = prefsOf(doc);
  const sp = spacing(doc.style.bondLength, p);
  let gap = Math.max(textGapOn(sp, 'below'), resultsFloor(doc, p));
  for (const c of below) gap = Math.max(gap, -inFrame(f, m.captionBox(c)).s1 + sp.results);
  return gap;
}

/** Where the next line of text goes on one side: its near edge `gap` out from the arrow and what is there. */
export function sideSlot(doc: Doc, m: Measure, r: Arrow, side: ArrowSide, have?: Caption[]): { mid: Vec; out: Vec; gap: number } {
  const f = arrowFrame(r);
  const sign = side === 'above' ? 1 : -1;
  const sp = spacing(doc.style.bondLength, prefsOf(doc));
  const t = have ? null : arrowTexts(doc, m, r);
  have ??= t![side];
  let gap = side === 'results' ? resultsGapOf(doc, m, r, t ? t.below : arrowTexts(doc, m, r).below) : textGapOn(sp, side);
  for (const c of have) {
    const q = inFrame(f, m.captionBox(c));
    gap = Math.max(gap, (sign > 0 ? q.s2 : -q.s1) + sp.stack);
  }
  return { mid: add(f.tail, mul(f.u, (f.length - headOf(r)) / 2)), out: mul(f.n, sign), gap };
}

/**
 * The text guide on one side of an arrow (drawing coordinates): where a click starts the text.
 * The Results guide sits under the text below the arrow (`m` places it).
 */
export function helperBox(doc: Doc, r: Arrow, side: ArrowSide, m?: Measure, items?: Item[]): Rect {
  const f = arrowFrame(r);
  const bond = doc.style.bondLength;
  const shaft = Math.max(1, f.length - headOf(r));
  const w = Math.min(shaft * 0.9, 2.6 * bond), h = textSize(doc, side) * 1.5;
  const sign = side === 'above' ? 1 : -1;
  const gap = side === 'results' && m ? resultsGapOf(doc, m, r, arrowTexts(doc, m, r, items).below) : textGapOn(spacing(bond, prefsOf(doc)), side === 'above' ? 'above' : 'below');
  const c = add(add(f.tail, mul(f.u, shaft / 2)), mul(f.n, sign * (gap + h / 2)));
  return { x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2 };
}

/**
 * A plain reaction arrow, as the Reaction arrow tool draws it: one solid shaft, a full solid head
 * at one end only, nothing struck through. Only these show text guides unless asked.
 */
export function plainReactionArrow(r: Arrow): boolean {
  return isReactionArrow(r) && !r.equilibrium && !r.shaftSpacing && !r.noGo && !r.dipole && r.headType === 'solid'
    && (r.line === 'solid' || r.line === 'bold') && ((r.headStyle === 'full') !== (r.tailStyle === 'full')) && (r.headStyle === 'none' || r.tailStyle === 'none');
}

/** An arrow that can show text guides at all: straight, on its own (not a connector or a cycle's reagent arrow). */
export function canShowGuides(r: Arrow): boolean {
  return !r.sweep && !r.bez?.length && !r.from && !r.to && !r.elbow && r.reagentFor === undefined;
}

/** Does this arrow show its text guides? As set for it, else only a plain reaction arrow. */
export const guidesOn = (r: Arrow): boolean => canShowGuides(r) && (r.textLook?.guides ?? plainReactionArrow(r));

/** Arrows that get text guides: those showing them, lying close to level. */
export function takesHelpers(r: Arrow): boolean {
  if (!guidesOn(r)) return false;
  const f = arrowFrame(r);
  return f.length > 1 && Math.abs(f.u.y) < 0.26;
}

/**
 * The size new text beside arrows takes: the drawing style's (Drawing Style > Text above and below
 * arrows, and Results under arrows), else the captions'.
 */
export const textSize = (doc: Doc, side: ArrowSide = 'above'): number => {
  const base = doc.style.arrowTextSize ?? schemePrefs.textSize ?? doc.style.captionSize;
  return side === 'results' ? doc.style.resultsTextSize ?? base : base;
};

/** Its font, where not the captions'. */
export const textFont = (doc: Doc, side: ArrowSide = 'above'): string | undefined =>
  (side === 'results' ? doc.style.resultsTextFont : undefined) ?? doc.style.arrowTextFont;

/** How new text's lines line up, on one side of an arrow (`r`: that arrow's own choice first). */
export const textJustify = (doc: Doc, side: ArrowSide = 'above', r?: Arrow): Justify => r?.textLook?.align?.[side] ?? alignOn(prefsOf(doc), side);

/** The look of new text: the settings' size and font when they differ from the drawing's captions'. */
export function newTextLook(doc: Doc, side: ArrowSide = 'above'): Partial<TextRun> {
  const size = textSize(doc, side), font = textFont(doc, side);
  return {
    ...(size !== doc.style.captionSize ? { size } : {}),
    ...(font && font !== doc.style.captionFont ? { font } : {}),
  };
}

/** Plain text as caption runs: formulas' digits as subscripts, in the look of `like` (its first run). */
export function textRuns(text: string, like?: Partial<TextRun>[]): TextRun[] {
  const base = like?.length ? rt.styleOf({ text: '', ...like[0] }) : {};
  const { sub: _s, sup: _p, ...look } = base;
  const subs = new Set(formulaDigits(text));
  const runs: TextRun[] = [];
  for (let i = 0; i < text.length; i++) runs.push({ ...look, text: text[i], ...(subs.has(i) ? { sub: true } : {}) });
  return rt.normalizeRuns(runs);
}

/**
 * Line the text up on both sides of an arrow as the settings say: stacked out from it, along it
 * from the lead-in (fitting) or centred on its shaft. Call inside an edit.
 */
export function lineUpText(doc: Doc, m: Measure, r: Arrow): void {
  const t0 = arrowTexts(doc, m, r);
  // each side's lines line up as the arrow says (or on the left for a numbered list) first
  for (const side of ARROW_SIDES) {
    const j = setJustify(doc, r, side, t0[side]);
    if (j) for (const c of t0[side]) if (c.justify !== j) doc.updateCaption(c.id, { justify: j });
  }
  const t = { above: t0.above.map((c) => doc.captions.get(c.id)!), below: t0.below.map((c) => doc.captions.get(c.id)!), results: t0.results.map((c) => doc.captions.get(c.id)!) };
  const f = arrowFrame(r);
  const bond = doc.style.bondLength;
  const sp = spacing(bond, prefsOf(doc));
  const all = [...t.above, ...t.below, ...t.results];
  const widest = Math.max(0, ...all.map((c) => { const q = inFrame(f, m.captionBox(c)); return q.t2 - q.t1; }));
  let belowEnd = textGapOn(sp, 'below') - sp.results;
  for (const [side, sign] of [['above', 1], ['below', -1], ['results', -1]] as const) {
    let cursor = side === 'results' ? Math.max(belowEnd + sp.results, resultsFloor(doc)) : textGapOn(sp, side);
    const how = sideAlign(doc, r, side, t[side]);
    for (const c of t[side]) {
      const q = inFrame(f, m.captionBox(c));
      const dt = lineStart(q.t2 - q.t1, widest, f.length, headOf(r), bond, prefsOf(doc), side, how) - q.t1;
      const ds = sign > 0 ? cursor - q.s1 : -cursor - q.s2;
      const d = add(mul(f.u, dt), mul(f.n, ds));
      if (Math.hypot(d.x, d.y) > 1e-6) doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y });
      cursor += q.s2 - q.s1 + sp.stack;
    }
    if (side === 'below' && t.below.length) belowEnd = cursor - sp.stack;
  }
}

/**
 * Fit the arrow to its text (when the settings ask): lengthen or shorten it from the head end,
 * moving the products (and their numbers and + signs) along with the head, then line the text up.
 * Call inside an edit.
 */
export function fitArrowToText(doc: Doc, m: Measure, r0: Arrow): void {
  const r = doc.arrows.get(r0.id);
  if (!r) return;
  if (!prefsOf(doc).fit) { lineUpText(doc, m, r); return; }
  const t = arrowTexts(doc, m, r);
  const all = [...t.above, ...t.below, ...t.results];
  if (!all.length) return;
  const f = arrowFrame(r);
  const widest = Math.max(...all.map((c) => { const q = inFrame(f, m.captionBox(c)); return q.t2 - q.t1; }));
  const bond = doc.style.bondLength;
  const L = fittedLength(widest, headOf(r), bond, prefsOf(doc));
  const dl = L - f.length;
  if (Math.abs(dl) > 0.01) {
    const d = mul(f.u, dl);
    // the frame runs tail to head the way the arrow points: move whichever end is the head
    const fwd = r.headStyle !== 'none' || r.tailStyle === 'none';
    doc.updateArrow(r.id, fwd ? { head: add(r.head, d) } : { tail: add(r.tail, d) });
    // the products, their + signs and the numbers under them move with the head
    const items = schemeItems(doc, m);
    const find = itemFinder(items);
    const roles = rolesOf(r, items, bond);
    const products = new Set(roles.products.map(find).filter((x): x is Item => !!x));
    for (const ref of roles.plusses ?? []) {
      const p = find(ref);
      if (p && inFrame(f, p.box).t1 > f.length * 0.5) products.add(p);
    }
    const used = new Set<Item>();
    for (const k of ['reactants', 'products', 'above', 'below'] as const) for (const ref of roles[k]) { const it = find(ref); if (it) used.add(it); }
    const labels = labelsOf(items, used, doc, bond);
    const moving = new Set<Item>();
    for (const it of products) { moving.add(it); for (const l of labels.get(it) ?? []) moving.add(l); }
    for (const it of moving) moveItem(doc, it, d);
  }
  lineUpText(doc, m, doc.arrows.get(r.id)!);
}

function moveItem(doc: Doc, it: Item, d: Vec): void {
  if (it.atoms.length) doc.moveAtoms(it.atoms, d.x, d.y);
  else if (it.caption !== undefined) { const c = doc.captions.get(it.caption); if (c) doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y }); }
  else if (it.shape !== undefined) { const s = doc.shapes.get(it.shape); if (s) doc.updateShape(s.id, { x1: s.x1 + d.x, y1: s.y1 + d.y, x2: s.x2 + d.x, y2: s.y2 + d.y }); }
}

/** A caption just added beside an arrow: counted as its text, then the arrow fitted and the text lined up. */
export function adoptSideCaption(doc: Doc, m: Measure, r0: Arrow, id: number, side: ArrowSide): void {
  const r = doc.arrows.get(r0.id);
  let c = doc.captions.get(id);
  if (!r || !c) return;
  if (side === 'results' && !c.results) { doc.updateCaption(id, { results: true }); c = doc.captions.get(id)!; }
  // first centred along the shaft, so however long it is it reads as this arrow's text; fitting
  // and lining up then put it exactly
  const f = arrowFrame(r);
  const q = inFrame(f, m.captionBox(c));
  const d = mul(f.u, (f.length - headOf(r)) / 2 - (q.t1 + q.t2) / 2);
  if (Math.hypot(d.x, d.y) > 1e-6) doc.updateCaption(id, { x: c.x + d.x, y: c.y + d.y });
  // (the Results line is text below the arrow in the step)
  const role = side === 'above' ? 'above' : 'below';
  if (r.step && !r.step[role].includes('c' + id)) doc.updateArrow(r.id, { step: { ...r.step, [role]: [...r.step[role], 'c' + id] } });
  fitArrowToText(doc, m, doc.arrows.get(r.id)!);
}

/**
 * Set the text on one side of an arrow from plain text (the side panel's fields): changes the
 * nearest caption there, or adds one, or removes it when the text is emptied. Call inside an edit.
 */
export function setSideText(doc: Doc, m: Measure, r: Arrow, side: ArrowSide, text: string): void {
  const have = arrowTexts(doc, m, r)[side];
  const cur = have[0];
  const t = text.replace(/\r/g, '').replace(/\s+$/, '');
  if (cur) {
    if (plainText(cur.runs) === t) return;
    if (!t.trim()) doc.removeCaption(cur.id);
    else doc.updateCaption(cur.id, { runs: textRuns(t, cur.runs) });
    fitArrowToText(doc, m, r);
    return;
  }
  if (!t.trim()) return;
  const slot = sideSlot(doc, m, r, side, have);
  const at = add(slot.mid, mul(slot.out, slot.gap));
  const c = doc.addCaption({ x: at.x, y: at.y, runs: textRuns(t, [newTextLook(doc, side)]), justify: textJustify(doc, side, r), ...(side === 'results' ? { results: true } : {}) });
  // a first rough place on this side; adopting it centres it, fitting puts it exactly
  const f = arrowFrame(r);
  const q = inFrame(f, m.captionBox(c));
  const ds = side === 'above' ? slot.gap - q.s1 : -slot.gap - q.s2;
  doc.updateCaption(c.id, { x: c.x + f.n.x * ds, y: c.y + f.n.y * ds });
  adoptSideCaption(doc, m, r, c.id, side);
}
