// Reaction schemes: which objects round an arrow are its starting materials, products and
// conditions, worked out from where they sit the way a chemist reads a scheme. Starting
// materials sit in line before the arrow (joined by + signs), products in line after it, and
// conditions are stacked above and below it.
//
// A role is named by a reference: 'a12' is the structure holding atom 12, 'c5' caption 5 and
// 's7' shape 7 (a picture, say).

import type { Arrow, ArrowKind, Atom, Caption, Doc, StepRoles } from '../model';
import type { Rect, Vec } from '../geom';
import { dot, norm, sub } from '../geom';
import { arrowBox } from '../objects';
import { atomsBox, type Measure } from '../editor/arrange';
import { labelBonds, labelSpec, layoutLabel } from './labels';
import { arialWidth } from '../text-metrics';
import { layoutText } from '../text/layout';
import { plainText } from '../richtext';

export type Role = 'reactants' | 'products' | 'above' | 'below';
export const ROLES: Role[] = ['reactants', 'products', 'above', 'below'];

/** One thing in a scheme: a whole structure, a caption, or a picture. */
export interface Item {
  ref: string;
  box: Rect;
  /** A "+" between starting materials or products. */
  plus: boolean;
  atoms: number[];
  caption?: number;
  shape?: number;
}

/** Every structure, caption and picture in the drawing, as scheme items. */
export function schemeItems(doc: Doc, m: Measure): Item[] {
  const out: Item[] = [];
  for (const f of doc.fragments()) {
    const atoms = [...f];
    out.push({ ref: 'a' + Math.min(...atoms), box: atomsBox(doc, atoms, m), plus: false, atoms });
  }
  for (const c of doc.captions.values()) {
    const text = plainText(c.runs).trim();
    if (!text || c.ph) continue;
    out.push({ ref: 'c' + c.id, box: m.captionBox(c), plus: isPlus(text), atoms: [], caption: c.id });
  }
  for (const s of doc.shapes.values()) {
    if (s.kind === 'picture' || s.kind === 'table' || s.holder) {
      out.push({ ref: 's' + s.id, box: { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) }, plus: false, atoms: [], shape: s.id });
    }
  }
  return out;
}

const isPlus = (t: string) => t === '+' || t === '＋';

/** The item a reference names (a structure is found by any of its atoms). */
export function itemFinder(items: Item[]): (ref: string) => Item | undefined {
  const byRef = new Map<string, Item>();
  for (const it of items) {
    byRef.set(it.ref, it);
    for (const a of it.atoms) byRef.set('a' + a, it);
  }
  return (ref) => byRef.get(ref);
}

/**
 * What kind of arrow this is: chosen by hand, or from how it is drawn. A curved arrow is a
 * mechanism arrow (unless it is a catalytic cycle's step); an arrow with heads at both ends
 * (resonance), two shafts (retrosynthetic), a dipole arrow, a connector or a line with no head is
 * plain; anything else (plain, dashed, hollow, equilibrium, no-go) is a reaction arrow.
 */
export function arrowKind(r: Arrow): ArrowKind {
  if (r.kind) return r.kind;
  return drawnKind(r);
}

/** The kind an arrow's look gives it, whatever was chosen by hand. */
export function drawnKind(r: Arrow): ArrowKind {
  if (r.from || r.to || r.elbow || r.reagentFor !== undefined) return 'plain';
  const h = r.headStyle !== 'none', t = r.tailStyle !== 'none';
  if (r.sweep || r.bez?.length) return r.step ? 'reaction' : h || t ? 'mechanism' : 'plain';
  if (!h && !t) return 'plain';
  // heads at both ends: resonance (but two half-headed shafts are an equilibrium)
  if (h && t && !r.equilibrium) return 'plain';
  if (r.shaftSpacing || r.dipole) return 'plain';
  return 'reaction';
}

/** Can this arrow be a reaction step? A reaction arrow: straight (or a catalytic cycle's step). */
export function isReactionArrow(r: Arrow): boolean {
  if ((r.sweep || r.bez?.length) && !r.step) return false;
  return arrowKind(r) === 'reaction';
}

/** A straight arrow that is not a reaction step (resonance, retrosynthetic): it only lines up with what is before and after it. */
export function isSequenceArrow(r: Arrow): boolean {
  if (r.sweep || r.bez?.length || r.from || r.to || r.elbow || r.reagentFor !== undefined) return false;
  if (r.headStyle === 'none' && r.tailStyle === 'none') return false;
  return arrowKind(r) === 'plain';
}

/**
 * How far from an arrow a structure can be and still count as its starting material or product,
 * in bond lengths: `reach` past its head or before its tail, and `lane` either side of the line
 * it points along (Settings > Schemes).
 */
export const ROLE_LIMITS = { reach: 3, lane: 1 };
export function setRoleLimits(p: { reach?: number | null; lane?: number | null }): void {
  ROLE_LIMITS.reach = p.reach && p.reach > 0 ? p.reach : 3;
  ROLE_LIMITS.lane = p.lane && p.lane > 0 ? p.lane : 1;
}

/** Where along an arrow things are: t along it from the tail, s across it (positive above). */
export interface Frame { tail: Vec; u: Vec; n: Vec; length: number }

export function arrowFrame(r: Arrow): Frame {
  // an arrow drawn with only a tail head points backwards
  const fwd = r.headStyle !== 'none' || r.tailStyle === 'none';
  const tail = fwd ? r.tail : r.head, head = fwd ? r.head : r.tail;
  const d = sub(head, tail);
  const length = Math.hypot(d.x, d.y);
  const u = norm(d);
  // "above" is the side higher on the page (as ChemDraw reads it, whichever way the arrow
  // points); for an upright arrow, the side anticlockwise from it (right of ↓, left of ↑)
  let n = { x: u.y, y: -u.x };
  if (n.y > 1e-9) n = { x: -n.x, y: -n.y };
  return { tail, u, n, length };
}

/** A box seen from an arrow: its extent along (t) and across (s) the arrow. */
export function inFrame(f: Frame, b: Rect): { t1: number; t2: number; s1: number; s2: number } {
  let t1 = Infinity, t2 = -Infinity, s1 = Infinity, s2 = -Infinity;
  for (const p of [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x1, y: b.y2 }, { x: b.x2, y: b.y2 }]) {
    const d = sub(p, f.tail);
    const t = dot(d, f.u), s = dot(d, f.n);
    t1 = Math.min(t1, t); t2 = Math.max(t2, t);
    s1 = Math.min(s1, s); s2 = Math.max(s2, s);
  }
  return { t1, t2, s1, s2 };
}

/** Distance between two boxes given in an arrow's frame (0 when they touch). */
type Span = { t1: number; t2: number; s1: number; s2: number };
const gapBetween = (a: Span, b: Span) => Math.hypot(Math.max(0, a.t1 - b.t2, b.t1 - a.t2), Math.max(0, a.s1 - b.s2, b.s1 - a.s2));

/**
 * The roles round one arrow, from where things sit. Starting materials: the nearest thing past
 * the tail, then more beyond it, each after a + sign; products the same past the head; conditions:
 * what is stacked above and below the arrow. `bond` is the drawing's bond length, which sets how
 * close things must be to count.
 */
export function interpretArrow(r: Arrow, items: Item[], bond: number): StepRoles {
  const out: StepRoles = { reactants: [], products: [], above: [], below: [], plusses: [] };
  const f = arrowFrame(r);
  const L = f.length;
  if (L < 1) return out;
  const reach = ROLE_LIMITS.reach * bond, lane = ROLE_LIMITS.lane * bond, stack = 1.5 * bond, touch = 0.6 * bond;
  // two structures about as near as each other (and neither against the arrow): no guessing
  const tie = 0.3 * bond, against = 0.1 * bond;
  const seen = items.map((it) => ({ it, ...inFrame(f, it.box) }));
  type Seen = (typeof seen)[number];
  const used = new Set<Item>();
  const mid = (x: Seen) => (x.t1 + x.t2) / 2;

  // starting materials and products: a chain from the arrow's end, linked by + signs
  const chain = (cands: Seen[], end: Span, beyond: (x: Seen, from: Span) => boolean, into: string[]) => {
    let from: Span = end, plus: Seen | null = null;
    for (;;) {
      const near: { x: Seen; d: number }[] = [];
      for (const x of cands) {
        if (used.has(x.it) || !beyond(x, from)) continue;
        // in line with the arrow, and near enough along it
        if (x.s1 > lane || x.s2 < -lane) continue;
        if (Math.max(0, x.t1 - from.t2, from.t1 - x.t2) > reach) continue;
        const d = gapBetween(x, from);
        // after a structure a + sign leads on (or a structure right beside it: a salt's ions);
        // after a + sign, the next structure
        if (into.length && !plus && !x.it.plus && d > touch) continue;
        if ((!into.length || plus) && x.it.plus) continue;
        near.push({ x, d });
      }
      if (!near.length) break;
      near.sort((a, b) => a.d - b.d);
      const best = near[0].x, bestD = near[0].d;
      const rival = near.find((n) => n.x !== best && n.x.it.plus === best.it.plus);
      if (!best.it.plus && bestD > against && rival && rival.d - bestD < tie) break;
      used.add(best.it);
      if (best.it.plus) { plus = best; from = best; continue; }
      into.push(best.it.ref);
      if (plus) { out.plusses!.push(plus.it.ref); plus = null; }
      from = best;
    }
    if (plus) used.delete(plus.it);
  };
  const tailEnd: Span = { t1: 0, t2: 0, s1: 0, s2: 0 }, headEnd: Span = { t1: L, t2: L, s1: 0, s2: 0 };
  // (starting materials and products are structures; text beside an arrow is a condition)
  const parts = seen.filter((x) => x.it.plus || x.it.atoms.length);
  chain(parts.filter((x) => mid(x) < 0 && x.t2 < 0.5 * L), tailEnd, (x, from) => mid(x) < (from.t1 + from.t2) / 2, out.reactants);
  chain(parts.filter((x) => mid(x) > L && x.t1 > 0.5 * L), headEnd, (x, from) => mid(x) > (from.t1 + from.t2) / 2, out.products);

  // conditions: stacked above and below the arrow, centred along it
  const free = seen.filter((x) => !used.has(x.it) && !x.it.plus && mid(x) >= -0.1 * L && mid(x) <= 1.1 * L);
  const stackUp = (cands: Seen[], near: (x: Seen) => number, far: (x: Seen) => number, into: string[]) => {
    let top = 0;
    for (const x of cands.sort((a, b) => near(a) - near(b))) {
      if (near(x) - top > stack) break;
      into.push(x.it.ref);
      used.add(x.it);
      top = Math.max(top, far(x));
    }
  };
  const side = (x: Seen) => (x.s1 + x.s2) / 2;
  stackUp(free.filter((x) => side(x) >= 0), (x) => Math.max(0, x.s1), (x) => x.s2, out.above);
  stackUp(free.filter((x) => side(x) < 0), (x) => Math.max(0, -x.s2), (x) => -x.s1, out.below);
  return out;
}

/** Is this a step with something on both sides of the arrow? */
export const isStep = (s: StepRoles | null | undefined): boolean => !!s && s.reactants.length > 0 && s.products.length > 0;

/**
 * The roles an arrow has: those stored with it (from a file, Clean Up Reaction or set by hand), or
 * worked out. Text written over or under an arrow after its roles were stored (a step opened from
 * a file, then a reagent typed in) is counted too, unless the roles were chosen by hand. A stored
 * starting material or product that has since been moved out of line with a straight arrow no
 * longer counts (what is in line now is worked out instead), unless the roles were chosen by hand.
 */
export function rolesOf(r: Arrow, items: Item[], bond: number): StepRoles {
  const st = r.step;
  if (!st) return interpretArrow(r, items, bond);
  if (st.manual) return st;
  const straight = !r.sweep && !r.bez?.length;
  const hasText = items.some((it) => it.caption !== undefined);
  if (!straight && !hasText) return st;
  const now = interpretArrow(r, items, bond);
  let out = st;
  if (straight) {
    const find = itemFinder(items);
    const keep = (refs: string[], before: boolean) => {
      const kept = refs.filter((ref) => { const it = find(ref); return !it || inCorridor(r, it, refs, find, bond, before); });
      return kept.length === refs.length ? refs : kept.length ? kept : before ? now.reactants : now.products;
    };
    const reactants = keep(st.reactants, true), products = keep(st.products, false);
    if (reactants !== st.reactants || products !== st.products) {
      // + signs: those still in line, and those of a side worked out afresh
      const fresh = reactants === now.reactants || products === now.products ? now.plusses ?? [] : [];
      const plusses = (st.plusses ?? []).filter((ref) => { const it = find(ref); return !it || inLane(r, it, bond); });
      for (const ref of fresh) if (!plusses.includes(ref)) plusses.push(ref);
      out = { ...st, reactants, products, plusses };
    }
  }
  if (!hasText) return out;
  const known = new Set([...out.reactants, ...out.products, ...out.above, ...out.below, ...(out.plusses ?? []), ...(out.inside ?? [])]);
  const added = (refs: string[]) => refs.filter((ref) => ref[0] === 'c' && !known.has(ref));
  const above = added(now.above), below = added(now.below);
  return above.length || below.length ? { ...out, above: [...out.above, ...above], below: [...out.below, ...below] } : out;
}

/** Does a thing lie across the line an arrow points along (within the lane either side of it)? */
function inLane(r: Arrow, it: Item, bond: number): boolean {
  const f = arrowFrame(r);
  if (f.length < 1) return true;
  const x = inFrame(f, it.box), lane = ROLE_LIMITS.lane * bond;
  return x.s1 <= lane && x.s2 >= -lane;
}

/**
 * Is a stored starting material (before) or product still in line with its arrow: on the right
 * side of it, across the line it points along, and no further off than the rest of its row
 * (the other starting materials or products, each with its + sign) leaves room for.
 */
function inCorridor(r: Arrow, it: Item, refs: string[], find: (ref: string) => Item | undefined, bond: number, before: boolean): boolean {
  const f = arrowFrame(r);
  if (f.length < 1) return true;
  const x = inFrame(f, it.box);
  const reach = ROLE_LIMITS.reach * bond;
  if (!inLane(r, it, bond)) return false;
  const mid = (x.t1 + x.t2) / 2;
  if (before ? mid >= 0 : mid <= f.length) return false;
  let room = reach;
  for (const ref of refs) {
    const o = find(ref);
    if (!o || o === it) continue;
    const y = inFrame(f, o.box);
    room += y.t2 - y.t1 + reach;
  }
  const gap = before ? -x.t2 : x.t1 - f.length;
  return gap <= room;
}

/** Every reaction arrow in the drawing, with its roles (a row's first arrow continuing from the row above). */
export function reactionSteps(doc: Doc, items: Item[]): { arrow: Arrow; roles: StepRoles }[] {
  const all: { arrow: Arrow; roles: StepRoles }[] = [];
  for (const r of doc.arrows.values()) if (isReactionArrow(r)) all.push({ arrow: r, roles: rolesOf(r, items, doc.style.bondLength) });
  linkRows(all, items, doc.style.bondLength);
  return all.filter(({ arrow, roles }) => isStep(roles) || arrow.step);
}

/**
 * A scheme wrapped onto more rows: an arrow that starts a row (products, but nothing before it)
 * goes on from the last product of the row above, as a chemist reads it, but only when that
 * product ends the row directly above (the next row up, not far off) and lies to the right of
 * where the arrow starts. Changes the roles given (copies, never an arrow's stored ones).
 */
export function linkRows(steps: { arrow: Arrow; roles: StepRoles }[], items: Item[], bond = 30): void {
  const boxOf = new Map(items.map((it) => [it.ref, it.box]));
  const startsOf = new Set(steps.flatMap(({ roles }) => roles.reactants));
  const y = (r: Arrow) => (r.tail.y + r.head.y) / 2;
  const across = (r: Arrow) => Math.abs(r.head.x - r.tail.x) > 2 * Math.abs(r.head.y - r.tail.y);
  for (const st of steps) {
    const { arrow, roles } = st;
    if (roles.reactants.length || !roles.products.length || !across(arrow)) continue;
    // the row above: the nearest arrows higher up, and the rightmost product there that leads nowhere
    let best: { ref: string; dy: number; x: number; h: number } | null = null;
    for (const o of steps) {
      if (o === st || !across(o.arrow) || !o.roles.products.length) continue;
      const dy = y(arrow) - y(o.arrow);
      if (dy <= 0) continue;
      for (const ref of o.roles.products) {
        const b = boxOf.get(ref);
        if (!b || startsOf.has(ref) || roles.products.includes(ref)) continue;
        if (!best || dy < best.dy - 1 || (Math.abs(dy - best.dy) <= 1 && b.x2 > best.x)) best = { ref, dy, x: b.x2, h: b.y2 - b.y1 };
      }
    }
    if (!best) continue;
    // directly above (a row's height or so), and ending to the right of where this arrow starts
    if (best.dy > Math.max(6 * bond, 2.5 * best.h + 3 * bond)) continue;
    if (best.x <= Math.min(arrow.tail.x, arrow.head.x)) continue;
    st.roles = { ...roles, reactants: [best.ref] };
    startsOf.add(best.ref);
  }
}

/**
 * What a plain straight arrow (resonance, retrosynthetic) joins: the structures in line before
 * its tail and after its head, found the way a reaction arrow's starting materials and products are.
 */
export function neighborsOf(r: Arrow, items: Item[], bond: number): { before: string[]; after: string[] } {
  const roles = interpretArrow(r, items, bond);
  return { before: roles.reactants, after: roles.products };
}

/** Text sizes from Arial's published widths: a measure that needs no screen (tests, files). */
export function plainMeasure(doc: Doc): Measure {
  return {
    atomBoxes(a: Atom): Rect[] {
      const spec = a.attach || a.multi ? null : labelSpec(a.z, a.label, a.charge, a.isotope, doc.valenceSum(a.id), doc.degree(a.id), !a.hideCharge, !!a.showCarbon);
      if (!spec) return [];
      const k = a.s ?? 1;
      const lay = layoutLabel(spec, labelBonds(doc, a), doc.style.labelSize * k, (t, s) => arialWidth(t, s), a.just);
      const m = doc.style.marginWidth * k;
      return lay.boxes.map((b) => ({ x1: a.x + b.x1 - m, y1: a.y + b.y1 - m, x2: a.x + b.x2 + m, y2: a.y + b.y2 + m }));
    },
    captionBox(c: Caption): Rect {
      const b = layoutText(c, doc.style.captionSize, (t, s, _f, style) => arialWidth(t, s, style.includes('bold'))).box;
      return { x1: c.x + b.x1, y1: c.y + b.y1, x2: c.x + b.x2, y2: c.y + b.y2 };
    },
  };
}

/** Box round an arrow (for laying schemes out). */
export const arrowRect = (r: Arrow): Rect => arrowBox(r);
